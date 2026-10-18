-- #550 第二組（帳號與權限）：後台的使用者名單與管理範圍，admin-api 的 directory_* / scope_* / org_export 用。
--
-- 以前在 App 的管理分頁：使用者名單把全部 profiles＋所有報名＋所有隊伍抓回瀏覽器再篩，CSV 在瀏覽器組、
-- 不記稽核；管理範圍經 nlc-data 呼叫 set_profile_managed_scopes，稽核是事後補記（#549 best-effort）；
-- 讀管理範圍名單時甚至會順手寫回預設值。後台改成：
--
--   admin_api_enrollment_plan_id(gp, pk)  報名列 → 計畫 id（舊列只有 preset_key；規則同 js/modules/admin-user-directory-filter.mjs）
--   admin_api_directory_rows(...)         篩選後的名單（名單與匯出共用；排序＝大區、牧區的 sort_order，再姓名、id）
--   admin_api_directory_list(...)         名單一頁（offset 分頁，email 遮罩）＋總數；第一頁附計畫選項與預設計畫
--   admin_api_directory_export(...)       匯出用的完整資料（含完整 email，最多 10000 筆）＋ export 稽核
--   admin_api_scope_overview()            有管理職責的人（角色不是一般會友、帳號啟用中）與目前的 managed_*；唯讀、不回寫
--   admin_api_scope_set(...)              改管理範圍：呼叫既有的 set_profile_managed_scopes（驗證組織名稱、只留符合角色的欄位）
--                                         ＋同一個交易內寫 set_profile_managed_scopes 稽核（前後值）
--   admin_api_org_export(...)             組織架構 CSV 的資料（依 sort_order）＋ export 稽核
--
-- 角色不在這裡改：角色由會員中心同步，後台只顯示。
-- 全部只給 service_role；誰能呼叫由 admin-api 的能力表決定（accounts.read / accounts.write / export / support.pii）。
-- 依賴 #549（audit schema）、#547（admin_api_mask_email）、20261008033603（set_profile_managed_scopes 的檢查）。
-- 不改任何既有函式，會友 App 與 App 的管理分頁不受影響。

