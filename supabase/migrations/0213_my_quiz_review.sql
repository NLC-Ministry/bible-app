-- ============================================================================
-- 我的測驗：活動結束撤掉首頁結果、小測驗逐題檢討
-- ============================================================================
-- 1. 快問快答首頁卡片：活動時段一結束就撤掉（不管有沒有作答），結果改到
--    「我的測驗」看（get_my_lightning_quiz_history 也是時段結束才開始回傳），
--    兩邊剛好銜接、中間沒有空窗。每種可見狀態都附上 secondsUntilEnd，讓一直
--    開著的首頁在結束那一刻自己收起卡片——由伺服器算，避免裝置時鐘/時區誤差。
-- 2. 小測驗「我的測驗」：每筆送出的作答多帶題目（含正解與解說）與作答內容，
--    點進去可以逐題檢討。只回 status = 'submitted' 的作答，正解揭露時機跟
--    「進度」分頁送出後的檢討畫面相同，不會多揭露任何東西。
-- （放在新的 migration 而不是改 0211：0211 可能已經在測試環境執行過，改了
--   舊檔不會再被套用。）
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id     UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw     DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time     TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q            public.lightning_quiz_questions%ROWTYPE;
  att          public.lightning_quiz_attempts%ROWTYPE;
  seconds_left INT;
BEGIN
  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE rise_date = today_tw AND status = 'published';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_question');
  END IF;

  -- 活動結束：首頁一律撤掉，結果到「我的測驗」看。
  IF now_time > q.rise_time_end THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;
  seconds_left := CEIL(EXTRACT(EPOCH FROM (q.rise_time_end - now_time)))::INT;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  IF FOUND AND att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'answered',
      'questionId', q.id,
      'isCorrect', att.is_correct,
      'elapsedMs', att.elapsed_ms,
      'secondsUntilEnd', seconds_left
    );
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'questionId', q.id,
      'questionType', q.question_type,
      'payload', q.payload,
      'startedAt', att.started_at,
      'secondsUntilEnd', seconds_left
    );
  END IF;

  IF now_time < q.rise_time_start THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;

  RETURN jsonb_build_object(
    'status', 'available',
    'questionId', q.id,
    'questionType', q.question_type,
    'payload', q.payload,
    'secondsUntilEnd', seconds_left
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.daily_quiz_get_my_results(
  p_global_plan_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $daily_quiz_get_my_results$
DECLARE
  actor_id UUID;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'quiz_stats_date_range_required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'quizDate', qa.quiz_date,
      'score', qa.score,
      'total', qa.total,
      'timeSeconds', qa.time_seconds,
      'questions', public.quiz_questions_for_member(qa.questions, TRUE),
      'answers', qa.answers
    ) ORDER BY qa.quiz_date DESC)
    FROM (
      SELECT qa.score, qa.total, qa.answers, dq.quiz_date, dq.questions,
        CASE WHEN qa.completed_at > qa.started_at
          THEN ROUND(EXTRACT(EPOCH FROM (qa.completed_at - qa.started_at))::numeric, 0) ELSE NULL END AS time_seconds
      FROM public.quiz_attempts qa
      JOIN public.quiz_publications qp ON qp.id = qa.publication_id
      JOIN public.daily_quizzes dq ON dq.id = qp.quiz_id
      WHERE qa.user_id = actor_id
        AND dq.global_plan_id = p_global_plan_id
        AND dq.quiz_date BETWEEN p_from_date AND p_to_date
        AND qa.status = 'submitted'
    ) qa
  ), '[]'::jsonb);
END;
$daily_quiz_get_my_results$;

REVOKE ALL ON FUNCTION public.daily_quiz_get_my_results(UUID, DATE, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_quiz_get_my_results(UUID, DATE, DATE, UUID) TO authenticated, service_role;
