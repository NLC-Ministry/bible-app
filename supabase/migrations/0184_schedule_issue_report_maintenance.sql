-- ============================================================================
-- 0184_schedule_issue_report_maintenance.sql
--
-- 回報對話串維護（Edge Function supabase/functions/issue-report-maintenance，
-- 建立於 0153）從寫出來到現在，完全沒有任何 SQL migration 幫它排程過——它自己
-- 的檔頭註解寫「由排程（Supabase Scheduled Function / Cron）每天呼叫一次」，
-- 但那是指 Supabase Dashboard 上的原生 Cron 功能，不在這個 repo 的版控範圍
-- 內、也查不到是否真的有人設定過。跟 sync-devotion-video（0155）/
-- generate-daily-quizzes（0085）這兩支同類型的排程比，這支從一開始就沒有走
-- 「migration 直接用 pg_cron + pg_net 排程」這條可稽核的路徑。
--
-- 這裡補上跟另外兩支完全一樣的模式，讓「回報對話串會不會自動結案 / 清理」
-- 這件事不再依賴一個查不到、對不對得上都不確定的 Dashboard 手動設定。
--
-- 分成兩個排程、頻率不同，是刻意的：
--   1. 每天：只跑 autoclose（POST {}）。這是唯讀式的狀態更新（把已讀未結的
--      舊對話串標記結案），影響小，天天跑沒有風險。
--   2. 每週一次：額外帶 purge（POST {"purge": true}），會真的刪除
--      issue_report_messages 裡結案 180 天以上的訊息列、以及 Storage 裡的孤兒
--      截圖。這是破壞性操作，不需要天天跑——一週一次已經足夠讓資料/儲存空間
--      不會無限累積，同時把「刪除動作」的執行頻率壓低，出錯時影響範圍較小。
--
-- 部署：Supabase SQL editor 執行。Edge Function 本身（連同它需要的
-- ISSUE_REPORT_MAINTENANCE_SECRET）必須已經部署過——這支 migration 只負責
-- 排程呼叫，不部署 Edge Function 本身。
-- 冪等。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- The shared secret is intentionally not committed. Configure it once:
--
--   select vault.create_secret(
--     'REPLACE_WITH_ISSUE_REPORT_MAINTENANCE_SECRET',
--     'issue_report_maintenance_cron_secret',
--     'x-maintenance-secret sent to issue-report-maintenance'
--   );
--
-- Set the identical value as the Edge Function secret
-- ISSUE_REPORT_MAINTENANCE_SECRET.

CREATE OR REPLACE FUNCTION public.invoke_issue_report_maintenance(p_purge BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_issue_report_maintenance$
DECLARE
  cron_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'issue_report_maintenance_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'issue_report_maintenance_cron_secret not found in Vault; skipping issue report maintenance';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/issue-report-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-secret', cron_secret
    ),
    body := CASE WHEN p_purge THEN jsonb_build_object('purge', true)
                 ELSE jsonb_build_object()
            END
  );
END;
$invoke_issue_report_maintenance$;

REVOKE ALL ON FUNCTION public.invoke_issue_report_maintenance(boolean) FROM PUBLIC;

-- ── 每天 01:30 台北時間（= 17:30 UTC）：只跑 autoclose ──────────────────────
DO $schedule_issue_report_autoclose$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'issue-report-maintenance-daily-autoclose'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'issue-report-maintenance-daily-autoclose',
    '30 17 * * *',
    'SELECT public.invoke_issue_report_maintenance(FALSE);'
  );
END;
$schedule_issue_report_autoclose$;

-- ── 每週日 01:45 台北時間（= 週六 17:45 UTC）：額外跑 purge + 孤兒截圖清理 ──
DO $schedule_issue_report_purge$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'issue-report-maintenance-weekly-purge'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'issue-report-maintenance-weekly-purge',
    '45 17 * * 6',
    'SELECT public.invoke_issue_report_maintenance(TRUE);'
  );
END;
$schedule_issue_report_purge$;
