-- #564 計畫進度改由伺服器執行同一份 JS 規則：總覽（只有數字）與名單兩支 API 的資料來源。
--
-- 1. plan_progress_people：原本 get_pastoral_overview（#551，20261013043007_pastoral_overview.sql）的主體原樣搬來，
--    多回一個 meta（另外數的範圍人數、報名人數），讓呼叫端對帳。**不授權給任何角色**（連 service_role 都沒有），
--    只能經由下面兩支 SECURITY DEFINER 包裝呼叫——範圍一律由包裝決定。
-- 2. get_pastoral_overview：會友 App 管理分頁、nlc-data 組長版用。改成直接轉呼叫，參數、範圍規則、回傳都不變
--    （多一個 meta）。範圍由 nlc-data 注入（plan-stats-scope.ts buildPastoralOverviewArgs）。
-- 3. admin_api_plan_info／admin_api_plan_people：後台（admin-api 的 plan_summary／plan_roster）用。
--    在 SQL 裡依操作者重查角色：是啟用中的系統管理員才給全教會，否則 RAISE（42501）；前端不能傳範圍。
--    plan_people 帶 p_audit 時（plan_roster，打開名單）在同一個交易記一筆 view_plan_roster 稽核。
--
-- 落後／超前、需要關心等判斷不在 SQL：Edge Function 拿這裡的事實，執行和會友 App 同一份
-- supabase/functions/_shared/progress/plan-progress.mjs（不在 SQL 另寫一套，避免兩邊算出不同人數）。
--
-- 依賴：20261010181946_admin_audit_events.sql（audit.record）、20261013043007_pastoral_overview.sql。

