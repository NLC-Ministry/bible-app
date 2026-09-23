-- ============================================================================
-- 快問快答測試模式：對非 admin 完全不透露「其實有題目，只是被測試模式擋住」
-- ============================================================================
-- migration 0205 讓 get_todays_lightning_quiz() 對非 admin 在測試模式下回跟
-- 「今天真的沒有題目」一模一樣的 {status:'no_question'}，這部分沒問題。
-- 但 start_lightning_quiz_attempt() / submit_lightning_quiz_attempt() 當時是
-- RAISE EXCEPTION 'lightning_quiz_test_mode_restricted'——如果有人（例如技術
-- 背景的會友）直接對著這兩支 RPC 送請求，會從這個獨立的錯誤代碼看出「這裡
-- 其實有題目，只是我被擋住了」，等於間接洩漏了測試中的題目存在。
-- 改成跟「題目不存在」同一個錯誤代碼（lightning_quiz_not_found），對非 admin
-- 來說，測試模式擋下來的題目要嘛在 get_todays_lightning_quiz() 就看不到、要嘛
-- 直接呼叫也只會看到「找不到」，三支 RPC 的行為完全一致，不回任何額外資訊。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_lightning_quiz_attempt(
  p_question_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q        public.lightning_quiz_questions%ROWTYPE;
  att      public.lightning_quiz_attempts%ROWTYPE;
BEGIN
  IF public.is_feature_enabled('lightning_quiz_test_mode')
     AND NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_not_found';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND rise_date = today_tw AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  IF FOUND THEN
    IF att.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'lightning_quiz_already_answered';
    END IF;
    RETURN jsonb_build_object('startedAt', att.started_at);
  END IF;

  IF now_time NOT BETWEEN q.rise_time_start AND q.rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_outside_window';
  END IF;

  INSERT INTO public.lightning_quiz_attempts (question_id, user_id, started_at)
  VALUES (q.id, actor_id, NOW())
  ON CONFLICT (question_id, user_id) DO NOTHING;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  RETURN jsonb_build_object('startedAt', att.started_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_lightning_quiz_attempt(
  p_question_id UUID,
  p_response JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  now_time  TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q         public.lightning_quiz_questions%ROWTYPE;
  att       public.lightning_quiz_attempts%ROWTYPE;
  v_correct BOOLEAN;
  v_elapsed BIGINT;
BEGIN
  IF public.is_feature_enabled('lightning_quiz_test_mode')
     AND NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_not_found';
  END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND user_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_started'; END IF;

  IF att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('isCorrect', att.is_correct, 'elapsedMs', att.elapsed_ms);
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  IF now_time > q.rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_window_closed';
  END IF;

  v_correct := public._lightning_quiz_answer_is_correct(q.question_type, q.answer_key, p_response);
  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - att.started_at)) * 1000)::BIGINT;

  UPDATE public.lightning_quiz_attempts
  SET completed_at = NOW(), elapsed_ms = v_elapsed, response = p_response, is_correct = v_correct
  WHERE id = att.id;

  RETURN jsonb_build_object('isCorrect', v_correct, 'elapsedMs', v_elapsed);
END;
$$;

REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;
