-- ============================================================================
-- 0212_edge_function_url_from_vault.sql
--
-- 問題：下面 6 個函式把正式環境的網址
--   https://YOUR-PROJECT-REF.supabase.co/functions/v1/...
-- 寫死在 SQL 裡。Supabase 的 staging 分支會原樣繼承這些函式，只要 staging 的
-- Vault 設定了對應的 secret，staging 的 pg_cron／trigger 就會去呼叫**正式環境**
-- 的 Edge Function（最嚴重的是 issue-report-maintenance 的每週 purge，會刪掉
-- 正式環境的回報和截圖）。見 issue #252。
--
-- 修法：網址改從 Vault 的 `project_url` 讀取，每個環境各自設定自己的網址。
--   * public.edge_function_url(name)：讀 Vault `project_url`，組成
--     <project_url>/functions/v1/<name>。沒設定、或格式不是
--     https://<ref>.supabase.co 就回傳 NULL。
--   * 6 個函式：只把寫死網址那一行換成 edge_function_url(...)，並在拿到 NULL 時
--     跳過（跟原本「Vault 沒有 secret 就跳過」同一個模式），其餘邏輯一字不改。
--     沒設定 project_url 的環境一律不發出任何 HTTP 請求（fail closed）。
--
-- 以最新定義為基礎：
--   notify_issue_report_sheet_sync       ← 0077
--   invoke_daily_church_quiz_generation  ← 0088
--   request_daily_quiz_regeneration      ← 0090
--   invoke_devotion_video_sync           ← 0155
--   invoke_issue_report_maintenance      ← 0184
--   invoke_daily_quiz_schedule_sweep     ← 0189
--
-- ⚠️ 部署順序（正式環境，不能反）：
--   1. 先在 Vault 設定 project_url：
--        select vault.create_secret(
--          'https://YOUR-PROJECT-REF.supabase.co',
--          'project_url',
--          'Base URL used by edge_function_url() to call this project''s Edge Functions'
--        );
--      （staging 用它自己的專案網址）
--   2. 再貼這支 migration。
--      反過來的話，正式環境的排程會悄悄停掉（只留 WARNING）。
--   3. 驗證：
--        select public.edge_function_url('issue-report-maintenance');
--        select public.invoke_issue_report_maintenance(false);
--        select id, status_code, content from net._http_response order by created desc limit 5;
--
-- 部署：Supabase SQL editor 執行。冪等。
-- ============================================================================

