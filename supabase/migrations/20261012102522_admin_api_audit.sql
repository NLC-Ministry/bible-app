-- #550 第四組（系統）：後台的稽核紀錄檢視，admin-api 的 audit_* action 用的資料庫函式。
--
-- #549 把管理操作記進 audit.admin_events，但沒有地方看（資料表不在 API 上，只能進資料庫查）。
-- 後台「系統 → 稽核紀錄」經 admin-api 呼叫這裡的函式：
--
--   _admin_api_audit_json(event, inline_bytes)  一筆紀錄 → JSON（操作者、對象的名字，角色中文名稱）
--   admin_api_audit_list(...)                   清單（keyset：id 由新到舊）；第一頁另帶總筆數與篩選選項
--                                               （期間內出現過的動作、操作者）
--   admin_api_audit_event(id)                   單筆完整內容（清單裡變更內容／補充資訊太大時省略，點開才抓）
--   admin_api_audit_export(...)                 匯出用的資料（最多 5000 筆）＋ export 稽核；CSV 由 admin-api 產生
--
-- 看清單本身不另外記稽核：只有系統管理員有 audit.read（能直接查資料庫的人），每次換條件都記一筆的話，
-- 清單最上面會被自己的查看洗掉。匯出要記（檔案會離開系統）。
-- 全部只給 service_role（admin-api 以 service role 連線）；誰能呼叫由 admin-api 的能力表決定。
-- 依賴 #549 的 audit schema（20261010181946_admin_audit_events.sql）。只新增函式，不改資料表、不改既有函式。

-- ── 0. 一筆紀錄 → JSON ─────────────────────────────────────────────────────────
-- p_inline_bytes：changes／detail 超過這個大小就不放（changes_omitted／detail_omitted = true，
-- 畫面點開再用 admin_api_audit_event 抓），
-- NULL＝全部放。名字用子查詢（帳號刪了紀錄仍在，名字就是 NULL）。
CREATE OR REPLACE FUNCTION public._admin_api_audit_json(p_event audit.admin_events, p_inline_bytes INTEGER)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $_admin_api_audit_json$
  SELECT jsonb_build_object(
    'id', p_event.id,
    'occurred_at', p_event.occurred_at,
    'source', p_event.source,
    'action', p_event.action,
    'resource', p_event.resource,
    'result', p_event.result,
    'reason', p_event.reason,
    'request_id', p_event.request_id,
    'actor', CASE WHEN p_event.actor_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p_event.actor_id,
      'name', (SELECT profile.name FROM public.profiles AS profile WHERE profile.id = p_event.actor_id)) END,
    'actor_role', p_event.actor_role,
    'actor_role_label', (SELECT role.label FROM public.role_definitions AS role WHERE role.code = p_event.actor_role LIMIT 1),
    'target_user', CASE WHEN p_event.target_user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p_event.target_user_id,
      'name', (SELECT profile.name FROM public.profiles AS profile WHERE profile.id = p_event.target_user_id)) END,
    'target_id', p_event.target_id,
    'changes', CASE WHEN p_inline_bytes IS NULL OR octet_length(COALESCE(p_event.changes::text, '')) <= p_inline_bytes
      THEN p_event.changes END,
    'detail', CASE WHEN p_inline_bytes IS NULL OR octet_length(COALESCE(p_event.detail::text, '')) <= p_inline_bytes
      THEN p_event.detail END,
    'changes_omitted', p_inline_bytes IS NOT NULL AND octet_length(COALESCE(p_event.changes::text, '')) > p_inline_bytes,
    'detail_omitted', p_inline_bytes IS NOT NULL AND octet_length(COALESCE(p_event.detail::text, '')) > p_inline_bytes
  );