-- ── 1. 報名列 → 計畫 ─────────────────────────────────────────────────────────
-- global_plan_id 優先；舊列只有 preset_key 時，對 global_plans.rules.presetKey、計畫 id，
-- 最後是正式階段的 church_stage_NN（id 尾 12 碼是階段序）。個人計畫兩欄都是 NULL → NULL。
CREATE OR REPLACE FUNCTION public.admin_api_enrollment_plan_id(p_global_plan_id UUID, p_preset_key TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_enrollment_plan_id$
  SELECT COALESCE(
    p_global_plan_id,
    (SELECT plan.id FROM public.global_plans AS plan
      WHERE NULLIF(btrim(p_preset_key), '') IS NOT NULL
        AND (plan.rules ->> 'presetKey' = btrim(p_preset_key) OR plan.id::text = btrim(p_preset_key))
      ORDER BY (plan.rules ->> 'presetKey' = btrim(p_preset_key)) DESC NULLS LAST, plan.id
      LIMIT 1),
    CASE WHEN btrim(COALESCE(p_preset_key, '')) ~ '^church_stage_[0-9]{2}$'
      THEN ('00000000-0000-0000-c026-' || lpad((right(btrim(p_preset_key), 2))::int::text, 12, '0'))::uuid
    END
  );
$admin_api_enrollment_plan_id$;
REVOKE ALL ON FUNCTION public.admin_api_enrollment_plan_id(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_enrollment_plan_id(UUID, TEXT) TO service_role;

-- ── 2. 篩選後的名單（名單與匯出共用）───────────────────────────────────────────
-- 組織篩選：陣列空＝不篩；'__unassigned__' 代表該欄沒填（同 App 的 ADMIN_ORG_UNASSIGNED）。
-- p_participation／p_team：'all' | 'joined' | 'not_joined'（同 App）。「未加入」是拿來邀請的：
-- 停用帳號與管理員本人不列。p_incomplete：只看姓名或牧區沒填的。
-- p_q：比對姓名、email、角色、大區、牧區、小組、所選計畫的隊名（不分大小寫，% _ \ 當一般字元）。
CREATE OR REPLACE FUNCTION public.admin_api_directory_rows(
  p_actor_id UUID,
  p_q TEXT DEFAULT NULL,
  p_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_plan_id UUID DEFAULT NULL,
  p_participation TEXT DEFAULT 'all',
  p_team TEXT DEFAULT 'all',
  p_incomplete BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  great_region TEXT,
  pastoral_zone TEXT,
  small_group TEXT,
  is_active BOOLEAN,
  sync_status TEXT,
  synced_at TIMESTAMPTZ,
  role_code TEXT,
  role_label TEXT,
  managed_regions TEXT,
  managed_zones TEXT,
  managed_groups TEXT,
  joined BOOLEAN,
  teams JSONB,
  sort_region INTEGER,
  sort_zone INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_rows$
  WITH enrolled AS (
    SELECT DISTINCT plan.user_id
    FROM public.reading_plans AS plan
    WHERE p_plan_id IS NOT NULL
      AND (plan.global_plan_id = p_plan_id
        OR (plan.global_plan_id IS NULL AND plan.preset_key IS NOT NULL
          AND public.admin_api_enrollment_plan_id(NULL, plan.preset_key) = p_plan_id))
  ),
  plan_teams AS (
    SELECT member.user_id,
      jsonb_agg(jsonb_build_object('name', team.name, 'role', member.member_role) ORDER BY member.team_id) AS teams,
      string_agg(COALESCE(team.name, ''), ' ') AS team_text
    FROM public.reading_team_members AS member
    LEFT JOIN public.reading_teams AS team ON team.id = member.team_id
    WHERE p_plan_id IS NOT NULL AND member.global_plan_id = p_plan_id
    GROUP BY member.user_id
  ),
  base AS (
    SELECT
      profile.id, profile.name, profile.email,
      NULLIF(btrim(profile.great_region), '') AS great_region,
      NULLIF(btrim(profile.pastoral_zone), '') AS pastoral_zone,
      NULLIF(btrim(profile.small_group), '') AS small_group,
      profile.is_active,
      profile.member_context_sync_status AS sync_status,
      profile.member_context_synced_at AS synced_at,
      COALESCE(role.code, 'member') AS role_code,
      role.label AS role_label,
      COALESCE(profile.managed_regions, '') AS managed_regions,
      COALESCE(profile.managed_zones, '') AS managed_zones,
      COALESCE(profile.managed_groups, '') AS managed_groups,
      (enrolled.user_id IS NOT NULL) AS joined,
      COALESCE(plan_teams.teams, '[]'::jsonb) AS teams,
      COALESCE(plan_teams.team_text, '') AS team_text,
      region.sort_order AS sort_region,
      -- 牧區名稱只在同一個大區內唯一：用子查詢取排序，不 JOIN，免得同名牧區把人重複列出
      (SELECT min(zone.sort_order) FROM public.pastoral_zones AS zone
        WHERE zone.name = NULLIF(btrim(profile.pastoral_zone), '')
          AND (region.id IS NULL OR zone.great_region_id = region.id)) AS sort_zone
    FROM public.profiles AS profile
    LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
    LEFT JOIN enrolled ON enrolled.user_id = profile.id
    LEFT JOIN plan_teams ON plan_teams.user_id = profile.id
    LEFT JOIN public.great_regions AS region ON region.name = NULLIF(btrim(profile.great_region), '')
  )
  SELECT
    base.id, base.name, base.email, base.great_region, base.pastoral_zone, base.small_group,
    base.is_active, base.sync_status, base.synced_at, base.role_code, base.role_label,
    base.managed_regions, base.managed_zones, base.managed_groups,
    base.joined, base.teams, base.sort_region, base.sort_zone
  FROM base
  WHERE (cardinality(COALESCE(p_regions, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.great_region, '__unassigned__') = ANY (p_regions))
    AND (cardinality(COALESCE(p_zones, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.pastoral_zone, '__unassigned__') = ANY (p_zones))
    AND (cardinality(COALESCE(p_groups, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.small_group, '__unassigned__') = ANY (p_groups))
    AND (NOT COALESCE(p_incomplete, FALSE)
      OR NULLIF(btrim(COALESCE(base.name, '')), '') IS NULL OR base.pastoral_zone IS NULL)
    AND (COALESCE(p_participation, 'all') = 'all'
      OR (p_participation = 'joined' AND base.joined)
      OR (p_participation = 'not_joined' AND NOT base.joined
        AND base.is_active IS TRUE AND base.id IS DISTINCT FROM p_actor_id))
    AND (COALESCE(p_team, 'all') = 'all'
      OR (p_team = 'joined' AND jsonb_array_length(base.teams) > 0)
      OR (p_team = 'not_joined' AND jsonb_array_length(base.teams) = 0))
    AND (NULLIF(btrim(COALESCE(p_q, '')), '') IS NULL
      OR lower(concat_ws(' ', base.name, base.email, COALESCE(base.role_label, CASE WHEN base.role_code = 'member' THEN '一般會友' ELSE base.role_code END),
          base.great_region, base.pastoral_zone, base.small_group, base.team_text))
        LIKE '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%');
$admin_api_directory_rows$;
REVOKE ALL ON FUNCTION public.admin_api_directory_rows(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_rows(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN) TO service_role;

-- ── 3. 名單一頁 ───────────────────────────────────────────────────────────────
-- 第一頁（p_offset = 0）附：計畫選項（未隱藏、不是教會階段規則設定）、沒指定計畫時的預設計畫
-- （進行中取最晚開始的 → 尚未開始取最早開始的 → 最晚結束的；規則同 App 的報名統計）、全部人數。
CREATE OR REPLACE FUNCTION public.admin_api_directory_list(
  p_actor_id UUID,
  p_q TEXT DEFAULT NULL,
  p_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_plan_id UUID DEFAULT NULL,
  p_participation TEXT DEFAULT 'all',
  p_team TEXT DEFAULT 'all',
  p_incomplete BOOLEAN DEFAULT FALSE,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_list$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_plan_id UUID := p_plan_id;
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_items JSONB;
  v_total BIGINT;
  v_plans JSONB;
BEGIN
  IF p_participation NOT IN ('all', 'joined', 'not_joined') OR p_team NOT IN ('all', 'joined', 'not_joined') THEN
    RAISE EXCEPTION 'invalid_plan_filter' USING ERRCODE = '22023';
  END IF;

  IF v_offset = 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', plan.id, 'name', plan.name, 'start_date', plan.start_date, 'end_date', plan.end_date, 'plan_kind', plan.plan_kind
      ) ORDER BY plan.start_date NULLS LAST, plan.name), '[]'::jsonb)
    INTO v_plans
    FROM public.global_plans AS plan
    WHERE NOT COALESCE(plan.is_hidden, FALSE) AND COALESCE(plan.plan_kind, 'standard') <> 'church_campaign';
  END IF;

  IF v_plan_id IS NULL THEN
    SELECT plan.id INTO v_plan_id
    FROM public.global_plans AS plan
    WHERE NOT COALESCE(plan.is_hidden, FALSE) AND COALESCE(plan.plan_kind, 'standard') <> 'church_campaign'
    ORDER BY
      CASE WHEN plan.start_date <= v_today AND (plan.end_date IS NULL OR v_today <= plan.end_date) THEN 0
           WHEN plan.start_date > v_today THEN 1
           ELSE 2 END,
      CASE WHEN plan.start_date <= v_today AND (plan.end_date IS NULL OR v_today <= plan.end_date) THEN plan.start_date END DESC NULLS LAST,
      CASE WHEN plan.start_date > v_today THEN plan.start_date END ASC NULLS LAST,
      plan.end_date DESC NULLS LAST,
      plan.id
    LIMIT 1;
  END IF;

  WITH page AS (
    SELECT dir.*, count(*) OVER () AS total
    FROM public.admin_api_directory_rows(p_actor_id, p_q, p_regions, p_zones, p_groups, v_plan_id,
      p_participation, p_team, p_incomplete) AS dir
    ORDER BY dir.sort_region NULLS LAST, dir.great_region NULLS LAST, dir.sort_zone NULLS LAST, dir.pastoral_zone NULLS LAST,
      dir.name NULLS LAST, dir.id
    OFFSET v_offset LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', page.id, 'name', page.name, 'email_masked', public.admin_api_mask_email(page.email),
      'great_region', page.great_region, 'pastoral_zone', page.pastoral_zone, 'small_group', page.small_group,
      'is_active', page.is_active, 'sync_status', page.sync_status, 'synced_at', page.synced_at,
      'role_code', page.role_code, 'role_label', page.role_label,
      'managed_regions', page.managed_regions, 'managed_zones', page.managed_zones, 'managed_groups', page.managed_groups,
      'joined', page.joined, 'teams', page.teams
    ) ORDER BY page.sort_region NULLS LAST, page.great_region NULLS LAST, page.sort_zone NULLS LAST, page.pastoral_zone NULLS LAST,
      page.name NULLS LAST, page.id), '[]'::jsonb),
    max(page.total)
  INTO v_items, v_total
  FROM page;

  IF v_total IS NULL THEN
    -- 這一頁沒有資料（超過最後一頁或沒有符合的人）：另外算總數
    SELECT count(*) INTO v_total
    FROM public.admin_api_directory_rows(p_actor_id, p_q, p_regions, p_zones, p_groups, v_plan_id,
      p_participation, p_team, p_incomplete);
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'next_offset', CASE WHEN v_offset + jsonb_array_length(v_items) < v_total THEN v_offset + jsonb_array_length(v_items) END,
    'plan_id', v_plan_id,
    'plans', v_plans,
    'all_count', CASE WHEN v_offset = 0 THEN (SELECT count(*) FROM public.profiles) END
  );
END;
$admin_api_directory_list$;
REVOKE ALL ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO service_role;

-- ── 4. 名單匯出 ───────────────────────────────────────────────────────────────
-- 含完整 email（admin-api 要求 support.pii＋export）；最多 10000 筆。稽核記篩選條件與筆數，不記名單內容。
CREATE OR REPLACE FUNCTION public.admin_api_directory_export(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_q TEXT,
  p_regions TEXT[],
  p_zones TEXT[],
  p_groups TEXT[],
  p_plan_id UUID,
  p_participation TEXT,
  p_team TEXT,
  p_incomplete BOOLEAN,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_export$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
  v_plan_name TEXT;
  v_max CONSTANT INTEGER := 10000;
BEGIN
  IF p_participation NOT IN ('all', 'joined', 'not_joined') OR p_team NOT IN ('all', 'joined', 'not_joined') THEN
    RAISE EXCEPTION 'invalid_plan_filter' USING ERRCODE = '22023';
  END IF;
  IF p_plan_id IS NOT NULL THEN
    SELECT plan.name INTO v_plan_name FROM public.global_plans AS plan WHERE plan.id = p_plan_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'plan_not_found' USING ERRCODE = '22023';
    END IF;
  END IF;

  WITH page AS (
    SELECT dir.*, count(*) OVER () AS total
    FROM public.admin_api_directory_rows(p_actor_id, p_q, p_regions, p_zones, p_groups, p_plan_id,
      p_participation, p_team, p_incomplete) AS dir
    ORDER BY dir.sort_region NULLS LAST, dir.great_region NULLS LAST, dir.sort_zone NULLS LAST, dir.pastoral_zone NULLS LAST,
      dir.name NULLS LAST, dir.id
    LIMIT v_max
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', page.name, 'email', page.email,
      'great_region', page.great_region, 'pastoral_zone', page.pastoral_zone, 'small_group', page.small_group,
      'role_code', page.role_code, 'role_label', page.role_label, 'is_active', page.is_active, 'teams', page.teams
    ) ORDER BY page.sort_region NULLS LAST, page.great_region NULLS LAST, page.sort_zone NULLS LAST, page.pastoral_zone NULLS LAST,
      page.name NULLS LAST, page.id), '[]'::jsonb),
    COALESCE(max(page.total), 0)
  INTO v_rows, v_total
  FROM page;

  PERFORM audit.record('admin-api', 'export', 'ok', p_actor_id, p_actor_role, 'profiles',
    NULL, NULL, NULL, NULL, p_request_id,
    jsonb_build_object(
      'kind', 'user_directory',
      'rows', jsonb_array_length(v_rows),
      'truncated', v_total > v_max,
      'filters', jsonb_build_object(
        'q', NULLIF(btrim(COALESCE(p_q, '')), ''),
        'regions', to_jsonb(COALESCE(p_regions, ARRAY[]::TEXT[])),
        'zones', to_jsonb(COALESCE(p_zones, ARRAY[]::TEXT[])),
        'groups', to_jsonb(COALESCE(p_groups, ARRAY[]::TEXT[])),
        'plan_id', p_plan_id,
        'participation', p_participation,
        'team', p_team,
        'incomplete', COALESCE(p_incomplete, FALSE)
      )
    ));

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'truncated', v_total > v_max, 'plan_name', v_plan_name);
END;
$admin_api_directory_export$;
REVOKE ALL ON FUNCTION public.admin_api_directory_export(UUID, TEXT, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_export(UUID, TEXT, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- ── 5. 管理範圍總覽 ───────────────────────────────────────────────────────────
-- 有管理職責的人：帳號啟用中、角色不是一般會友。managed_* 原樣回（逗號分隔 → 陣列）；
-- 「沒設定時用本人歸屬」的有效範圍由前端算（admin/src/scopes.ts，規則同 App）。不像 App 那樣讀的時候回寫。
CREATE OR REPLACE FUNCTION public.admin_api_scope_overview()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_scope_overview$
  SELECT jsonb_build_object('leaders', COALESCE(jsonb_agg(jsonb_build_object(
      'id', profile.id, 'name', profile.name, 'email_masked', public.admin_api_mask_email(profile.email),
      'role_code', role.code, 'role_label', role.label,
      'great_region', NULLIF(btrim(profile.great_region), ''),
      'pastoral_zone', NULLIF(btrim(profile.pastoral_zone), ''),
      'small_group', NULLIF(btrim(profile.small_group), ''),
      'managed_regions', COALESCE((SELECT jsonb_agg(btrim(value)) FROM unnest(string_to_array(profile.managed_regions, ',')) AS value WHERE btrim(value) <> ''), '[]'::jsonb),
      'managed_zones', COALESCE((SELECT jsonb_agg(btrim(value)) FROM unnest(string_to_array(profile.managed_zones, ',')) AS value WHERE btrim(value) <> ''), '[]'::jsonb),
      'managed_groups', COALESCE((SELECT jsonb_agg(btrim(value)) FROM unnest(string_to_array(profile.managed_groups, ',')) AS value WHERE btrim(value) <> ''), '[]'::jsonb)
    ) ORDER BY profile.name NULLS LAST, profile.id), '[]'::jsonb))
  FROM public.profiles AS profile
  JOIN public.role_definitions AS role ON role.id = profile.role_id
  WHERE profile.is_active IS TRUE AND role.code IS DISTINCT FROM 'member';
$admin_api_scope_overview$;
REVOKE ALL ON FUNCTION public.admin_api_scope_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_scope_overview() TO service_role;

-- ── 6. 改管理範圍 ─────────────────────────────────────────────────────────────
-- 只有大區長／區長／小組長能設定（其他角色固定全教會或只有本人，清空它們沒有意義、只會誤刪）。
-- 實際寫入交給既有的 set_profile_managed_scopes（組織名稱不存在就拒絕、只保留符合角色的欄位），
-- 它的錯誤轉成 22023 讓 admin-api 回 400。前後值寫進稽核（action 和 nlc-data 路徑同名，查詢時一起看）。
CREATE OR REPLACE FUNCTION public.admin_api_scope_set(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_profile_id UUID,
  p_regions TEXT[],
  p_zones TEXT[],
  p_groups TEXT[],
  p_reason TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_scope_set$
DECLARE
  v_before RECORD;
  v_result JSONB;
  v_after_regions TEXT;
  v_after_zones TEXT;
  v_after_groups TEXT;
  v_changes JSONB := '{}'::jsonb;
BEGIN
  SELECT profile.managed_regions, profile.managed_zones, profile.managed_groups, role.code AS role_code
  INTO v_before
  FROM public.profiles AS profile
  LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
  WHERE profile.id = p_profile_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_before.role_code IS NULL OR v_before.role_code NOT IN ('great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'scope_not_applicable' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_result := public.set_profile_managed_scopes(p_profile_id, p_regions, p_zones, p_groups, p_actor_id);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IN ('managed_scope_unknown_region', 'managed_scope_unknown_zone', 'managed_scope_unknown_group') THEN
      RAISE EXCEPTION '%', SQLERRM USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;

  v_after_regions := array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_result -> 'managedRegions')), ',');
  v_after_zones := array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_result -> 'managedZones')), ',');
  v_after_groups := array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_result -> 'managedGroups')), ',');
  IF COALESCE(v_before.managed_regions, '') IS DISTINCT FROM v_after_regions THEN
    v_changes := v_changes || jsonb_build_object('managed_regions', jsonb_build_object('before', COALESCE(v_before.managed_regions, ''), 'after', v_after_regions));
  END IF;
  IF COALESCE(v_before.managed_zones, '') IS DISTINCT FROM v_after_zones THEN
    v_changes := v_changes || jsonb_build_object('managed_zones', jsonb_build_object('before', COALESCE(v_before.managed_zones, ''), 'after', v_after_zones));
  END IF;
  IF COALESCE(v_before.managed_groups, '') IS DISTINCT FROM v_after_groups THEN
    v_changes := v_changes || jsonb_build_object('managed_groups', jsonb_build_object('before', COALESCE(v_before.managed_groups, ''), 'after', v_after_groups));
  END IF;

  PERFORM audit.record('admin-api', 'set_profile_managed_scopes', 'ok', p_actor_id, p_actor_role, 'profiles',
    p_profile_id, p_profile_id::text, v_changes, p_reason, p_request_id,
    jsonb_build_object('role_code', v_before.role_code, 'changed', v_changes <> '{}'::jsonb));

  RETURN jsonb_build_object(
    'profile_id', p_profile_id,
    'role_code', v_before.role_code,
    'managed_regions', COALESCE(v_result -> 'managedRegions', '[]'::jsonb),
    'managed_zones', COALESCE(v_result -> 'managedZones', '[]'::jsonb),
    'managed_groups', COALESCE(v_result -> 'managedGroups', '[]'::jsonb)
  );
