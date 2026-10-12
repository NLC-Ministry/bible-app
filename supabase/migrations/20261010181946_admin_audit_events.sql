-- 稽核紀錄（#549，後台重新設計 3/8）
--
-- 以前只有隊伍有事件表（0149）。管理員或組長改管理範圍、改計畫、改公告或題目都沒有紀錄，
-- 遇到「隔幾天又變回」這類問題無法回推是誰、什麼時候、改了什麼。
--
-- 設計：
--   · 放在獨立 schema `audit`：不在 API 暴露的 schema 裡（config.toml 的 [api] 沒設 schemas，
--     用預設 public／graphql_public），就算哪天 RLS 設錯也不會從網路被讀到。
--   · 只能新增：資料表對所有 API 角色都沒有權限；唯一的寫入口是 SECURITY DEFINER 的
--     audit.record()（只給 service_role），UPDATE／DELETE／TRUNCATE 由觸發器擋下，
--     只有保留期清理 audit.purge_expired() 能刪過期的資料。
--   · 寫入點：admin-api（#547）的每支 RPC 在同一個交易內呼叫 audit.record()；nlc-data
--     舊有的管理寫入成功後經 public.record_admin_audit_event() 補記一筆（盡力而為）。
--   · 保留 1 年，每週日清理一次（pg_cron）。
-- 不需要任何前置設定，可以直接推。

CREATE SCHEMA IF NOT EXISTS audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA audit TO service_role;

