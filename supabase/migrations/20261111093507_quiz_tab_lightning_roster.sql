-- ============================================================================
-- 20261111093507_quiz_tab_lightning_roster.sql  —  #700
--
-- App「管理」→「測驗」分頁重新設計：加入雲柱統計，小測驗改用報名者當分母。
--
-- 1. plan_progress_people（名單；App 經 nlc-data、後台經 admin-api 呼叫）
--    · 每人多帶 lightning：計畫期間（計畫開始～今天，計畫結束就到結束日）答了幾題雲柱、
--      答對幾題、參加過哪幾週（週一開始，同 admin_get_lightning_quiz_weeks）。
--      答對題數只給前端加總成整體／單位答對率，畫面不顯示個人的（維護者 2026-11-11）。
--    · 最上層多帶 lightning：期間與每週題數（算參與率、答題率的分母）。
--    · 小測驗「已發」只算作答已截止的發題（今天的題 23:59 前不算，白天作答率才不會被拉低）。
--      最上層多帶 quiz.days：這期已截止的發題天數。
--    · 小測驗統一排程後每天發給全部小組，「有沒有發給他」不用再分辨；沒有小組的報名者
--      收不到題（get_daily_quiz_dashboard 只找發給自己小組的題），published＝0，前端分開標示。
-- 2. admin_api_plan_quiz（後台「測驗」總覽）：小測驗同樣只算已截止的發題，
--    多帶 unreached（報名但收不到題的人數），文案改成以報名者為母體。
--
-- 只多欄位、不改舊欄位：舊版 App／後台照常運作，不需要 forceUpdateBuiltBefore。
-- 新欄位要經過 _shared/progress（plan-progress.mjs、plan-report.mjs）整理才會傳到前端，
-- 所以 nlc-data、admin-api 都要重新部署；沒部署前新版畫面只是看不到雲柱卡。
-- 函式本體取自 20261013114704_admin_api_plan_progress.sql、20261013154355_admin_api_plan_area.sql，
-- 簽章、權限不變。
-- ============================================================================

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
    SELECT gp.id, gp.target_books, gp.start_date, gp.end_date
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
  -- #700：小測驗只算作答已截止的發題（沒設截止時間的舊資料以當天結束為準）
  closed_publication AS (
    SELECT publication.id, publication.quiz_date, publication.small_group_id
    FROM public.quiz_publications AS publication
    JOIN public.daily_quizzes AS quiz
      ON quiz.id = publication.quiz_id
     AND quiz.global_plan_id = p_global_plan_id
    WHERE EXISTS (SELECT 1 FROM global_plan)
      AND publication.scope_type = 'group'
      AND publication.quiz_date <= (SELECT today FROM scope)
      AND COALESCE(publication.answer_close_at, ((publication.quiz_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei')) <= now()
  ),
  quiz_rows AS (
    SELECT
      enrollment.user_id,
      COUNT(DISTINCT publication.id)::int AS published,
      COUNT(DISTINCT attempt.publication_id)::int AS submitted
    FROM enrollment
    JOIN roster ON roster.id = enrollment.user_id
    JOIN closed_publication AS publication
      ON publication.small_group_id = roster.small_group_id
    LEFT JOIN public.quiz_attempts AS attempt
      ON attempt.publication_id = publication.id
     AND attempt.user_id = enrollment.user_id
     AND attempt.status = 'submitted'
    GROUP BY enrollment.user_id
  ),
  -- #700：雲柱是全教會活動、不屬於計畫；這裡只取計畫期間出的題（同後台週統計：已發布、以週一為一週）
  lightning_window AS (
    SELECT global_plan.start_date AS from_date,
      LEAST(COALESCE(global_plan.end_date, (SELECT today FROM scope)), (SELECT today FROM scope)) AS to_date
    FROM global_plan
  ),
  lightning_question AS (
    SELECT question.id, date_trunc('week', question.rise_date)::date AS week_start
    FROM public.lightning_quiz_questions AS question
    JOIN lightning_window ON question.rise_date BETWEEN lightning_window.from_date AND lightning_window.to_date
    WHERE question.status = 'published'
  ),
  lightning_rows AS (
    SELECT
      attempt.user_id,
      COUNT(*)::int AS answered,
      COUNT(*) FILTER (WHERE attempt.is_correct IS TRUE)::int AS correct,
      json_agg(DISTINCT lightning_question.week_start ORDER BY lightning_question.week_start) AS weeks
    FROM lightning_question
    JOIN public.lightning_quiz_attempts AS attempt
      ON attempt.question_id = lightning_question.id
     AND attempt.completed_at IS NOT NULL
    WHERE attempt.user_id IN (SELECT roster.id FROM roster)
    GROUP BY attempt.user_id
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
        ),
        'lightning', json_build_object(
          'answered', COALESCE(lightning_rows.answered, 0),
          'correct', COALESCE(lightning_rows.correct, 0),
          'weeks', COALESCE(lightning_rows.weeks, '[]'::json)
        )
      ) ORDER BY roster.great_region NULLS LAST, roster.pastoral_zone NULLS LAST, roster.small_group NULLS LAST, roster.name, roster.id), '[]'::json)
      FROM roster
      LEFT JOIN enrollment ON enrollment.user_id = roster.id
      LEFT JOIN log_totals ON log_totals.user_id = roster.id
      LEFT JOIN round_totals ON round_totals.user_id = roster.id
      LEFT JOIN activity ON activity.user_id = roster.id
      LEFT JOIN team_rows ON team_rows.user_id = roster.id
      LEFT JOIN quiz_rows ON quiz_rows.user_id = roster.id
      LEFT JOIN lightning_rows ON lightning_rows.user_id = roster.id
      WHERE EXISTS (SELECT 1 FROM global_plan)
    ),
    'quiz', json_build_object(
      'days', (SELECT COUNT(DISTINCT closed_publication.quiz_date)::int FROM closed_publication)
    ),
    'lightning', (
      SELECT json_build_object(
        'from', lightning_window.from_date,
        'to', lightning_window.to_date,
        'weeks', COALESCE((
          SELECT json_agg(json_build_object('weekStart', week.week_start, 'questions', week.questions) ORDER BY week.week_start)
          FROM (
            SELECT lightning_question.week_start, COUNT(*)::int AS questions
            FROM lightning_question
            GROUP BY lightning_question.week_start
          ) AS week
        ), '[]'::json)
      )
      FROM lightning_window
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
  '計畫進度（#564）：範圍內每人一列的報名、章數、最後打卡、團隊、小測驗、雲柱（#700），加上對帳用的 meta。內部函式，不授權給任何角色；只經由 get_pastoral_overview（nlc-data）與 admin_api_plan_people（admin-api）呼叫。';


CREATE OR REPLACE FUNCTION public.admin_api_plan_quiz(p_actor_id uuid, p_global_plan_id uuid, p_preset_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_plan record;
  v_people jsonb;
  v_window_end date;
  v_daily jsonb;
  v_exam jsonb;
  v_lightning jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);

  SELECT plan.id, plan.start_date, plan.end_date INTO v_plan
  FROM public.global_plans AS plan WHERE plan.id = p_global_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = '22023';
  END IF;
  v_window_end := LEAST(COALESCE(v_plan.end_date, v_today), v_today);

  -- 報名者：和總覽、名單同一個判定
  v_people := public.plan_progress_people(p_global_plan_id, p_preset_key, true, NULL, p_actor_id)::jsonb;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.admin_plan_quiz_enrolled (user_id uuid PRIMARY KEY, small_group_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.admin_plan_quiz_enrolled;
  INSERT INTO pg_temp.admin_plan_quiz_enrolled (user_id, small_group_id)
  SELECT prof.id, prof.small_group_id
  FROM jsonb_array_elements(COALESCE(v_people -> 'people', '[]'::jsonb)) AS person
  JOIN public.profiles AS prof ON prof.id = (person ->> 'id')::uuid
  WHERE person -> 'enrollment' IS NOT NULL AND person -> 'enrollment' <> 'null'::jsonb;

  -- 每日小測驗（#700：統一排程後每天發給全部小組；只算作答已截止的發題，
  -- 母體＝報名者，沒有小組、收不到題的另外算 unreached）
  WITH publication AS (
    SELECT pub.id, pub.quiz_date, pub.small_group_id
    FROM public.quiz_publications AS pub
    JOIN public.daily_quizzes AS quiz ON quiz.id = pub.quiz_id AND quiz.global_plan_id = p_global_plan_id
    WHERE pub.scope_type = 'group' AND pub.quiz_date <= v_today
      AND COALESCE(pub.answer_close_at, ((pub.quiz_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei')) <= now()
  ),
  eligible AS (
    SELECT DISTINCT publication.quiz_date, enrolled.user_id, publication.id AS publication_id
    FROM publication
    JOIN pg_temp.admin_plan_quiz_enrolled AS enrolled ON enrolled.small_group_id = publication.small_group_id
  ),
  answered AS (
    SELECT DISTINCT eligible.quiz_date, eligible.user_id
    FROM eligible
    JOIN public.quiz_attempts AS attempt
      ON attempt.publication_id = eligible.publication_id
     AND attempt.user_id = eligible.user_id
     AND attempt.status = 'submitted'
  ),
  per_day AS (
    SELECT day.quiz_date,
      (SELECT COUNT(DISTINCT e.user_id) FROM eligible AS e WHERE e.quiz_date = day.quiz_date)::int AS eligible,
      (SELECT COUNT(*) FROM answered AS a WHERE a.quiz_date = day.quiz_date)::int AS submitted
    FROM (SELECT DISTINCT quiz_date FROM publication) AS day
  )
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT setting.enabled FROM public.app_feature_settings AS setting WHERE setting.key = 'daily_quiz'), FALSE),
    'configured', EXISTS (SELECT 1 FROM public.daily_quizzes AS quiz WHERE quiz.global_plan_id = p_global_plan_id)
      OR EXISTS (SELECT 1 FROM public.quiz_auto_publish_rules AS rule WHERE rule.global_plan_id = p_global_plan_id AND rule.enabled),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', per_day.quiz_date, 'eligible', per_day.eligible, 'submitted', per_day.submitted)
      ORDER BY per_day.quiz_date) FROM per_day), '[]'::jsonb),
    'participants', (SELECT COUNT(DISTINCT answered.user_id) FROM answered)::int,
    'unreached', CASE WHEN NOT EXISTS (SELECT 1 FROM publication) THEN 0 ELSE (
      SELECT COUNT(*) FROM pg_temp.admin_plan_quiz_enrolled AS enrolled
      WHERE NOT EXISTS (SELECT 1 FROM eligible WHERE eligible.user_id = enrolled.user_id)
    ) END::int
  ) INTO v_daily;

  -- 大測驗（這個計畫的試卷）
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT setting.enabled FROM public.app_feature_settings AS setting WHERE setting.key = 'speed_reading_exam'), FALSE),
    'papers', COALESCE(jsonb_agg(jsonb_build_object(
      'id', paper.id, 'title', paper.title, 'status', paper.status,
      'open_at', paper.open_at, 'close_at', paper.close_at,
      'started', stats.started, 'submitted', stats.submitted, 'graded', stats.graded,
      'pending', stats.pending, 'enrolled_takers', stats.enrolled_takers, 'average', stats.average
    ) ORDER BY paper.open_at NULLS LAST, paper.title) FILTER (WHERE paper.id IS NOT NULL), '[]'::jsonb)
  ) INTO v_exam
  FROM public.exam_papers AS paper
  CROSS JOIN LATERAL (
    SELECT
      COUNT(DISTINCT attempt.user_id)::int AS started,
      COUNT(DISTINCT attempt.user_id) FILTER (WHERE attempt.status IN ('submitted', 'graded'))::int AS submitted,
      COUNT(DISTINCT attempt.user_id) FILTER (WHERE attempt.status = 'graded')::int AS graded,
      COUNT(DISTINCT attempt.user_id) FILTER (WHERE attempt.status = 'submitted')::int AS pending,
      COUNT(DISTINCT attempt.user_id) FILTER (WHERE attempt.user_id IN (SELECT user_id FROM pg_temp.admin_plan_quiz_enrolled))::int AS enrolled_takers,
      ROUND(AVG(attempt.total_score) FILTER (WHERE attempt.status = 'graded'), 1) AS average
    FROM public.exam_attempts AS attempt
    WHERE attempt.paper_id = paper.id AND attempt.attempt_kind = 'official' AND NOT COALESCE(attempt.is_test, FALSE)
  ) AS stats
  WHERE paper.linked_plan_id = p_global_plan_id;
  IF v_exam IS NULL THEN
    v_exam := jsonb_build_object(
      'enabled', COALESCE((SELECT setting.enabled FROM public.app_feature_settings AS setting WHERE setting.key = 'speed_reading_exam'), FALSE),
      'papers', '[]'::jsonb);
  END IF;

  -- 雲柱：計畫期間出的題、這期報名者的作答（以週一為一週）
  WITH question AS (
    SELECT q.id, q.rise_date
    FROM public.lightning_quiz_questions AS q
    WHERE q.status = 'published' AND q.rise_date BETWEEN v_plan.start_date AND v_window_end
  ),
  played AS (
    SELECT DISTINCT question.rise_date, attempt.user_id
    FROM question
    JOIN public.lightning_quiz_attempts AS attempt ON attempt.question_id = question.id AND attempt.completed_at IS NOT NULL
    JOIN pg_temp.admin_plan_quiz_enrolled AS enrolled ON enrolled.user_id = attempt.user_id
  ),
  week AS (
    SELECT date_trunc('week', question.rise_date)::date AS week_start, COUNT(*)::int AS questions
    FROM question GROUP BY 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM question) THEN NULL ELSE jsonb_build_object(
    'from', v_plan.start_date,
    'to', v_window_end,
    'questions', (SELECT COUNT(*) FROM question)::int,
    'participants', (SELECT COUNT(DISTINCT played.user_id) FROM played)::int,
    'weeks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'week_start', week.week_start,
        'questions', week.questions,
        'participants', (SELECT COUNT(DISTINCT played.user_id) FROM played WHERE date_trunc('week', played.rise_date)::date = week.week_start)
      ) ORDER BY week.week_start) FROM week), '[]'::jsonb)
  ) END INTO v_lightning;

  RETURN jsonb_build_object(
    'today', v_today,
    'enrolled', (SELECT COUNT(*) FROM pg_temp.admin_plan_quiz_enrolled)::int,
    'daily', v_daily,
    'exam', v_exam,
    'lightning', v_lightning
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_api_plan_quiz(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_plan_quiz(uuid, uuid, text) TO service_role;
