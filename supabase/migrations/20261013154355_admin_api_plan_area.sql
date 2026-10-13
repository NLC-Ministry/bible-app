-- #565 後台「計畫」區：計畫選單、測驗作答的數字、從名單送關心提醒。
--
-- 1. admin_api_plan_options：計畫選單與預設計畫（admin-api 的 plan_options；打開計畫區載一次，前端快取）。
--    條件同使用者名單的計畫選項（admin_api_directory_list）：不含隱藏的計畫與總表（church_campaign）。
-- 2. admin_api_plan_quiz：「測驗作答」分頁，只有數字、不記稽核。
--    報名者＝plan_progress_people 判定的同一群人（不另寫一套報名規則）。
--    · 每日小測驗：這個計畫的小組發布（scope_type = 'group'）；當天的應答人數＝該小組的報名者。
--    · 大測驗：linked_plan_id 是這個計畫的試卷；只算正式作答（official、非測試帳號）。
--    · 雲柱：題目按日期出、不屬於任何計畫——只算「計畫期間出的題」與「這期報名者」的作答。
--    · 功能開關讀 app_feature_settings（沒有那一列＝關閉，同會友 App 的 getFeatureSetting 預設）。
-- 3. admin_api_care_remind：系統管理員從名單送關心提醒。同一位寄件人、同一人、同一計畫、同一天只有一則
--    （care_reminders_daily_unique）；送出後內容不能改（enforce_care_reminder_transition），今天已送過就拒絕。
--    sent_on 用 UTC 日期，和 nlc-data 的 send_care_reminder（toISOString）一致，才會撞到同一個唯一鍵。
--    plan_key 由 admin-api 用和 App 相同的規則推出（plan.presetKey），另外記 global_plan_id。同一個交易記稽核。
--
-- 三支都先在 SQL 依操作者重查是不是系統管理員（admin_api_assert_admin，不是就 42501）。
-- 依賴：20261013114704_admin_api_plan_progress.sql（admin_api_assert_admin、plan_progress_people）、
--       20261010181946_admin_audit_events.sql（audit.record）。

CREATE OR REPLACE FUNCTION public.admin_api_plan_options(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_plans jsonb;
  v_default uuid;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', plan.id, 'name', plan.name, 'plan_kind', plan.plan_kind,
      'start_date', plan.start_date, 'end_date', plan.end_date
    ) ORDER BY plan.start_date DESC NULLS LAST, plan.name, plan.id), '[]'::jsonb)
  INTO v_plans
  FROM public.global_plans AS plan
  WHERE NOT COALESCE(plan.is_hidden, FALSE) AND COALESCE(plan.plan_kind, 'standard') <> 'church_campaign';

  -- 預設：進行中（最晚開始的）→ 還沒開始（最早開始的）→ 已結束（最晚結束的）
  SELECT plan.id INTO v_default
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

  RETURN jsonb_build_object('plans', v_plans, 'default_plan_id', v_default);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_api_plan_options(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_plan_options(uuid) TO service_role;


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

  -- 每日小測驗
  WITH publication AS (
    SELECT pub.id, pub.quiz_date, pub.small_group_id
    FROM public.quiz_publications AS pub
    JOIN public.daily_quizzes AS quiz ON quiz.id = pub.quiz_id AND quiz.global_plan_id = p_global_plan_id
    WHERE pub.scope_type = 'group' AND pub.quiz_date <= v_today
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
    'participants', (SELECT COUNT(DISTINCT answered.user_id) FROM answered)::int
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


CREATE OR REPLACE FUNCTION public.admin_api_care_remind(
  p_actor_id uuid,
  p_actor_role text,
  p_recipient_id uuid,
  p_global_plan_id uuid,
  p_plan_key text,
  p_reason text,
  p_message text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_message text := btrim(COALESCE(p_message, ''));
  v_plan_key text := COALESCE(p_plan_key, '');
  v_sent_on date := (now() AT TIME ZONE 'UTC')::date;
  v_row record;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);

  IF p_reason IS NULL OR p_reason NOT IN ('behind', 'inactive', 'care', 'encouragement') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_message) = 0 OR char_length(v_message) > 300 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = p_actor_id THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS prof WHERE prof.id = p_recipient_id AND prof.is_active IS NOT FALSE) THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans AS plan WHERE plan.id = p_global_plan_id) THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = '22023';
  END IF;

  -- 送出後內容不能改（enforce_care_reminder_transition 擋住 reason／message 的修改），所以一天一則：
  -- 今天已經提醒過就直接拒絕，不覆寫
  IF EXISTS (
    SELECT 1 FROM public.care_reminders AS reminder
    WHERE reminder.sender_id = p_actor_id AND reminder.recipient_id = p_recipient_id
      AND reminder.plan_key = v_plan_key AND reminder.sent_on = v_sent_on
  ) THEN
    RAISE EXCEPTION 'care_reminder_already_sent' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.care_reminders (sender_id, recipient_id, global_plan_id, plan_key, reason, message, status, sent_on)
  VALUES (p_actor_id, p_recipient_id, p_global_plan_id, v_plan_key, p_reason, v_message, 'unread', v_sent_on)
  RETURNING id, reason, message, status, sent_on INTO v_row;

  PERFORM audit.record('admin-api', 'care_reminder.send', 'ok', p_actor_id, p_actor_role, 'care_reminders',
    p_recipient_id, v_row.id::text,
    jsonb_build_object('reason', p_reason, 'message', v_message),
    NULL, p_request_id,
    jsonb_build_object('global_plan_id', p_global_plan_id, 'plan_key', v_plan_key));

  RETURN jsonb_build_object('id', v_row.id, 'reason', v_row.reason, 'message', v_row.message,
    'status', v_row.status, 'sent_on', v_row.sent_on);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_api_care_remind(uuid, text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_care_remind(uuid, text, uuid, uuid, text, text, text, text) TO service_role;