CREATE TABLE IF NOT EXISTS audit.admin_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id      TEXT,
  actor_id        UUID,                 -- profiles.id；不設外鍵，帳號刪了紀錄仍在
  actor_role      TEXT,
  action          TEXT NOT NULL,        -- 例：set_profile_managed_scopes、profiles.update、view_user
  resource        TEXT,                 -- 資料表或功能
  target_user_id  UUID,
  target_id       TEXT,
  changes         JSONB,                -- 只放有變動的欄位：{"欄位": {"before": …, "after": …}}
  result          TEXT NOT NULL,
  reason          TEXT,                 -- 選填，例如「因回報 #…」
  source          TEXT NOT NULL,
  detail          JSONB,                -- 條件、筆數、錯誤碼等補充
  CONSTRAINT admin_events_result_check CHECK (result IN ('ok', 'denied', 'error')),
  CONSTRAINT admin_events_source_check CHECK (source IN ('admin-api', 'nlc-data')),
  CONSTRAINT admin_events_action_length CHECK (char_length(action) BETWEEN 1 AND 100),
  CONSTRAINT admin_events_reason_length CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_admin_events_occurred ON audit.admin_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_actor    ON audit.admin_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_target   ON audit.admin_events (target_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_action   ON audit.admin_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_request  ON audit.admin_events (request_id) WHERE request_id IS NOT NULL;

-- 沒有任何 API 角色可以直接碰資料表；讀取只能經過 admin-api 的 SQL 函式（需要「看稽核」能力）
REVOKE ALL ON TABLE audit.admin_events FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE audit.admin_events ENABLE ROW LEVEL SECURITY;

-- ── 只能新增：擋 UPDATE／DELETE／TRUNCATE（保留期清理例外）────────────────────────
CREATE OR REPLACE FUNCTION audit.block_admin_event_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $block_admin_event_changes$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('audit.purging', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit.admin_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$block_admin_event_changes$;
REVOKE ALL ON FUNCTION audit.block_admin_event_changes() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS admin_events_append_only ON audit.admin_events;
CREATE TRIGGER admin_events_append_only
  BEFORE UPDATE OR DELETE ON audit.admin_events
  FOR EACH ROW EXECUTE FUNCTION audit.block_admin_event_changes();

DROP TRIGGER IF EXISTS admin_events_no_truncate ON audit.admin_events;
CREATE TRIGGER admin_events_no_truncate
  BEFORE TRUNCATE ON audit.admin_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit.block_admin_event_changes();

-- ── 唯一的寫入口 ─────────────────────────────────────────────────────────────
-- changes／detail 太大（例如整批匯入的 payload）就只留大小，不讓單筆紀錄撐爆表。
CREATE OR REPLACE FUNCTION audit.record(
  p_source         TEXT,
  p_action         TEXT,
  p_result         TEXT DEFAULT 'ok',
  p_actor_id       UUID DEFAULT NULL,
  p_actor_role     TEXT DEFAULT NULL,
  p_resource       TEXT DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_target_id      TEXT DEFAULT NULL,
  p_changes        JSONB DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL,
  p_request_id     TEXT DEFAULT NULL,
  p_detail         JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $audit_record$
DECLARE
  v_id BIGINT;
  v_max_bytes CONSTANT INTEGER := 32768;
  v_changes JSONB := p_changes;
  v_detail JSONB := p_detail;
BEGIN
  IF v_changes IS NOT NULL AND octet_length(v_changes::text) > v_max_bytes THEN
    v_changes := jsonb_build_object('truncated', true, 'bytes', octet_length(p_changes::text));
  END IF;
  IF v_detail IS NOT NULL AND octet_length(v_detail::text) > v_max_bytes THEN
    v_detail := jsonb_build_object('truncated', true, 'bytes', octet_length(p_detail::text));
  END IF;

  INSERT INTO audit.admin_events (
    request_id, actor_id, actor_role, action, resource, target_user_id, target_id,
    changes, result, reason, source, detail
  ) VALUES (
    left(NULLIF(btrim(p_request_id), ''), 100),
    p_actor_id,
    left(NULLIF(btrim(p_actor_role), ''), 50),
    left(btrim(p_action), 100),
    left(NULLIF(btrim(p_resource), ''), 100),
    p_target_user_id,
    left(NULLIF(btrim(p_target_id), ''), 200),
    v_changes,
    p_result,
    left(NULLIF(btrim(p_reason), ''), 500),
    p_source,
    v_detail
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$audit_record$;
REVOKE ALL ON FUNCTION audit.record(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION audit.record(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;

-- ── nlc-data 用的入口：audit schema 不在 API 上，PostgREST 只叫得到 public 的函式 ─────
-- 來源固定是 nlc-data；只給 service_role（nlc-data 以 service role 連線）。
CREATE OR REPLACE FUNCTION public.record_admin_audit_event(
  p_action         TEXT,
  p_result         TEXT DEFAULT 'ok',
  p_actor_id       UUID DEFAULT NULL,
  p_actor_role     TEXT DEFAULT NULL,
  p_resource       TEXT DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_target_id      TEXT DEFAULT NULL,
  p_changes        JSONB DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL,
  p_request_id     TEXT DEFAULT NULL,
  p_detail         JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $record_admin_audit_event$
  SELECT audit.record(
    'nlc-data', p_action, p_result, p_actor_id, p_actor_role, p_resource,
    p_target_user_id, p_target_id, p_changes, p_reason, p_request_id, p_detail
  );
$record_admin_audit_event$;
REVOKE ALL ON FUNCTION public.record_admin_audit_event(TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_admin_audit_event(TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;

-- ── 保留期清理（預設 1 年）──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit.purge_expired(p_retention INTERVAL DEFAULT INTERVAL '1 year')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $audit_purge_expired$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_retention IS NULL OR p_retention < INTERVAL '30 days' THEN
    RAISE EXCEPTION 'audit retention must be at least 30 days';
  END IF;
  PERFORM set_config('audit.purging', 'on', true);
  DELETE FROM audit.admin_events WHERE occurred_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('audit.purging', 'off', true);
  RETURN v_deleted;
END;
$audit_purge_expired$;
REVOKE ALL ON FUNCTION audit.purge_expired(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION audit.purge_expired(INTERVAL) TO service_role;

-- 每週日 02:00 台北時間（= 週六 18:00 UTC），排在回報清理（01:45）之後
DO $schedule_audit_purge$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'audit-admin-events-weekly-purge'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'audit-admin-events-weekly-purge',
    '0 18 * * 6',
    'SELECT audit.purge_expired();'
  );
END;
$schedule_audit_purge$;