$_admin_api_audit_json$;
REVOKE ALL ON FUNCTION public._admin_api_audit_json(audit.admin_events, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_api_audit_json(audit.admin_events, INTEGER) TO service_role;

-- ── 1. 清單 ───────────────────────────────────────────────────────────────────
-- p_days：最近幾天（1～366）。其他條件 NULL＝不篩。p_cursor_id：上一頁最後一筆的 id。
CREATE OR REPLACE FUNCTION public.admin_api_audit_list(
  p_days INTEGER DEFAULT 7,
  p_action TEXT DEFAULT NULL,
  p_result TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_cursor_id BIGINT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_audit_list$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_inline_bytes CONSTANT INTEGER := 2000;
  v_since TIMESTAMPTZ;
  v_ids BIGINT[];
  v_items JSONB;
  v_total INTEGER := NULL;
  v_facets JSONB := NULL;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 366 THEN
    RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NOT NULL AND p_result NOT IN ('ok', 'denied', 'error') THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('admin-api', 'nlc-data') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
  v_since := now() - make_interval(days => p_days);

  SELECT array_agg(page.id ORDER BY page.id DESC) INTO v_ids
  FROM (
    SELECT event.id
    FROM audit.admin_events AS event
    WHERE event.occurred_at >= v_since
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_result IS NULL OR event.result = p_result)
      AND (p_source IS NULL OR event.source = p_source)
      AND (p_actor_id IS NULL OR event.actor_id = p_actor_id)
      AND (p_target_user_id IS NULL OR event.target_user_id = p_target_user_id)
      AND (p_cursor_id IS NULL OR event.id < p_cursor_id)
    ORDER BY event.id DESC
    LIMIT v_limit + 1
  ) AS page;

  SELECT jsonb_agg(public._admin_api_audit_json(event, v_inline_bytes) ORDER BY event.id DESC) INTO v_items
  FROM audit.admin_events AS event
  WHERE event.id = ANY (v_ids[1:v_limit]);

  -- 第一頁才算總數與篩選選項（換頁不用重算）。選項只看期間，不看其他條件，下拉才不會越選越少。
  IF p_cursor_id IS NULL THEN
    SELECT count(*) INTO v_total
    FROM audit.admin_events AS event
    WHERE event.occurred_at >= v_since
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_result IS NULL OR event.result = p_result)
      AND (p_source IS NULL OR event.source = p_source)
      AND (p_actor_id IS NULL OR event.actor_id = p_actor_id)
      AND (p_target_user_id IS NULL OR event.target_user_id = p_target_user_id);

    v_facets := jsonb_build_object(
      'actions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('action', counted.action, 'count', counted.n)
          ORDER BY counted.n DESC, counted.action), '[]'::jsonb)
        FROM (
          SELECT event.action, count(*) AS n
          FROM audit.admin_events AS event
          WHERE event.occurred_at >= v_since
          GROUP BY event.action
          ORDER BY count(*) DESC, event.action
          LIMIT 300
        ) AS counted),
      'actors', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', counted.actor_id, 'name', profile.name, 'count', counted.n)
          ORDER BY counted.n DESC, counted.actor_id), '[]'::jsonb)
        FROM (
          SELECT event.actor_id, count(*) AS n
          FROM audit.admin_events AS event
          WHERE event.occurred_at >= v_since AND event.actor_id IS NOT NULL
          GROUP BY event.actor_id
          ORDER BY count(*) DESC, event.actor_id
          LIMIT 200
        ) AS counted
        LEFT JOIN public.profiles AS profile ON profile.id = counted.actor_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'next_cursor', CASE WHEN cardinality(v_ids) > v_limit THEN v_ids[v_limit] END,
    'total', v_total,
    'facets', v_facets,
    'since', v_since,
    -- 從網址帶進來的條件，畫面要顯示名字（可能不在選項裡）
    'actor', CASE WHEN p_actor_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p_actor_id, 'name', (SELECT profile.name FROM public.profiles AS profile WHERE profile.id = p_actor_id)) END,
    'target', CASE WHEN p_target_user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p_target_user_id, 'name', (SELECT profile.name FROM public.profiles AS profile WHERE profile.id = p_target_user_id)) END
  );
