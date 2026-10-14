-- #566 後台隊伍除錯：隊伍清單（附每隊的除錯檢查）、隊伍頁、異動歷程、跨階段對應、用隊名／邀請碼找隊伍。
--
-- 這裡只回「事實」；檢查（狀態對人數、超額、隊長、成員未報名、重複入隊、結束後異動）、
-- 「會友 App 應該顯示」（隊伍進度、邀請碼、帶隊按鈕）、加入方式與異動的白話說明，
-- 都由 admin-api 執行 supabase/functions/_shared/progress/team-report.mjs（和會友 App 同一份規則）。
--
-- 1. admin_api_team_list：計畫 → 團隊分頁打開時一次拿齊（每隊＋成員＋成員的報名進度），記 view_plan_teams。
-- 2. admin_api_team_info：隊伍屬於哪個計畫（admin-api 要先從計畫推出 preset key，同 plan_summary）。
-- 3. admin_api_team_detail：隊伍頁一次拿齊（基本資料、成員與加入方式、成員進度、帶隊到下一階段的條件），記 view_team。
-- 4. admin_api_team_history：異動歷程（點開才調閱）。來源是 0149 的兩張事件表；**不回 jwt_claims**。
-- 5. admin_api_team_lineage：跨階段對應（點開才調閱），沿 carried_from_team_id 往前、往後找。
-- 6. admin_api_team_search：用隊名或邀請碼找隊伍（隊名在不同階段會重複，結果附計畫）。
--
-- 全部先在 SQL 依操作者重查是不是系統管理員（admin_api_assert_admin，不是就 42501）；只授權 service_role。
-- 成員的報名進度用 plan_progress_people（和計畫總覽、名單同一個判定），只查這些成員。
-- 依賴：20261013114704_admin_api_plan_progress.sql（admin_api_assert_admin、plan_progress_people）、
--       0149_reading_team_audit.sql（事件表）、20260928101011_carryover_next_plan_by_date.sql
--       （previous_campaign_stage_plan_id、campaign_stage_join_block_reason）、20261010181946_admin_audit_events.sql（audit.record）。

-- ── 共用（內部，不授權給任何角色）───────────────────────────────────────────