CREATE OR REPLACE FUNCTION public.plan_progress_people(
  p_global_plan_id uuid,
  p_preset_key text,
  p_whole_church boolean,
  p_visible_ids uuid[],
  p_actor_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH scope AS (
    SELECT (
      p_actor_id IS NOT NULL
      AND p_global_plan_id IS NOT NULL
      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)
    ) AS allowed,
    (now() AT TIME ZONE 'Asia/Taipei')::date AS today
  ),
  global_plan AS (
    SELECT gp.id, gp.target_books
    FROM public.global_plans AS gp
    WHERE (SELECT allowed FROM scope) AND gp.id = p_global_plan_id
  ),
  roster AS (
    SELECT prof.id, prof.name, prof.great_region, prof.pastoral_zone, prof.small_group, prof.small_group_id
    FROM public.profiles AS prof
    WHERE (SELECT allowed FROM scope)
      AND prof.is_active IS TRUE
      AND (p_whole_church IS TRUE OR prof.id = ANY (p_visible_ids))
  ),
  enrollment AS (
    SELECT DISTINCT ON (plan.user_id)
      plan.user_id,
      plan.id AS plan_id,
      plan.current_round,
      plan.upgrade_prompt_handled,
      COALESCE(NULLIF(plan.target_books, ARRAY[]::text[]), (SELECT global_plan.target_books FROM global_plan), ARRAY[]::text[]) AS books
    FROM public.reading_plans AS plan
    WHERE EXISTS (SELECT 1 FROM global_plan)
      AND NOT plan.is_personal
      AND plan.user_id IN (SELECT roster.id FROM roster)
      AND (
        plan.global_plan_id = p_global_plan_id
        OR (NULLIF(p_preset_key, '') IS NOT NULL AND plan.preset_key = p_preset_key)
      )
    ORDER BY plan.user_id, (plan.global_plan_id = p_global_plan_id) DESC NULLS LAST, plan.created_at DESC, plan.id
  ),
  plan_logs AS (
    SELECT DISTINCT ON (enrollment.user_id, log.book, log.chapter, COALESCE(log.round, 1))
      enrollment.user_id,
      COALESCE(log.round, 1) AS round,
      log.read_at
    FROM enrollment
    JOIN public.reading_logs AS log
      ON log.plan_id = enrollment.plan_id
     AND log.user_id = enrollment.user_id
    WHERE cardinality(enrollment.books) = 0 OR log.book = ANY (enrollment.books)
    ORDER BY enrollment.user_id, log.book, log.chapter, COALESCE(log.round, 1), log.read_at
  ),
  log_totals AS (
    SELECT
      plan_logs.user_id,
      COUNT(*)::int AS chapters,
      MAX(plan_logs.round)::int AS max_round
    FROM plan_logs
    GROUP BY plan_logs.user_id
  ),
  round_totals AS (
    SELECT per_round.user_id, json_object_agg(per_round.round::text, per_round.chapters ORDER BY per_round.round) AS by_round
    FROM (
      SELECT plan_logs.user_id, plan_logs.round, COUNT(*)::int AS chapters
      FROM plan_logs
      GROUP BY plan_logs.user_id, plan_logs.round
    ) AS per_round
    GROUP BY per_round.user_id
  ),
  activity AS (
    SELECT
      enrollment.user_id,
      MAX(log.read_at) AS last_read_at,
      COUNT(DISTINCT (log.read_at AT TIME ZONE 'Asia/Taipei')::date) FILTER (
        WHERE (log.read_at AT TIME ZONE 'Asia/Taipei')::date > (SELECT today FROM scope) - 7
      )::int AS read_days_7
    FROM enrollment
    JOIN public.reading_logs AS log
      ON log.plan_id = enrollment.plan_id
     AND log.user_id = enrollment.user_id
    WHERE cardinality(enrollment.books) = 0 OR log.book = ANY (enrollment.books)
    GROUP BY enrollment.user_id
  ),
  team_rows AS (
    SELECT
      member.user_id,
      json_agg(json_build_object(
        'id', team.id,
        'name', team.name,
        'division', team.division,
        'status', team.status,
        'size', (SELECT COUNT(*)::int FROM public.reading_team_members AS other WHERE other.team_id = team.id),
        'captain', member.member_role = 'captain'
      ) ORDER BY team.division, team.id) AS teams
    FROM public.reading_team_members AS member
    JOIN public.reading_teams AS team ON team.id = member.team_id
    WHERE EXISTS (SELECT 1 FROM global_plan)
      AND team.global_plan_id = p_global_plan_id
      AND member.user_id IN (SELECT roster.id FROM roster)
    GROUP BY member.user_id
  ),
  quiz_rows AS (
    SELECT
      enrollment.user_id,
      COUNT(DISTINCT publication.id)::int AS published,
      COUNT(DISTINCT attempt.publication_id)::int AS submitted
    FROM enrollment
    JOIN roster ON roster.id = enrollment.user_id
    JOIN public.quiz_publications AS publication
      ON publication.scope_type = 'group'
     AND publication.small_group_id = roster.small_group_id
     AND publication.quiz_date <= (SELECT today FROM scope)
    JOIN public.daily_quizzes AS quiz
      ON quiz.id = publication.quiz_id
     AND quiz.global_plan_id = p_global_plan_id
    LEFT JOIN public.quiz_attempts AS attempt
      ON attempt.publication_id = publication.id
     AND attempt.user_id = enrollment.user_id
     AND attempt.status = 'submitted'
    GROUP BY enrollment.user_id
  )
  SELECT json_build_object(
    'today', (SELECT today FROM scope),
    'people', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', roster.id,
        'name', roster.name,
        'greatRegion', roster.great_region,
        'pastoralZone', roster.pastoral_zone,
        'smallGroup', roster.small_group,
        'enrollment', CASE WHEN enrollment.plan_id IS NULL THEN NULL ELSE json_build_object(
          'planId', enrollment.plan_id,
          'round', enrollment.current_round,
          'upgradeHandled', enrollment.upgrade_prompt_handled,
          'books', enrollment.books,
          'chapters', COALESCE(log_totals.chapters, 0),
          'byRound', COALESCE(round_totals.by_round, '{}'::json),
          'maxRound', log_totals.max_round,
          'lastReadAt', activity.last_read_at,
          'readDays7', COALESCE(activity.read_days_7, 0)
        ) END,
        'teams', COALESCE(team_rows.teams, '[]'::json),
        'quiz', json_build_object(
          'published', COALESCE(quiz_rows.published, 0),
          'submitted', COALESCE(quiz_rows.submitted, 0)
        )
      ) ORDER BY roster.great_region NULLS LAST, roster.pastoral_zone NULLS LAST, roster.small_group NULLS LAST, roster.name, roster.id), '[]'::json)
      FROM roster
      LEFT JOIN enrollment ON enrollment.user_id = roster.id
      LEFT JOIN log_totals ON log_totals.user_id = roster.id
      LEFT JOIN round_totals ON round_totals.user_id = roster.id
      LEFT JOIN activity ON activity.user_id = roster.id
      LEFT JOIN team_rows ON team_rows.user_id = roster.id
      LEFT JOIN quiz_rows ON quiz_rows.user_id = roster.id
      WHERE EXISTS (SELECT 1 FROM global_plan)
    ),
    -- 另外數一次（不經過上面的 json_agg 與 LEFT JOIN）：呼叫端拿來和 people 對帳，對不上就是有人漏掉或重複
    'meta', json_build_object(
      'inScope', (SELECT COUNT(*)::int FROM roster WHERE EXISTS (SELECT 1 FROM global_plan)),
      'enrolled', (SELECT COUNT(*)::int FROM enrollment)
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.plan_progress_people(uuid, text, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.plan_progress_people(uuid, text, boolean, uuid[], uuid) IS
  '計畫進度（#564）：範圍內每人一列的報名、章數、最後打卡、團隊、小測驗，加上對帳用的 meta。內部函式，不授權給任何角色；只經由 get_pastoral_overview（nlc-data）與 admin_api_plan_people（admin-api）呼叫。';

CREATE OR REPLACE FUNCTION public.get_pastoral_overview(
  p_global_plan_id uuid,
  p_preset_key text,
  p_whole_church boolean,
  p_visible_ids uuid[],
  p_actor_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.plan_progress_people(p_global_plan_id, p_preset_key, p_whole_church, p_visible_ids, p_actor_id);
$function$;

REVOKE ALL ON FUNCTION public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid) TO service_role;

-- 後台的角色檢查：操作者是啟用中的系統管理員（同 admin_api_actor 的 role_definitions.code）才放行。
-- 內部函式，不授權給任何角色。
CREATE OR REPLACE FUNCTION public.admin_api_assert_admin(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_assert_admin$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.role_definitions AS role ON role.id = profile.role_id
    WHERE profile.id = p_actor_id
      AND profile.is_active IS NOT FALSE
      AND role.code = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$admin_api_assert_admin$;
REVOKE ALL ON FUNCTION public.admin_api_assert_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 計畫本身（排「教會原始日程」要的欄位）；找不到回 NULL（admin-api 回 404）。
CREATE OR REPLACE FUNCTION public.admin_api_plan_info(p_actor_id uuid, p_global_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_plan_info$
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  RETURN (
    SELECT jsonb_build_object(
      'id', gp.id,
      'name', gp.name,
      'plan_kind', gp.plan_kind,
      'start_date', gp.start_date,
      'end_date', gp.end_date,
      'target_books', gp.target_books,
      'rules', gp.rules,
      'is_hidden', gp.is_hidden
    )
    FROM public.global_plans AS gp
    WHERE gp.id = p_global_plan_id
  );
END;
$admin_api_plan_info$;
REVOKE ALL ON FUNCTION public.admin_api_plan_info(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_plan_info(uuid, uuid) TO service_role;

-- 全教會的每人事實。p_audit＝打開名單（plan_roster）：同一個交易記 view_plan_roster；
-- 總覽（plan_summary）只有數字，不記。
CREATE OR REPLACE FUNCTION public.admin_api_plan_people(
  p_actor_id uuid,
  p_actor_role text,
  p_global_plan_id uuid,
  p_preset_key text,
  p_audit boolean DEFAULT false,
  p_request_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_plan_people$
DECLARE
  v_result json;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  v_result := public.plan_progress_people(p_global_plan_id, p_preset_key, true, NULL, p_actor_id);
  IF p_audit IS TRUE THEN
    PERFORM audit.record('admin-api', 'view_plan_roster', 'ok', p_actor_id, p_actor_role, 'global_plans',
      NULL, p_global_plan_id::text, NULL, NULL, p_request_id,
      jsonb_build_object('people', COALESCE(json_array_length(v_result -> 'people'), 0)));
  END IF;
  RETURN v_result;
END;
$admin_api_plan_people$;
REVOKE ALL ON FUNCTION public.admin_api_plan_people(uuid, text, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_plan_people(uuid, text, uuid, text, boolean, text) TO service_role;