END;
$admin_api_audit_list$;
REVOKE ALL ON FUNCTION public.admin_api_audit_list(INTEGER, TEXT, TEXT, TEXT, UUID, UUID, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_audit_list(INTEGER, TEXT, TEXT, TEXT, UUID, UUID, BIGINT, INTEGER) TO service_role;

-- ── 2. 單筆完整內容 ────────────────────────────────────────────────────────────
-- 找不到（id 錯或已超過保存期限被清掉）回 NULL（admin-api → 404）。
CREATE OR REPLACE FUNCTION public.admin_api_audit_event(p_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_audit_event$
  SELECT public._admin_api_audit_json(event, NULL)
  FROM audit.admin_events AS event
  WHERE event.id = p_id;
$admin_api_audit_event$;
REVOKE ALL ON FUNCTION public.admin_api_audit_event(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_audit_event(BIGINT) TO service_role;

-- ── 3. 匯出 ───────────────────────────────────────────────────────────────────
-- 條件同清單（p_filter_actor_id＝篩選的操作者；p_actor_id 是匯出的人）。最多 5000 筆；
-- 變更內容／補充資訊超過 2000 bytes 的不放（CSV 註明到後台看），檔案才不會大到 admin-api 撐不住。
CREATE OR REPLACE FUNCTION public.admin_api_audit_export(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_days INTEGER DEFAULT 7,
  p_action TEXT DEFAULT NULL,
  p_result TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_filter_actor_id UUID DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_audit_export$
DECLARE
  v_max CONSTANT INTEGER := 5000;
  v_inline_bytes CONSTANT INTEGER := 2000;
  v_since TIMESTAMPTZ;
  v_rows JSONB;
  v_total INTEGER;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 366 THEN
    RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NOT NULL AND p_result NOT IN ('ok', 'denied', 'error') THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('admin-api', 'nlc-data') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
  v_since := now() - make_interval(days => p_days);

  SELECT count(*) INTO v_total
  FROM audit.admin_events AS event
  WHERE event.occurred_at >= v_since
    AND (p_action IS NULL OR event.action = p_action)
    AND (p_result IS NULL OR event.result = p_result)
    AND (p_source IS NULL OR event.source = p_source)
    AND (p_filter_actor_id IS NULL OR event.actor_id = p_filter_actor_id)
    AND (p_target_user_id IS NULL OR event.target_user_id = p_target_user_id);

  SELECT jsonb_agg(public._admin_api_audit_json(event, v_inline_bytes) ORDER BY event.id DESC) INTO v_rows
  FROM audit.admin_events AS event
  WHERE event.id IN (
    SELECT matched.id
    FROM audit.admin_events AS matched
    WHERE matched.occurred_at >= v_since
      AND (p_action IS NULL OR matched.action = p_action)
      AND (p_result IS NULL OR matched.result = p_result)
      AND (p_source IS NULL OR matched.source = p_source)
      AND (p_filter_actor_id IS NULL OR matched.actor_id = p_filter_actor_id)
      AND (p_target_user_id IS NULL OR matched.target_user_id = p_target_user_id)
    ORDER BY matched.id DESC
    LIMIT v_max
  );

  PERFORM audit.record('admin-api', 'export', 'ok', p_actor_id, p_actor_role, 'audit.admin_events',
    p_target_user_id, NULL, NULL, NULL, p_request_id,
    jsonb_build_object('kind', 'audit', 'days', p_days, 'action', p_action, 'result', p_result, 'source', p_source,
      'actor_id', p_filter_actor_id, 'rows', LEAST(v_total, v_max), 'truncated', v_total > v_max));
  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total', v_total, 'truncated', v_total > v_max);
END;
$admin_api_audit_export$;
REVOKE ALL ON FUNCTION public.admin_api_audit_export(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_audit_export(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO service_role;
