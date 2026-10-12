-- #547 後台專用 Edge Function `admin-api` 的資料庫端（全部唯讀，除了稽核與限流計數）。
--
-- admin-api 只用這裡的函式：一個 action 對一支函式、一次資料庫往返。函式全部只給 service_role
-- （admin-api 以 service role 連線），client 不能直接呼叫；誰能呼叫哪個 action 由 admin-api 的
-- 能力表（supabase/functions/admin-api/policy.ts）決定，預設拒絕。
--
--   admin_api_actor(sub)            Logto sub → user_identities → profile；角色一律讀資料庫（role_definitions.code）
--   admin_api_take_rate_limit(...)  依操作者＋類別的固定時間窗計數（Edge 執行個體不保留記憶體狀態）
--   admin_api_record_event(...)     admin-api 的拒絕／錯誤寫進稽核（audit.record，來源 admin-api）
--   admin_api_bootstrap(actor)      我是誰、功能開關、組織樹
--   admin_api_user_search(q)        姓名／email 部分比對，最多 20 筆，email 遮罩
--   admin_api_user_summary(...)     帳號、登入方式、組織、會員中心同步、各計畫摘要、各類筆數、各區塊最新 5 筆；
--                                   同一個交易內寫一筆 view_user 稽核
--   admin_api_user_section(...)     讀經紀錄／隊伍事件／測驗／兌換券／回報，keyset 分頁（時間＋id）
--   admin_api_user_timeline(...)    上面各來源合成時間軸，keyset 分頁
--   admin_api_reveal_pii(...)       完整 email／電話；同一個交易內寫一筆 reveal_pii 稽核
--
-- 進度：計畫摘要只回原始數字（第一遍已讀章數、本遍已讀章數、最後打卡時間、起訖日、書卷），
-- 「落後／超前」由後台前端用 js/data/schedule-progress.mjs 以教會原始日程計算——比對規則全站只有一份。
--
-- 依賴 #549 的 audit schema（20261010181946_admin_audit_events.sql）——那支要先跑。
-- 新索引：reading_logs、issue_reports、exam_attempts、quiz_attempts 各補一個 (user_id, 時間)，
-- 讓「打開某人」與分頁不用掃全表。reading_logs 建索引會短暫擋寫入（千人級資料量是秒級）。

-- ── 1. 索引 ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reading_logs_user_read_at ON public.reading_logs (user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reports_user_created ON public.issue_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_created ON public.exam_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_started ON public.quiz_attempts (user_id, started_at DESC);

-- ── 2. 限流計數 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_api_rate_limits (
  actor_id     UUID NOT NULL,
  bucket       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_id, bucket, window_start)
);
ALTER TABLE public.admin_api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_api_rate_limits FROM PUBLIC, anon, authenticated, service_role;

-- 回 { allowed, hits, limit, retry_after }。同一操作者同一類別每個時間窗一列，順手清掉過期的窗。
CREATE OR REPLACE FUNCTION public.admin_api_take_rate_limit(
  p_actor_id UUID,
  p_bucket TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_take_rate_limit$
DECLARE
  v_window INTEGER := GREATEST(COALESCE(p_window_seconds, 60), 1);
  v_start TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / v_window) * v_window);
  v_hits INTEGER;
BEGIN
  IF p_actor_id IS NULL OR COALESCE(btrim(p_bucket), '') = '' OR COALESCE(p_limit, 0) < 1 THEN
    RAISE EXCEPTION 'invalid_rate_limit' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_api_rate_limits AS r (actor_id, bucket, window_start, hits)
  VALUES (p_actor_id, p_bucket, v_start, 1)
  ON CONFLICT (actor_id, bucket, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;

  DELETE FROM public.admin_api_rate_limits
  WHERE actor_id = p_actor_id AND bucket = p_bucket AND window_start < v_start;

  RETURN jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'hits', v_hits,
    'limit', p_limit,
    'retry_after', GREATEST(1, ceil(extract(epoch FROM (v_start + make_interval(secs => v_window) - now())))::integer)
  );
