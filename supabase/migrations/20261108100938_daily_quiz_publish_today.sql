-- ============================================================================
-- 20261108100938_daily_quiz_publish_today.sql  —  #688
--
-- 小測驗後台「今天」可以立即發佈：自動發佈關著（或排程還沒掃到）時，今天題目備妥了
-- 也沒有按鈕可發，只能等明天補發（2026-11-08 正式站就這樣，當天 0 個小組收到）。
--
-- 只改 publish_daily_quiz_makeup 的日期檢查：原本只收過去的日子（今天以後丟
-- quiz_makeup_not_past），改成收「今天和過去」，未來的日子丟 quiz_publish_not_yet
-- （不提前發佈，會友會在讀到經文前看到題目；維護者 2026-11-08 定案）。
-- 其餘檢查、發法都不變：發給全部小組、作答到今天 23:59（台北）、自訂題目優先。
-- 今天發了以後，run_daily_quiz_auto_publish 看到已發給全部小組就跳過，不會重複發。
--
-- 函式本體取自 20261028075515_daily_quiz_makeup.sql，簽章、權限不變。
-- 沿用同一支 RPC：nlc-data allowlist、admin-api 稽核都不用改，不用重新部署 Edge Function。
-- 舊版後台不會對今天呼叫它，不需要 forceUpdateBuiltBefore。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_daily_quiz_makeup(p_global_plan_id uuid, p_quiz_date date, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
  close_at TIMESTAMPTZ := ((((NOW() AT TIME ZONE 'Asia/Taipei')::date) + TIME '23:59:59') AT TIME ZONE 'Asia/Taipei');
  custom_questions JSONB;
  publish_result JSONB;
BEGIN
  -- 逐條檢查好給後台看得懂的錯誤；過去的日子條件和 _daily_quiz_makeup_allowed 相同
  IF p_quiz_date IS NULL OR p_quiz_date > today THEN RAISE EXCEPTION 'quiz_publish_not_yet'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans gp
                 WHERE gp.id = p_global_plan_id AND p_quiz_date BETWEEN gp.start_date AND gp.end_date) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans gp WHERE gp.id = p_global_plan_id AND today <= gp.end_date) THEN
    RAISE EXCEPTION 'quiz_makeup_plan_ended';
  END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  IF public._daily_quiz_reading_chapter_count(p_global_plan_id, p_quiz_date) = 0 THEN RAISE EXCEPTION 'quiz_rest_day'; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_daily_overrides o
             WHERE o.global_plan_id = p_global_plan_id AND o.quiz_date = p_quiz_date AND o.skip) THEN
    RAISE EXCEPTION 'quiz_day_skipped';
  END IF;

  -- 和 run_daily_quiz_auto_publish 一樣：有自訂題目發自訂題目，否則發已備妥的 AI 題目
  SELECT q.questions INTO custom_questions
  FROM public.quiz_daily_overrides o JOIN public.daily_quizzes q ON q.id = o.custom_quiz_id
  WHERE o.global_plan_id = p_global_plan_id AND o.quiz_date = p_quiz_date;
  IF custom_questions IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.daily_quizzes q
    WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
      AND q.generation_status = 'ready' AND q.review_status = 'approved') THEN
    RAISE EXCEPTION 'quiz_not_ready';
  END IF;

  publish_result := public.publish_daily_quiz(
    p_global_plan_id := p_global_plan_id,
    p_quiz_date := p_quiz_date,
    p_scope_type := 'all',
    p_scope_name := NULL,
    p_variant := CASE WHEN custom_questions IS NULL THEN 'A' END,
    p_custom_questions := custom_questions,
    p_actor_id := p_actor_id,
    p_answer_close_at := close_at);

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'source', CASE WHEN custom_questions IS NULL THEN 'ai' ELSE 'custom' END,
    'publishedCount', publish_result -> 'publishedCount',
    'answerCloseAt', close_at,
    'publishedBy', actor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_daily_quiz_makeup(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz_makeup(uuid, date, uuid) TO authenticated, service_role;