-- PG_CONTEXT（呼叫堆疊）→ 經過的函式名稱，由內而外；拿掉稽核觸發器自己。
CREATE OR REPLACE FUNCTION public._admin_api_context_functions(p_context text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(array_agg(fn ORDER BY ord), ARRAY[]::text[])
  FROM (
    SELECT match[1] AS fn, ord
    FROM regexp_matches(COALESCE(p_context, ''), 'function (?:public\.)?([A-Za-z_][A-Za-z0-9_]*)\(', 'g') WITH ORDINALITY AS m(match, ord)
  ) AS found
  WHERE fn NOT LIKE '\_audit\_%';
$function$;
REVOKE ALL ON FUNCTION public._admin_api_context_functions(text) FROM PUBLIC, anon, authenticated, service_role;

-- 隊伍的事實：基本資料、成員（含帳號是否啟用、單位）、成員在同計畫同組別的別隊、階段結束後的異動筆數。
-- p_detail：隊伍頁多回邀請碼、每位成員最近一次被加進這隊的呼叫堆疊（判斷加入方式）。
CREATE OR REPLACE FUNCTION public._admin_api_team_rows(p_team_ids uuid[], p_detail boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', team.id,
      'name', team.name,
      'global_plan_id', team.global_plan_id,
      'division', team.division,
      'status', team.status,
      'captain_id', team.captain_id,
      'captain_name', captain.name,
      'carried_from_team_id', team.carried_from_team_id,
      'created_at', team.created_at,
      'invite_code', CASE WHEN p_detail THEN team.invite_code END,
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'user_id', member.user_id,
            'name', prof.name,
            'member_role', member.member_role,
            'joined_at', member.joined_at,
            'division', member.division,
            'global_plan_id', member.global_plan_id,
            'is_active', prof.is_active IS NOT FALSE,
            'great_region', prof.great_region,
            'pastoral_zone', prof.pastoral_zone,
            'small_group', prof.small_group,
            'joined_via', CASE WHEN p_detail THEN (
              SELECT public._admin_api_context_functions(event.call_context)
              FROM public.reading_team_member_events AS event
              WHERE event.team_id = team.id AND event.user_id = member.user_id AND event.event_type = 'insert'
              ORDER BY event.created_at DESC, event.id DESC
              LIMIT 1
            ) END
          ) ORDER BY (member.member_role = 'captain') DESC, member.joined_at, member.user_id)
        FROM public.reading_team_members AS member
        LEFT JOIN public.profiles AS prof ON prof.id = member.user_id
        WHERE member.team_id = team.id
      ), '[]'::jsonb),
      'elsewhere', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('user_id', other.user_id, 'team_id', other.team_id, 'team_name', other_team.name)
          ORDER BY other.user_id, other.team_id)
        FROM public.reading_team_members AS member
        JOIN public.reading_team_members AS other
          ON other.user_id = member.user_id
         AND other.global_plan_id = team.global_plan_id
         AND other.division = team.division
         AND other.team_id <> team.id
        LEFT JOIN public.reading_teams AS other_team ON other_team.id = other.team_id
        WHERE member.team_id = team.id
      ), '[]'::jsonb),
      'events_after_end', CASE WHEN plan.end_date IS NULL THEN 0 ELSE (
        (SELECT COUNT(*) FROM public.reading_team_member_events AS event
          WHERE event.team_id = team.id AND event.created_at >= ((plan.end_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei'))
        + (SELECT COUNT(*) FROM public.reading_teams_events AS event
          WHERE event.team_id = team.id AND event.event_type <> 'insert'
            AND event.created_at >= ((plan.end_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei'))
      )::int END,
      'last_event_at', CASE WHEN p_detail THEN GREATEST(
        (SELECT MAX(event.created_at) FROM public.reading_team_member_events AS event WHERE event.team_id = team.id),
        (SELECT MAX(event.created_at) FROM public.reading_teams_events AS event WHERE event.team_id = team.id)
      ) END
    ) ORDER BY team.division, team.name, team.id), '[]'::jsonb)
  FROM public.reading_teams AS team
  JOIN public.global_plans AS plan ON plan.id = team.global_plan_id
  LEFT JOIN public.profiles AS captain ON captain.id = team.captain_id
  WHERE team.id = ANY (p_team_ids);
$function$;
REVOKE ALL ON FUNCTION public._admin_api_team_rows(uuid[], boolean) FROM PUBLIC, anon, authenticated, service_role;

-- 計畫欄位（排「教會原始日程」與判斷階段用；同 admin_api_plan_info 的格式）
CREATE OR REPLACE FUNCTION public._admin_api_plan_row(p_global_plan_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', gp.id, 'name', gp.name, 'plan_kind', gp.plan_kind, 'start_date', gp.start_date, 'end_date', gp.end_date,
    'target_books', gp.target_books, 'rules', gp.rules, 'is_hidden', gp.is_hidden
  )
  FROM public.global_plans AS gp
  WHERE gp.id = p_global_plan_id;
$function$;
REVOKE ALL ON FUNCTION public._admin_api_plan_row(uuid) FROM PUBLIC, anon, authenticated, service_role;


-- ── 1. 隊伍清單 ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_team_list(
  p_actor_id uuid,
  p_actor_role text,
  p_global_plan_id uuid,
  p_preset_key text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_team_ids uuid[];
  v_member_ids uuid[];
  v_teams jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM public.global_plans AS plan WHERE plan.id = p_global_plan_id) THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(team.id), ARRAY[]::uuid[]) INTO v_team_ids
  FROM public.reading_teams AS team WHERE team.global_plan_id = p_global_plan_id;
  SELECT COALESCE(array_agg(DISTINCT member.user_id), ARRAY[]::uuid[]) INTO v_member_ids
  FROM public.reading_team_members AS member WHERE member.team_id = ANY (v_team_ids);
  v_teams := public._admin_api_team_rows(v_team_ids, false);

  PERFORM audit.record('admin-api', 'view_plan_teams', 'ok', p_actor_id, p_actor_role, 'reading_teams',
    NULL, p_global_plan_id::text, NULL, NULL, p_request_id,
    jsonb_build_object('teams', jsonb_array_length(v_teams)));

  RETURN jsonb_build_object(
    'today', (now() AT TIME ZONE 'Asia/Taipei')::date,
    'teams', v_teams,
    -- 成員的報名進度：和總覽、名單同一個判定（只查這些成員；停用的帳號不在裡面）
    'people', CASE WHEN cardinality(v_member_ids) = 0 THEN '[]'::jsonb ELSE
      COALESCE((public.plan_progress_people(p_global_plan_id, p_preset_key, false, v_member_ids, p_actor_id)::jsonb) -> 'people', '[]'::jsonb) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_list(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_list(uuid, text, uuid, text, text) TO service_role;


-- ── 2. 隊伍屬於哪個計畫 ──────────────────────────────────────────────────────
-- 找不到回 NULL（admin-api 回 404 team_not_found）
CREATE OR REPLACE FUNCTION public.admin_api_team_info(p_actor_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  RETURN (
    SELECT jsonb_build_object('team_id', team.id, 'plan', public._admin_api_plan_row(team.global_plan_id))
    FROM public.reading_teams AS team
    WHERE team.id = p_team_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_info(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_info(uuid, uuid) TO service_role;


-- ── 3. 隊伍頁 ─────────────────────────────────────────────────────────────
-- next_stages：以這個計畫為「上一階段」的階段計畫（同 get_reading_team_carryover_offer 的條件：
-- 階段類型、沒隱藏、previous_campaign_stage_plan_id 指回這裡），附帶隊要看的事實：
-- 已經帶過去的隊、隊長在那邊同組別已經有隊、隊長被擋的原因、帶隊時會被略過的隊員（同 carry_reading_teams_to_stage 的判定）。
CREATE OR REPLACE FUNCTION public.admin_api_team_detail(
  p_actor_id uuid,
  p_actor_role text,
  p_team_id uuid,
  p_preset_key text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_team record;
  v_member_ids uuid[];
  v_next jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  SELECT team.id, team.global_plan_id, team.division, team.captain_id, team.name INTO v_team
  FROM public.reading_teams AS team WHERE team.id = p_team_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(member.user_id), ARRAY[]::uuid[]) INTO v_member_ids
  FROM public.reading_team_members AS member WHERE member.team_id = v_team.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'plan', jsonb_build_object('id', target.id, 'name', target.name, 'plan_kind', target.plan_kind,
        'start_date', target.start_date, 'end_date', target.end_date),
      'carried', (
        SELECT jsonb_build_object('id', carried.id, 'name', carried.name)
        FROM public.reading_teams AS carried
        WHERE carried.global_plan_id = target.id AND carried.carried_from_team_id = v_team.id
        ORDER BY carried.created_at LIMIT 1
      ),
      'captain_team', (
        SELECT jsonb_build_object('id', other.id, 'name', other.name)
        FROM public.reading_team_members AS membership
        JOIN public.reading_teams AS other ON other.id = membership.team_id
        WHERE membership.global_plan_id = target.id AND membership.user_id = v_team.captain_id
          AND membership.division = v_team.division
        LIMIT 1
      ),
      'captain_block', public.campaign_stage_join_block_reason(target.id, v_team.captain_id),
      'member_blocks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('user_id', blocked.user_id, 'reason', blocked.reason, 'team_name', blocked.team_name)
          ORDER BY blocked.user_id)
        FROM (
          SELECT member.user_id,
            (SELECT other.name FROM public.reading_team_members AS membership
               JOIN public.reading_teams AS other ON other.id = membership.team_id
              WHERE membership.global_plan_id = target.id AND membership.user_id = member.user_id
                AND membership.division = v_team.division LIMIT 1) AS team_name,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM public.reading_team_members AS membership
                WHERE membership.global_plan_id = target.id AND membership.user_id = member.user_id
                  AND membership.division = v_team.division
              ) THEN 'already_in_target_team'
              ELSE public.campaign_stage_join_block_reason(target.id, member.user_id)
            END AS reason
          FROM public.reading_team_members AS member
          WHERE member.team_id = v_team.id AND member.user_id <> v_team.captain_id
        ) AS blocked
        WHERE blocked.reason IS NOT NULL
      ), '[]'::jsonb)
    ) ORDER BY target.start_date, target.id), '[]'::jsonb)
  INTO v_next
  FROM public.global_plans AS target
  WHERE public.is_campaign_stage_kind(target.plan_kind)
    AND target.id <> v_team.global_plan_id
    AND NOT COALESCE(target.is_hidden, FALSE)
    AND public.previous_campaign_stage_plan_id(target.id) = v_team.global_plan_id;

  PERFORM audit.record('admin-api', 'view_team', 'ok', p_actor_id, p_actor_role, 'reading_teams',
    NULL, v_team.id::text, NULL, NULL, p_request_id,
    jsonb_build_object('global_plan_id', v_team.global_plan_id, 'team_name', v_team.name));

  RETURN jsonb_build_object(
    'today', (now() AT TIME ZONE 'Asia/Taipei')::date,
    'team', public._admin_api_team_rows(ARRAY[v_team.id], true) -> 0,
    'people', CASE WHEN cardinality(v_member_ids) = 0 THEN '[]'::jsonb ELSE
      COALESCE((public.plan_progress_people(v_team.global_plan_id, p_preset_key, false, v_member_ids, p_actor_id)::jsonb) -> 'people', '[]'::jsonb) END,
    'next_stages', v_next
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_detail(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_detail(uuid, text, uuid, text, text) TO service_role;


-- ── 4. 異動歷程 ───────────────────────────────────────────────────────────
-- 成員異動與隊伍本身的異動，由新到舊各最多 300 筆。records_since＝事件表最早的一筆（0149 部署之前沒有紀錄）。
-- 只回呼叫堆疊經過的函式名稱與原始堆疊（工程細節）；不回 jwt_claims。
CREATE OR REPLACE FUNCTION public.admin_api_team_history(p_actor_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  RETURN jsonb_build_object(
    'records_since', (SELECT MIN(event.created_at) FROM public.reading_team_member_events AS event),
    'member_events', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY at DESC, id DESC) FROM (
        SELECT event.created_at AS at, event.id,
          jsonb_build_object(
            'id', event.id, 'at', event.created_at, 'event_type', event.event_type,
            'user_id', event.user_id, 'user_name', prof.name, 'member_role', event.member_role,
            'division', event.division, 'txid', event.txid, 'db_user', event.db_user, 'app_name', event.app_name,
            'functions', public._admin_api_context_functions(event.call_context), 'call_context', event.call_context
          ) AS row_data
        FROM public.reading_team_member_events AS event
        LEFT JOIN public.profiles AS prof ON prof.id = event.user_id
        WHERE event.team_id = p_team_id
        ORDER BY event.created_at DESC, event.id DESC
        LIMIT 300
      ) AS ranked
    ), '[]'::jsonb),
    'team_events', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY at DESC, id DESC) FROM (
        SELECT event.created_at AS at, event.id,
          jsonb_build_object(
            'id', event.id, 'at', event.created_at, 'event_type', event.event_type,
            'name_old', event.name_old, 'name_new', event.name_new,
            'status_old', event.status_old, 'status_new', event.status_new,
            'division_old', event.division_old, 'division_new', event.division_new,
            'plan_changed', event.global_plan_id_old IS DISTINCT FROM event.global_plan_id_new AND event.event_type = 'update',
            'captain_id', event.captain_id, 'captain_name', captain.name,
            'carried_from_team_id', event.carried_from_team_id,
            'txid', event.txid, 'db_user', event.db_user, 'app_name', event.app_name,
            'functions', public._admin_api_context_functions(event.call_context), 'call_context', event.call_context
          ) AS row_data
        FROM public.reading_teams_events AS event
        LEFT JOIN public.profiles AS captain ON captain.id = event.captain_id
        WHERE event.team_id = p_team_id
        ORDER BY event.created_at DESC, event.id DESC
        LIMIT 300
      ) AS ranked
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_history(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_history(uuid, uuid) TO service_role;


-- ── 5. 跨階段對應 ─────────────────────────────────────────────────────────
-- 沿 carried_from_team_id 往前（這隊從哪隊帶來）、往後（哪些隊從這隊帶出去），各最多 20 層。
-- elsewhere：鏈上任何一位成員在鏈上各計畫、同組別的「別的隊」——帶隊時被略過的人用它推斷（上一階段有、
-- 這一階段沒有、而且在別隊）。帶隊結果沒有存下來（carry_reading_teams_to_stage 只回傳給隊長），所以只能推斷。
CREATE OR REPLACE FUNCTION public.admin_api_team_lineage(p_actor_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[];
  v_users uuid[];
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM public.reading_teams AS team WHERE team.id = p_team_id) THEN
    RETURN NULL;
  END IF;

  WITH RECURSIVE up AS (
    SELECT team.id, team.carried_from_team_id, 0 AS depth
    FROM public.reading_teams AS team WHERE team.id = p_team_id
    UNION
    SELECT parent.id, parent.carried_from_team_id, up.depth + 1
    FROM public.reading_teams AS parent
    JOIN up ON parent.id = up.carried_from_team_id
    WHERE up.depth < 20
  ),
  down AS (
    SELECT team.id, 0 AS depth
    FROM public.reading_teams AS team WHERE team.id = p_team_id
    UNION
    SELECT child.id, down.depth + 1
    FROM public.reading_teams AS child
    JOIN down ON child.carried_from_team_id = down.id
    WHERE down.depth < 20
  )
  SELECT array_agg(DISTINCT id) INTO v_ids FROM (SELECT id FROM up UNION SELECT id FROM down) AS chain;

  SELECT COALESCE(array_agg(DISTINCT member.user_id), ARRAY[]::uuid[]) INTO v_users
  FROM public.reading_team_members AS member WHERE member.team_id = ANY (v_ids);

  RETURN jsonb_build_object(
    'team_id', p_team_id,
    'teams', public._admin_api_team_rows(v_ids, false),
    'plans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', plan.id, 'name', plan.name, 'plan_kind', plan.plan_kind,
          'start_date', plan.start_date, 'end_date', plan.end_date) ORDER BY plan.start_date, plan.id)
      FROM public.global_plans AS plan
      WHERE plan.id IN (SELECT team.global_plan_id FROM public.reading_teams AS team WHERE team.id = ANY (v_ids))
    ), '[]'::jsonb),
    'elsewhere', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('global_plan_id', membership.global_plan_id, 'division', membership.division,
          'user_id', membership.user_id, 'team_id', membership.team_id, 'team_name', other.name)
        ORDER BY membership.global_plan_id, membership.user_id)
      FROM public.reading_team_members AS membership
      JOIN public.reading_teams AS other ON other.id = membership.team_id
      WHERE membership.user_id = ANY (v_users)
        AND NOT (membership.team_id = ANY (v_ids))
        AND EXISTS (
          SELECT 1 FROM public.reading_teams AS chain_team
          WHERE chain_team.id = ANY (v_ids)
            AND chain_team.global_plan_id = membership.global_plan_id
            AND chain_team.division = membership.division
        )
    ), '[]'::jsonb),
    'names', COALESCE((
      SELECT jsonb_object_agg(prof.id::text, prof.name) FROM public.profiles AS prof WHERE prof.id = ANY (v_users)
    ), '{}'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_lineage(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_lineage(uuid, uuid) TO service_role;


-- ── 6. 找隊伍 ─────────────────────────────────────────────────────────────
-- 隊名包含查詢字（% _ \ 當一般字元），或邀請碼完全相同（不分大小寫）。最多 20 筆：邀請碼相同的排最前面，
-- 再來是計畫開始日新→舊。搜尋字的規則和 user_search 相同（admin-api 先用 search-query.ts 擋）。
CREATE OR REPLACE FUNCTION public.admin_api_team_search(p_actor_id uuid, p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_escaped text;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  IF char_length(v_query) = 0 OR char_length(v_query) > 100 THEN
    RAISE EXCEPTION 'query_too_short' USING ERRCODE = '22023';
  END IF;
  v_escaped := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN COALESCE((
    SELECT jsonb_agg(matched.row_data ORDER BY matched.code_match DESC, matched.start_date DESC NULLS LAST, matched.name, matched.id)
    FROM (
      SELECT team.id, team.name, plan.start_date, team.invite_code = upper(v_query) AS code_match,
        jsonb_build_object(
          'id', team.id,
          'name', team.name,
          'division', team.division,
          'status', team.status,
          'member_count', (SELECT COUNT(*)::int FROM public.reading_team_members AS member WHERE member.team_id = team.id),
          'captain_name', captain.name,
          'matched_code', team.invite_code = upper(v_query),
          'plan', jsonb_build_object('id', plan.id, 'name', plan.name, 'plan_kind', plan.plan_kind,
            'start_date', plan.start_date, 'end_date', plan.end_date)
        ) AS row_data
      FROM public.reading_teams AS team
      JOIN public.global_plans AS plan ON plan.id = team.global_plan_id
      LEFT JOIN public.profiles AS captain ON captain.id = team.captain_id
      WHERE team.name ILIKE '%' || v_escaped || '%' OR team.invite_code = upper(v_query)
      ORDER BY (team.invite_code = upper(v_query)) DESC, plan.start_date DESC NULLS LAST, team.name, team.id
      LIMIT 20
    ) AS matched
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_search(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_search(uuid, text) TO service_role;