END;
$admin_api_scope_set$;
REVOKE ALL ON FUNCTION public.admin_api_scope_set(UUID, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_scope_set(UUID, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT, TEXT) TO service_role;

-- ── 7. 組織架構匯出 ───────────────────────────────────────────────────────────
-- 每列 [大區, 牧區, 小組]；沒有下屬的單位照 App 的寫法補「無下屬牧區」「無下屬小組」。
CREATE OR REPLACE FUNCTION public.admin_api_org_export(p_actor_id UUID, p_actor_role TEXT, p_request_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_org_export$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_array(line.region, line.zone, line.grp) ORDER BY line.r_sort, line.region, line.z_sort, line.zone, line.g_sort, line.grp), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT region.name AS region, region.sort_order AS r_sort,
      COALESCE(zone.name, '無下屬牧區') AS zone, zone.sort_order AS z_sort,
      COALESCE(grp.name, '無下屬小組') AS grp, grp.sort_order AS g_sort
    FROM public.great_regions AS region
    LEFT JOIN public.pastoral_zones AS zone ON zone.great_region_id = region.id
    LEFT JOIN public.small_groups AS grp ON grp.pastoral_zone_id = zone.id
  ) AS line;

  PERFORM audit.record('admin-api', 'export', 'ok', p_actor_id, p_actor_role, 'org_structure',
    NULL, NULL, NULL, NULL, p_request_id,
    jsonb_build_object('kind', 'org_structure', 'rows', jsonb_array_length(v_rows)));

  RETURN jsonb_build_object('rows', v_rows);
END;
$admin_api_org_export$;
REVOKE ALL ON FUNCTION public.admin_api_org_export(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_org_export(UUID, TEXT, TEXT) TO service_role;
