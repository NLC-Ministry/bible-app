-- #551 App 管理分頁（組長）重整：總覽／名單／團隊／測驗共用的一支統計 RPC。
--
-- 原本管理分頁的「計畫統計／組員總覽」用 get_plan_stats_roster 把範圍內每個人的全部打卡紀錄
-- 載到手機再算；全教會範圍時資料量很大。這支只回「每人一列」的精簡事實，前端照舊用
-- js/data/schedule-progress.mjs 的唯一比對原語（教會原始日程）算落後／超前——伺服器
-- 不另算一套進度規則（2026-08-31 定案的進度比對原則）。
--
-- 參數：
-- - p_global_plan_id：要看的教會計畫；NULL 什麼都不回。
-- - p_preset_key：舊的報名沒有 global_plan_id、只有 preset_key 時用來比對（可為 NULL）。
-- - p_whole_church／p_visible_ids／p_actor_id：一律由 nlc-data 注入（plan-stats-scope.ts
--   buildPastoralOverviewArgs，來源 getVisibleProfileIds），前端傳的值會被蓋掉。
--   p_whole_church 不是 true 而且 p_visible_ids 是 NULL 或空陣列時什麼都不回（fail closed）。
--
-- 回傳 { today, people: [...] }，people 每人一筆（只算啟用中的帳號），照大區／牧區／小組／姓名排：
--   id, name, greatRegion, pastoralZone, smallGroup,
--   enrollment: null（沒報名）或 {
--     planId, round（current_round）, upgradeHandled（upgrade_prompt_handled）,
--     books（報名的 target_books，空的就用計畫的 target_books）,
--     chapters（計畫書卷內不重複的 書卷×章×遍 數，同前端 uniqueLogs.length）,
--     byRound（{ "1": 章數, "2": 章數 … }）, maxRound（打卡紀錄裡最大的遍數）,
--     lastReadAt（計畫書卷內最後一次打卡）, readDays7（台北時間近 7 天有打卡的天數）
--   },
--   teams: [{ id, name, division, status, size, captain }]（這個計畫底下參加的讀經團隊）,
--   quiz: { published（發給他小組、日期已到的小測驗數）, submitted（他送出的數） }
-- 同一人有多筆符合的報名時取 global_plan_id 相符、最新建立的那筆（個人計畫一律不算，#473）。
--
-- 只給 service_role，client 不能直接呼叫。

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
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid) TO service_role;

COMMENT ON FUNCTION public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid) IS
  'App 管理分頁（#551）：範圍內每人一列的報名、章數、最後打卡、近 7 天打卡天數、團隊、小測驗。範圍由 nlc-data 注入；只給 service_role。';