-- ── 輔助函式：從 Vault 讀 project_url，組成 Edge Function 網址 ────────────────
CREATE OR REPLACE FUNCTION public.edge_function_url(p_function_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $edge_function_url$
DECLARE
  base_url TEXT;
BEGIN
  IF p_function_name IS NULL OR p_function_name !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'invalid_edge_function_name';
  END IF;

  SELECT decrypted_secret INTO base_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  base_url := pg_catalog.rtrim(pg_catalog.btrim(COALESCE(base_url, '')), '/');
  IF base_url = '' THEN
    RETURN NULL;
  END IF;

  -- 呼叫端會把 cron／webhook secret 放在 header 裡送出，所以只接受 Supabase
  -- 專案網址，避免 Vault 值設錯時把 secret 送到任意主機。
  IF base_url !~ '^https://[a-z0-9]+\.supabase\.co$' THEN
    RAISE WARNING 'Vault project_url is not a https://<ref>.supabase.co URL; refusing to build Edge Function URL';
    RETURN NULL;
  END IF;

  RETURN base_url || '/functions/v1/' || p_function_name;
END;
$edge_function_url$;

-- 只給以 postgres 身分執行的 SECURITY DEFINER 函式和 SQL Editor 使用。
REVOKE ALL ON FUNCTION public.edge_function_url(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.edge_function_url(TEXT) IS
  'Builds <Vault project_url>/functions/v1/<name>. Returns NULL when project_url is unset or not a *.supabase.co URL, so callers skip the HTTP call (fail closed). See 0212.';

-- ── 1. issue_reports 新增時同步到回報處理試算表（0077）───────────────────────
CREATE OR REPLACE FUNCTION public.notify_issue_report_sheet_sync()
RETURNS TRIGGER AS $$
DECLARE
  webhook_secret TEXT;
  target_url TEXT;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'issue_report_webhook_secret'
  LIMIT 1;

  -- Don't block the insert if the secret hasn't been configured yet (e.g.
  -- during initial setup) — just skip the sync silently and log it.
  IF webhook_secret IS NULL THEN
    RAISE WARNING 'issue_report_webhook_secret not found in Vault; skipping sheet sync for issue_reports row %', NEW.id;
    RETURN NEW;
  END IF;

  target_url := public.edge_function_url('issue-report-sheet-sync');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping sheet sync for issue_reports row %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    -- Same shape as a Supabase Database Webhook payload, matching what
    -- supabase/functions/issue-report-sheet-sync/index.ts already parses.
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'issue_reports',
      'schema', 'public',
      'record', row_to_json(NEW)
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- Trigger function：只由 trigger 觸發，不需要任何角色直接呼叫。
REVOKE ALL ON FUNCTION public.notify_issue_report_sheet_sync() FROM PUBLIC, anon, authenticated;

-- ── 2. 每日小測驗生成排程（0088）────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_daily_church_quiz_generation()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_daily_church_quiz_generation$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
BEGIN
  IF NOT public.is_feature_enabled('daily_quiz') THEN
    RAISE LOG 'Daily quiz feature is disabled; skipping scheduled generation';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'quiz_generation_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'quiz_generation_cron_secret not found in Vault; skipping daily quiz generation';
    RETURN;
  END IF;

  target_url := public.edge_function_url('generate-daily-quizzes');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping daily quiz generation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$invoke_daily_church_quiz_generation$;

REVOKE ALL ON FUNCTION public.invoke_daily_church_quiz_generation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invoke_daily_church_quiz_generation() IS
  'Invokes daily quiz generation only while the daily_quiz feature flag is enabled.';

-- ── 3. 牧者／管理員手動重新產生小測驗（0090）─────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_daily_quiz_regeneration(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_variants TEXT[] DEFAULT ARRAY['A', 'B']::TEXT[],
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $request_daily_quiz_regeneration$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  cron_secret TEXT;
  target_url TEXT;
  normalized_variants TEXT[];
  request_id BIGINT;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(profile.role_id) INTO actor_role
  FROM public.profiles profile
  WHERE profile.id = actor_id;

  IF actor_role NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'quiz_regeneration_permission_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.global_plans plan
    WHERE plan.id = p_global_plan_id
      AND p_quiz_date BETWEEN plan.start_date AND plan.end_date
  ) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;

  SELECT ARRAY_AGG(DISTINCT UPPER(BTRIM(value)) ORDER BY UPPER(BTRIM(value)))
  INTO normalized_variants
  FROM UNNEST(COALESCE(p_variants, ARRAY[]::TEXT[])) AS item(value)
  WHERE UPPER(BTRIM(value)) IN ('A', 'B');
  IF COALESCE(CARDINALITY(normalized_variants), 0) = 0 THEN
    RAISE EXCEPTION 'quiz_regeneration_variants_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = ANY(normalized_variants)
      AND quiz.review_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'quiz_already_approved';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.daily_quizzes quiz
    JOIN public.quiz_publications publication ON publication.quiz_id = quiz.id
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = ANY(normalized_variants)
  ) THEN
    RAISE EXCEPTION 'quiz_already_published';
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'quiz_generation_cron_secret'
  LIMIT 1;
  IF cron_secret IS NULL THEN RAISE EXCEPTION 'quiz_generation_secret_missing'; END IF;

  target_url := public.edge_function_url('generate-daily-quizzes');
  IF target_url IS NULL THEN RAISE EXCEPTION 'edge_function_url_missing'; END IF;

  SELECT net.http_post(
    url := target_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := jsonb_build_object(
      'source', 'manual',
      'quizDate', p_quiz_date,
      'planId', p_global_plan_id,
      'variants', TO_JSONB(normalized_variants),
      'retryExisting', TRUE,
      'requestedBy', actor_id
    )
  ) INTO request_id;

  RETURN jsonb_build_object('queued', TRUE, 'requestId', request_id, 'variants', normalized_variants);
END;
$request_daily_quiz_regeneration$;

-- 權限維持跟 0086 一樣（nlc-data 以 service_role 呼叫），不擴大也不縮小。
REVOKE ALL ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) IS
  'Queues pastor/admin requested A/B generation. C is never AI-generated — it is authored directly at publish time.';

-- ── 4. 每日靈修影片同步排程（0155）──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_devotion_video_sync()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_devotion_video_sync$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'devotion_video_sync_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'devotion_video_sync_cron_secret not found in Vault; skipping devotion video sync';
    RETURN;
  END IF;

  target_url := public.edge_function_url('sync-devotion-video');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping devotion video sync';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$invoke_devotion_video_sync$;

REVOKE ALL ON FUNCTION public.invoke_devotion_video_sync() FROM PUBLIC, anon, authenticated;

-- ── 5. 回報對話串維護排程（0184）────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_issue_report_maintenance(p_purge BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_issue_report_maintenance$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'issue_report_maintenance_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'issue_report_maintenance_cron_secret not found in Vault; skipping issue report maintenance';
    RETURN;
  END IF;

  target_url := public.edge_function_url('issue-report-maintenance');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping issue report maintenance';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
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

REVOKE ALL ON FUNCTION public.invoke_issue_report_maintenance(boolean) FROM PUBLIC, anon, authenticated;

-- ── 6. 小測驗排程發佈掃描（0189）────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_daily_quiz_schedule_sweep()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_daily_quiz_schedule_sweep$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'daily_quiz_schedule_sweep_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'daily_quiz_schedule_sweep_cron_secret not found in Vault; skipping daily quiz schedule sweep';
    RETURN;
  END IF;

  target_url := public.edge_function_url('daily-quiz-schedule-sweep');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping daily quiz schedule sweep';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$invoke_daily_quiz_schedule_sweep$;

REVOKE ALL ON FUNCTION public.invoke_daily_quiz_schedule_sweep() FROM PUBLIC, anon, authenticated;