END;
$admin_api_take_rate_limit$;
REVOKE ALL ON FUNCTION public.admin_api_take_rate_limit(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_take_rate_limit(UUID, TEXT, INTEGER, INTEGER) TO service_role;

-- ── 3. 身分與稽核入口 ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_actor(p_provider_user_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_actor$
  SELECT jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'is_active', profile.is_active,
    'role_code', COALESCE(role.code, 'member'),
    'role_label', role.label
  )
  FROM public.user_identities AS identity
  JOIN public.profiles AS profile ON profile.id = identity.profile_id
  LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
  WHERE identity.provider = 'logto'
    AND identity.provider_user_id = p_provider_user_id
  LIMIT 1;
$admin_api_actor$;
REVOKE ALL ON FUNCTION public.admin_api_actor(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_actor(TEXT) TO service_role;

-- audit schema 不在 API 上，PostgREST 只叫得到 public 的函式；來源固定是 admin-api。
CREATE OR REPLACE FUNCTION public.admin_api_record_event(
  p_action         TEXT,
  p_result         TEXT,
  p_actor_id       UUID DEFAULT NULL,
  p_actor_role     TEXT DEFAULT NULL,
  p_resource       TEXT DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL,
  p_request_id     TEXT DEFAULT NULL,
  p_detail         JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_record_event$
  SELECT audit.record(
    'admin-api', p_action, p_result, p_actor_id, p_actor_role, p_resource,
    p_target_user_id, p_target_user_id::text, NULL, p_reason, p_request_id, p_detail
  );
$admin_api_record_event$;
REVOKE ALL ON FUNCTION public.admin_api_record_event(TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_record_event(TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;

-- ── 4. 遮罩 ──────────────────────────────────────────────────────────────────
-- ab***@gmail.com；本地部分只有 1～2 個字時只留第一個字。
CREATE OR REPLACE FUNCTION public.admin_api_mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $admin_api_mask_email$
  SELECT CASE
    WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
    WHEN position('@' IN p_email) <= 1 THEN '***'
    ELSE left(p_email, CASE WHEN position('@' IN p_email) <= 3 THEN 1 ELSE 2 END)
      || '***@' || substr(p_email, position('@' IN p_email) + 1)
  END;
$admin_api_mask_email$;
REVOKE ALL ON FUNCTION public.admin_api_mask_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_mask_email(TEXT) TO service_role;

-- 0912***678：只留前 4 碼與後 3 碼；數字少於 7 碼整個遮掉。
CREATE OR REPLACE FUNCTION public.admin_api_mask_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $admin_api_mask_phone$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN NULL
    WHEN char_length(regexp_replace(p_phone, '\D', '', 'g')) < 7 THEN '***'
    ELSE left(regexp_replace(p_phone, '\D', '', 'g'), 4) || '***' || right(regexp_replace(p_phone, '\D', '', 'g'), 3)
  END;
$admin_api_mask_phone$;
REVOKE ALL ON FUNCTION public.admin_api_mask_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_mask_phone(TEXT) TO service_role;

-- ── 5. bootstrap ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_bootstrap(p_actor_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_bootstrap$
  SELECT jsonb_build_object(
    'me', (
      SELECT jsonb_build_object(
        'id', profile.id, 'name', profile.name, 'email', profile.email, 'avatar_url', profile.avatar_url,
        'role_code', COALESCE(role.code, 'member'), 'role_label', role.label
      )
      FROM public.profiles AS profile
      LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
      WHERE profile.id = p_actor_id
    ),
    'feature_settings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', setting.key, 'enabled', setting.enabled, 'description', setting.description) ORDER BY setting.key)
      FROM public.app_feature_settings AS setting
    ), '[]'::jsonb),
    'org', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', region.id, 'name', region.name, 'sort_order', region.sort_order,
        'zones', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', zone.id, 'name', zone.name, 'sort_order', zone.sort_order,
            'groups', COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', grp.id, 'name', grp.name, 'sort_order', grp.sort_order) ORDER BY grp.sort_order, grp.name)
              FROM public.small_groups AS grp
              WHERE grp.pastoral_zone_id = zone.id
            ), '[]'::jsonb)
          ) ORDER BY zone.sort_order, zone.name)
          FROM public.pastoral_zones AS zone
          WHERE zone.great_region_id = region.id
        ), '[]'::jsonb)
      ) ORDER BY region.sort_order, region.name)
      FROM public.great_regions AS region
    ), '[]'::jsonb)
  );
