-- #425 移除每日靈修（plan_kind='devotional'）與小組聚會週計畫（plan_kind='group_meeting'）。
--
-- 2026-10-03 維護者定案：這兩個功能不跟速讀掛勾，改成獨立的新專案。內容已匯出到
-- heryiyu/newlife-devotion-group（data/devotion-group-content.json），這裡把速讀
-- 資料庫裡所有相關的資料、資料表、函式、旗標與排程一次清掉。
--
-- 兩個環境在 2026-10-03 的實際資料：會友進度／個人偏好／影片同步紀錄都是 0 筆，
-- 只有 2 份計畫的內容，加上掛在這兩份計畫底下的 reading_plans（staging 1、正式 2）。
--
-- 順序要求：
--   · 先 staging，驗證後再正式環境。
--   · 前端同一個 release 已經拿掉所有呼叫點；舊版前端讀不到這些 RPC 時會退回
--     「未開啟」直接隱藏入口，所以不需要 forceUpdateBuiltBefore。
--   · 正式環境請在 release PR merge 後盡快套用：新前端已經沒有排除這兩種計畫的
--     過濾，migration 套用前「小組聚會經營」會短暫出現在探索清單。
--   · 套用後另外要做（不在 SQL 裡）：
--       supabase functions delete sync-devotion-video --project-ref <ref>
--       supabase secrets unset DEVOTION_VIDEO_SYNC_CRON_SECRET DEVOTION_YOUTUBE_PLAYLIST_ID \
--         DEVOTION_YOUTUBE_HANDLE DEVOTION_YOUTUBE_CHANNEL_ID --project-ref <ref>

-- ── 1. 掛在這兩種計畫底下的 reading_plans ───────────────────────────────────
-- reading_plans.global_plan_id 是 ON DELETE SET NULL，不先刪的話會變成沒有歸屬的
-- 孤兒計畫；reading_logs.plan_id 是 CASCADE，會一起清掉。
DELETE FROM public.reading_plans
WHERE global_plan_id IN (
  SELECT id FROM public.global_plans WHERE plan_kind IN ('devotional', 'group_meeting')
);

-- ── 2. 計畫本身（plan_devotion_days 等子表都是 CASCADE）─────────────────────
DELETE FROM public.global_plans WHERE plan_kind IN ('devotional', 'group_meeting');

-- ── 3. 排程與 Vault 密鑰 ───────────────────────────────────────────────────
-- 只有正式環境有這個 cron（staging 從沒排過），所以要先確認存在。
DO $unschedule_devotion_video_sync$
DECLARE
  existing_job BIGINT;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'sync-daily-devotion-video' LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END;
$unschedule_devotion_video_sync$;

DO $drop_devotion_vault_secret$
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE name = 'devotion_video_sync_cron_secret';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'no privilege to delete vault secret devotion_video_sync_cron_secret; remove it from the Dashboard';
END;
$drop_devotion_vault_secret$;

-- ── 4. 函式（依名稱刪掉所有多載，不怕簽名跟歷次 migration 不一致）───────────
DO $drop_devotion_group_functions$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        -- 每日靈修（0145、0152、0157、0158、0159、0161）
        '_devotion_actor_can_manage',
        'get_devotional_plan',
        'list_devotion_days',
        'upsert_devotion_day',
        'delete_devotion_day',
        'bulk_upsert_devotion_days',
        'set_devotional_plan_future_open',
        'set_devotional_plan_playlist_id',
        'set_all_devotion_days_published',
        'list_devotion_progress',
        'upsert_devotion_progress',
        'get_devotion_video_sync_status',
        -- 影片自動同步（0155、0212）
        'sync_devotion_day_video',
        'invoke_devotion_video_sync',
        -- 小組聚會週計畫（0148）
        '_group_meeting_actor_can_manage',
        'get_group_meeting_plan',
        'list_group_meeting_weeks',
        'upsert_group_meeting_week',
        'delete_group_meeting_week',
        'bulk_upsert_group_meeting_weeks',
        'set_group_meeting_plan_future_open',
        -- 功能設定總開關＋個人偏好（0156、0160）
        'get_my_devotion_group_preferences',
        'set_my_devotion_group_preference',
        'set_devotion_group_features_master'
      ])
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.signature);
  END LOOP;
END;
$drop_devotion_group_functions$;

-- ── 5. 資料表（觸發器、RLS policy、索引一起消失）────────────────────────────
DROP TABLE IF EXISTS public.devotion_video_sync_log;
DROP TABLE IF EXISTS public.devotion_day_progress;
DROP TABLE IF EXISTS public.plan_devotion_days;
DROP TABLE IF EXISTS public.plan_group_meeting_weeks;
-- 只存 daily_devotion / group_meeting_plan 兩個個人開關，沒有其他功能使用。
DROP TABLE IF EXISTS public.profile_feature_preferences;

-- ── 6. 功能旗標 ────────────────────────────────────────────────────────────
DELETE FROM public.app_feature_settings
WHERE key IN ('daily_devotion', 'group_meeting_plan', 'devotion_group_features_master', 'devotion_group_hidden');

-- ── 7. plan_kind 收回這兩種（0148 的定義去掉 devotional、group_meeting）──────
ALTER TABLE public.global_plans
  DROP CONSTRAINT IF EXISTS global_plans_plan_kind_check,
  ADD CONSTRAINT global_plans_plan_kind_check
    CHECK (plan_kind IN ('standard', 'church_campaign', 'church_campaign_stage',
                         'church_campaign_stage_cohort'));

-- ── 8. 確認清乾淨（有漏就整個 migration 失敗回滾）────────────────────────────
DO $verify_devotion_group_removed$
DECLARE
  leftover TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ') INTO leftover
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE '%devotion%' OR p.proname LIKE '%devotional_plan%' OR p.proname LIKE '%group_meeting%');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'devotion/group-meeting functions still present: %', leftover;
  END IF;
END;
$verify_devotion_group_removed$;