$admin_api_bootstrap$;
REVOKE ALL ON FUNCTION public.admin_api_bootstrap(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_bootstrap(UUID) TO service_role;

-- ── 6. 使用者搜尋 ─────────────────────────────────────────────────────────────
-- 至少 1 個中日韓文字或 2 個英數字（admin-api 也先驗過）。LIKE 的 % _ \ 先跳脫。
-- 排序：姓名／email 完全相同 → 開頭相同 → 其他；同級照姓名、id。千人級資料量 ILIKE 就夠。
CREATE OR REPLACE FUNCTION public.admin_api_user_search(p_query TEXT, p_limit INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_search$
DECLARE
  v_query TEXT := btrim(COALESCE(p_query, ''));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20);
  v_escaped TEXT;
BEGIN
  IF char_length(v_query) > 100
     OR NOT (v_query ~ '[㐀-鿿豈-﫿]'
             OR char_length(regexp_replace(v_query, '[^A-Za-z0-9]', '', 'g')) >= 2) THEN
    RAISE EXCEPTION 'query_too_short' USING ERRCODE = '22023';
  END IF;
  v_escaped := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN COALESCE((
    SELECT jsonb_agg(matched.row_data ORDER BY matched.rank, matched.name, matched.id)
    FROM (
      SELECT profile.id, profile.name,
        CASE
          WHEN lower(profile.name) = lower(v_query) OR lower(profile.email) = lower(v_query) THEN 0
          WHEN profile.name ILIKE v_escaped || '%' OR profile.email ILIKE v_escaped || '%' THEN 1
          ELSE 2
        END AS rank,
        jsonb_build_object(
          'id', profile.id,
          'name', profile.name,
          'email_masked', public.admin_api_mask_email(profile.email),
          'great_region', profile.great_region,
          'pastoral_zone', profile.pastoral_zone,
          'small_group', profile.small_group,
          'role_code', COALESCE(role.code, 'member'),
          'role_label', role.label,
          'is_active', profile.is_active,
          'last_seen_at', profile.last_seen_at
        ) AS row_data
      FROM public.profiles AS profile
      LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
      WHERE profile.name ILIKE '%' || v_escaped || '%'
         OR profile.email ILIKE '%' || v_escaped || '%'
         OR EXISTS (
           SELECT 1 FROM public.user_identities AS identity
           WHERE identity.profile_id = profile.id AND identity.email ILIKE '%' || v_escaped || '%'
         )
      ORDER BY rank, profile.name, profile.id
      LIMIT v_limit
    ) AS matched
  ), '[]'::jsonb);
END;
$admin_api_user_search$;
REVOKE ALL ON FUNCTION public.admin_api_user_search(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_search(TEXT, INTEGER) TO service_role;

-- ── 7. 各區塊（內部）────────────────────────────────────────────────────────
-- 回這個人在某個區塊「游標之前」最新的 p_limit 筆，每筆 { section, id, at, … }，照 (at, id) 由新到舊。
-- id 一律轉成文字比對（各來源的 id 型別不同，時間軸要能混排）；at 不會是 NULL。
CREATE OR REPLACE FUNCTION public._admin_api_section_items(
  p_user_id UUID,
  p_section TEXT,
  p_cursor_at TIMESTAMPTZ,
  p_cursor_id TEXT,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_section_items$
DECLARE
  v_items JSONB;
BEGIN
  IF p_section = 'reading_logs' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT log.read_at AS at, log.id::text AS id,
        jsonb_build_object(
          'section', 'reading_logs', 'id', log.id::text, 'at', log.read_at,
          'plan_id', log.plan_id, 'plan_name', COALESCE(global_plan.name, plan.name),
          'book', log.book, 'chapter', log.chapter, 'round', log.round,
          'created_at', log.created_at, 'updated_at', log.updated_at
        ) AS item
      FROM public.reading_logs AS log
      LEFT JOIN public.reading_plans AS plan ON plan.id = log.plan_id
      LEFT JOIN public.global_plans AS global_plan ON global_plan.id = plan.global_plan_id
      WHERE log.user_id = p_user_id
        AND (p_cursor_at IS NULL OR log.read_at < p_cursor_at OR (log.read_at = p_cursor_at AND log.id::text < p_cursor_id))
      ORDER BY log.read_at DESC, log.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'team_events' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT event.created_at AS at, event.id::text AS id,
        jsonb_build_object(
          'section', 'team_events', 'id', event.id::text, 'at', event.created_at,
          'event_type', event.event_type, 'team_id', event.team_id, 'team_name', team.name,
          'global_plan_id', event.global_plan_id, 'plan_name', global_plan.name,
          'division', event.division, 'member_role', event.member_role, 'call_context', event.call_context
        ) AS item
      FROM public.reading_team_member_events AS event
      LEFT JOIN public.reading_teams AS team ON team.id = event.team_id
      LEFT JOIN public.global_plans AS global_plan ON global_plan.id = event.global_plan_id
      WHERE event.user_id = p_user_id
        AND (p_cursor_at IS NULL OR event.created_at < p_cursor_at OR (event.created_at = p_cursor_at AND event.id::text < p_cursor_id))
      ORDER BY event.created_at DESC, event.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'tests' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT * FROM (
        SELECT COALESCE(attempt.submitted_at, attempt.started_at, attempt.created_at) AS at, attempt.id::text AS id,
          jsonb_build_object(
            'section', 'tests', 'kind', 'exam', 'id', attempt.id::text,
            'at', COALESCE(attempt.submitted_at, attempt.started_at, attempt.created_at),
            'paper_id', attempt.paper_id, 'title', paper.title, 'attempt_kind', attempt.attempt_kind,
            'status', attempt.status, 'is_test', attempt.is_test, 'total_score', attempt.total_score,
            'started_at', attempt.started_at, 'submitted_at', attempt.submitted_at, 'submit_reason', attempt.submit_reason
          ) AS item
        FROM public.exam_attempts AS attempt
        LEFT JOIN public.exam_papers AS paper ON paper.id = attempt.paper_id
        WHERE attempt.user_id = p_user_id
        UNION ALL
        SELECT COALESCE(attempt.completed_at, attempt.started_at), attempt.id::text,
          jsonb_build_object(
            'section', 'tests', 'kind', 'daily_quiz', 'id', attempt.id::text,
            'at', COALESCE(attempt.completed_at, attempt.started_at),
            'publication_id', attempt.publication_id, 'quiz_date', publication.quiz_date,
            'status', attempt.status, 'score', attempt.score, 'total', attempt.total,
            'started_at', attempt.started_at, 'completed_at', attempt.completed_at
          )
        FROM public.quiz_attempts AS attempt
        LEFT JOIN public.quiz_publications AS publication ON publication.id = attempt.publication_id
        WHERE attempt.user_id = p_user_id
        UNION ALL
        SELECT COALESCE(attempt.completed_at, attempt.started_at), attempt.id::text,
          jsonb_build_object(
            'section', 'tests', 'kind', 'lightning_quiz', 'id', attempt.id::text,
            'at', COALESCE(attempt.completed_at, attempt.started_at),
            'question_id', attempt.question_id, 'rise_date', question.rise_date,
            'is_correct', attempt.is_correct, 'elapsed_ms', attempt.elapsed_ms,
            'started_at', attempt.started_at, 'completed_at', attempt.completed_at
          )
        FROM public.lightning_quiz_attempts AS attempt
        LEFT JOIN public.lightning_quiz_questions AS question ON question.id = attempt.question_id
        WHERE attempt.user_id = p_user_id
      ) AS tests
      WHERE p_cursor_at IS NULL OR tests.at < p_cursor_at OR (tests.at = p_cursor_at AND tests.id < p_cursor_id)
      ORDER BY tests.at DESC, tests.id DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'vouchers' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT voucher.issued_at AS at, voucher.id::text AS id,
        jsonb_build_object(
          'section', 'vouchers', 'id', voucher.id::text, 'at', voucher.issued_at,
          'week_start', voucher.week_start, 'rise_date', voucher.rise_date, 'rank', voucher.rank,
          'amount', voucher.amount, 'code', voucher.code, 'expires_on', voucher.expires_on,
          'redeemed_at', voucher.redeemed_at, 'redeemed_via', voucher.redeemed_via, 'voided_at', voucher.voided_at
        ) AS item
      FROM public.lightning_quiz_vouchers AS voucher
      WHERE voucher.user_id = p_user_id
        AND (p_cursor_at IS NULL OR voucher.issued_at < p_cursor_at OR (voucher.issued_at = p_cursor_at AND voucher.id::text < p_cursor_id))
      ORDER BY voucher.issued_at DESC, voucher.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'reports' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT report.created_at AS at, report.id::text AS id,
        jsonb_build_object(
          'section', 'reports', 'id', report.id::text, 'at', report.created_at,
          'category', report.category, 'status', report.status, 'description', left(report.description, 200),
          'last_message_at', report.last_message_at, 'closed_at', report.closed_at
        ) AS item
      FROM public.issue_reports AS report
      WHERE report.user_id = p_user_id
        AND (p_cursor_at IS NULL OR report.created_at < p_cursor_at OR (report.created_at = p_cursor_at AND report.id::text < p_cursor_id))
      ORDER BY report.created_at DESC, report.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSE
    RAISE EXCEPTION 'unknown_section' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(v_items, '[]'::jsonb);
END;
$admin_api_section_items$;
REVOKE ALL ON FUNCTION public._admin_api_section_items(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_api_section_items(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;

-- ── 8. user_section：單一區塊分頁 ─────────────────────────────────────────────
-- 回 { items, next_cursor: { at, id } | null }。多抓一筆判斷還有沒有下一頁。
CREATE OR REPLACE FUNCTION public.admin_api_user_section(
  p_user_id UUID,
  p_section TEXT,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_section$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_items JSONB;
  v_last JSONB;
BEGIN
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
  END IF;
  v_items := public._admin_api_section_items(p_user_id, p_section, p_cursor_at, p_cursor_id, v_limit + 1);
  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_last := v_items -> (v_limit - 1);
    RETURN jsonb_build_object('items', v_items, 'next_cursor', jsonb_build_object('at', v_last -> 'at', 'id', v_last -> 'id'));
  END IF;
  RETURN jsonb_build_object('items', v_items, 'next_cursor', NULL);
END;
$admin_api_user_section$;
REVOKE ALL ON FUNCTION public.admin_api_user_section(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_section(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;

-- ── 9. user_timeline：各區塊合成時間軸 ────────────────────────────────────────
-- 每個區塊各取游標之前最新的 limit+1 筆再合併取前 limit 筆（k 路合併），結果跟全部 UNION 後排序相同。
CREATE OR REPLACE FUNCTION public.admin_api_user_timeline(
  p_user_id UUID,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_timeline$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
  v_items JSONB;
  v_last JSONB;
BEGIN
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(merged.item ORDER BY merged.at DESC, merged.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT part.item, (part.item ->> 'at')::timestamptz AS at, part.item ->> 'id' AS id
    FROM unnest(ARRAY['reading_logs', 'team_events', 'tests', 'vouchers', 'reports']) AS section(name)
    CROSS JOIN LATERAL jsonb_array_elements(
      public._admin_api_section_items(p_user_id, section.name, p_cursor_at, p_cursor_id, v_limit + 1)
    ) AS part(item)
    ORDER BY at DESC, id DESC
    LIMIT v_limit + 1
  ) AS merged;
  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_last := v_items -> (v_limit - 1);
    RETURN jsonb_build_object('items', v_items, 'next_cursor', jsonb_build_object('at', v_last -> 'at', 'id', v_last -> 'id'));
  END IF;
  RETURN jsonb_build_object('items', v_items, 'next_cursor', NULL);
END;
$admin_api_user_timeline$;
REVOKE ALL ON FUNCTION public.admin_api_user_timeline(UUID, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_timeline(UUID, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;

-- ── 10. user_summary：打開某人（一次往返）＋ view_user 稽核 ────────────────────
-- 找不到人回 NULL，並記一筆 error。
CREATE OR REPLACE FUNCTION public.admin_api_user_summary(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_summary$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_role public.role_definitions%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    PERFORM audit.record('admin-api', 'view_user', 'error', p_actor_id, p_actor_role, 'profiles',
      p_user_id, p_user_id::text, NULL, p_reason, p_request_id, jsonb_build_object('error', 'user_not_found'));
    RETURN NULL;
  END IF;
  SELECT * INTO v_role FROM public.role_definitions WHERE id = v_profile.role_id;

  v_result := jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'email_masked', public.admin_api_mask_email(v_profile.email),
      'phone_masked', public.admin_api_mask_phone(v_profile.phone),
      'has_email', v_profile.email IS NOT NULL AND btrim(v_profile.email) <> '',
      'has_phone', v_profile.phone IS NOT NULL AND btrim(v_profile.phone) <> '',
      'avatar_url', v_profile.avatar_url,
      'is_active', v_profile.is_active,
      'role_code', COALESCE(v_role.code, 'member'),
      'role_label', v_role.label,
      'created_at', v_profile.created_at,
      'last_seen_at', v_profile.last_seen_at,
      'has_member_hub_id', v_profile.nlc_member_id IS NOT NULL,
      'managed_regions', v_profile.managed_regions,
      'managed_zones', v_profile.managed_zones,
      'managed_groups', v_profile.managed_groups
    ),
    'identities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'provider', identity.provider,
        'email_masked', public.admin_api_mask_email(identity.email),
        'is_primary', identity.is_primary,
        'created_at', identity.created_at,
        'last_seen_at', identity.last_seen_at
      ) ORDER BY identity.is_primary DESC, identity.created_at)
      FROM public.user_identities AS identity
      WHERE identity.profile_id = p_user_id
    ), '[]'::jsonb),
    'org', jsonb_build_object(
      'great_region', v_profile.great_region, 'great_region_id', v_profile.great_region_id,
      'pastoral_zone', v_profile.pastoral_zone, 'pastoral_zone_id', v_profile.pastoral_zone_id,
      'small_group', v_profile.small_group, 'small_group_id', v_profile.small_group_id
    ),
    'member_hub', jsonb_build_object(
      'synced_at', v_profile.member_context_synced_at,
      'sync_attempted_at', v_profile.member_context_sync_attempted_at,
      'sync_status', v_profile.member_context_sync_status,
      'sync_error', v_profile.member_context_sync_error,
      'contract_version', v_profile.member_context_contract_version,
      'membership_lifecycle_state', v_profile.member_context_membership_lifecycle_state,
      'placement_state', v_profile.member_context_placement_state,
      'placement_workflow_state', v_profile.member_context_placement_workflow_state,
      'has_required_placement', v_profile.member_context_has_required_placement,
      'required_action', v_profile.member_context_required_action,
      'leadership_display_label', v_profile.member_context_leadership_display_label
    ),
    'plans', COALESCE((
      SELECT jsonb_agg(plan_rows.item ORDER BY plan_rows.sort_start DESC NULLS LAST, plan_rows.plan_id)
      FROM (
        SELECT plan.id AS plan_id,
          COALESCE(global_plan.start_date, plan.start_date) AS sort_start,
          jsonb_build_object(
            'plan_id', plan.id,
            'global_plan_id', plan.global_plan_id,
            'name', COALESCE(global_plan.name, plan.name),
            'plan_kind', global_plan.plan_kind,
            'is_personal', plan.is_personal,
            'preset_key', plan.preset_key,
            'start_date', plan.start_date,
            'end_date', plan.end_date,
            'church_start_date', global_plan.start_date,
            'church_end_date', global_plan.end_date,
            'target_books', to_jsonb(COALESCE(global_plan.target_books, plan.target_books)),
            'current_round', plan.current_round,
            'current_round_started_at', plan.current_round_started_at,
            'grace_days', global_plan.grace_days,
            'joined_at', plan.created_at,
            'round1_chapters', stats.round1_chapters,
            'current_round_chapters', stats.current_round_chapters,
            'logged_chapters', stats.logged_chapters,
            'last_read_at', stats.last_read_at,
            'teams', COALESCE(teams.items, '[]'::jsonb)
          ) AS item
        FROM public.reading_plans AS plan
        LEFT JOIN public.global_plans AS global_plan ON global_plan.id = plan.global_plan_id
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE log.round = 1) AS round1_chapters,
                 count(*) FILTER (WHERE log.round = plan.current_round) AS current_round_chapters,
                 count(*) AS logged_chapters,
                 max(log.read_at) AS last_read_at
          FROM public.reading_logs AS log
          WHERE log.user_id = p_user_id AND log.plan_id = plan.id
        ) AS stats ON TRUE
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', team.id, 'name', team.name, 'status', team.status, 'division', member.division,
            'member_role', member.member_role, 'joined_at', member.joined_at, 'is_captain', team.captain_id = p_user_id
          ) ORDER BY member.division) AS items
          FROM public.reading_team_members AS member
          JOIN public.reading_teams AS team ON team.id = member.team_id
          WHERE member.user_id = p_user_id AND member.global_plan_id = plan.global_plan_id
        ) AS teams ON TRUE
        WHERE plan.user_id = p_user_id
        ORDER BY sort_start DESC NULLS LAST, plan.id
        LIMIT 50
      ) AS plan_rows
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'reading_logs', (SELECT count(*) FROM public.reading_logs WHERE user_id = p_user_id),
      'team_events', (SELECT count(*) FROM public.reading_team_member_events WHERE user_id = p_user_id),
      'tests', (SELECT count(*) FROM public.exam_attempts WHERE user_id = p_user_id)
             + (SELECT count(*) FROM public.quiz_attempts WHERE user_id = p_user_id)
             + (SELECT count(*) FROM public.lightning_quiz_attempts WHERE user_id = p_user_id),
      'vouchers', (SELECT count(*) FROM public.lightning_quiz_vouchers WHERE user_id = p_user_id),
      'reports', (SELECT count(*) FROM public.issue_reports WHERE user_id = p_user_id)
    ),
    'latest', jsonb_build_object(
      'reading_logs', public._admin_api_section_items(p_user_id, 'reading_logs', NULL, NULL, 5),
      'team_events', public._admin_api_section_items(p_user_id, 'team_events', NULL, NULL, 5),
      'tests', public._admin_api_section_items(p_user_id, 'tests', NULL, NULL, 5),
      'vouchers', public._admin_api_section_items(p_user_id, 'vouchers', NULL, NULL, 5),
      'reports', public._admin_api_section_items(p_user_id, 'reports', NULL, NULL, 5)
    )
  );

  PERFORM audit.record('admin-api', 'view_user', 'ok', p_actor_id, p_actor_role, 'profiles',
    p_user_id, p_user_id::text, NULL, p_reason, p_request_id, NULL);
  RETURN v_result;
END;
$admin_api_user_summary$;
REVOKE ALL ON FUNCTION public.admin_api_user_summary(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_summary(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ── 11. reveal_pii：完整 email／電話＋ reveal_pii 稽核 ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_reveal_pii(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_reveal_pii$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'email', profile.email,
    'phone', profile.phone,
    'identities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('provider', identity.provider, 'email', identity.email, 'is_primary', identity.is_primary)
        ORDER BY identity.is_primary DESC, identity.created_at)
      FROM public.user_identities AS identity
      WHERE identity.profile_id = profile.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;

  PERFORM audit.record('admin-api', 'reveal_pii', CASE WHEN v_result IS NULL THEN 'error' ELSE 'ok' END,
    p_actor_id, p_actor_role, 'profiles', p_user_id, p_user_id::text, NULL, p_reason, p_request_id,
    CASE WHEN v_result IS NULL THEN jsonb_build_object('error', 'user_not_found') END);
  RETURN v_result;
END;
$admin_api_reveal_pii$;
REVOKE ALL ON FUNCTION public.admin_api_reveal_pii(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_reveal_pii(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;
