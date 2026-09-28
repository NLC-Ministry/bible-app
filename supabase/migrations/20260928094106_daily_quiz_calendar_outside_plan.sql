-- ============================================================================
-- 20260928094106_daily_quiz_calendar_outside_plan.sql  —  #307 補充
--
-- 日曆固定顯示 7 天，但一個階段計畫常常在月底結束。計畫期間以外的日子不會
-- 出題、也不會自動發佈，原本卻顯示成「等待出題」，容易讓管理員以為要處理。
-- 改成 'outside_plan'（不在計畫期間），後台那幾天也不給操作按鈕。
-- 函式本體取自 20260928085701，只加了計畫起訖日期的判斷。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_quiz_calendar(p_global_plan_id uuid, p_from date DEFAULT NULL::date, p_days integer DEFAULT 7, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  now_taipei TIMESTAMP := (NOW() AT TIME ZONE 'Asia/Taipei');
  today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
  start_day DATE;
  d DATE;
  ov public.quiz_daily_overrides%ROWTYPE;
  ai public.daily_quizzes%ROWTYPE;
  custom public.daily_quizzes%ROWTYPE;
  pub_groups INTEGER;
  close_at TIMESTAMPTZ;
  eligible INTEGER;
  completed INTEGER;
  avg_score NUMERIC;
  status TEXT;
  source TEXT;
  questions JSONB;
  days JSONB := '[]'::jsonb;
  plan_start DATE;
  plan_end DATE;
BEGIN
  PERFORM public._daily_quiz_require_admin(p_actor_id);
  start_day := COALESCE(p_from, today);
  SELECT gp.start_date, gp.end_date INTO plan_start, plan_end FROM public.global_plans gp WHERE gp.id = p_global_plan_id;

  FOR i IN 0 .. GREATEST(LEAST(COALESCE(p_days, 7), 31), 1) - 1 LOOP
    d := start_day + i;
    ov := NULL; ai := NULL; custom := NULL;
    SELECT * INTO ov FROM public.quiz_daily_overrides WHERE global_plan_id = p_global_plan_id AND quiz_date = d;
    SELECT * INTO ai FROM public.daily_quizzes WHERE global_plan_id = p_global_plan_id AND quiz_date = d AND variant = 'A';
    IF ov.custom_quiz_id IS NOT NULL THEN
      SELECT * INTO custom FROM public.daily_quizzes WHERE id = ov.custom_quiz_id;
    END IF;

    SELECT COUNT(*), MAX(answer_close_at) INTO pub_groups, close_at
    FROM public.quiz_publications WHERE global_plan_id = p_global_plan_id AND quiz_date = d;
    eligible := 0; completed := 0; avg_score := NULL;
    IF pub_groups > 0 THEN
      SELECT COUNT(*) INTO eligible FROM public.profiles p
      WHERE p.is_active AND p.small_group_id IN (
        SELECT small_group_id FROM public.quiz_publications
        WHERE global_plan_id = p_global_plan_id AND quiz_date = d AND small_group_id IS NOT NULL);
      SELECT COUNT(*), ROUND(AVG(a.score)::numeric, 1) INTO completed, avg_score
      FROM public.quiz_attempts a JOIN public.quiz_publications pub ON pub.id = a.publication_id
      WHERE pub.global_plan_id = p_global_plan_id AND pub.quiz_date = d AND a.status = 'submitted';
    END IF;

    source := CASE WHEN custom.id IS NOT NULL THEN 'custom'
                   WHEN ai.generation_status = 'ready' AND ai.review_status = 'approved' THEN 'ai' END;
    questions := CASE WHEN custom.id IS NOT NULL THEN custom.questions
                      WHEN source = 'ai' THEN ai.questions END;
    status := CASE
      WHEN pub_groups > 0 AND (close_at IS NULL OR NOW() < close_at) THEN 'open'
      WHEN pub_groups > 0 THEN 'ended'
      -- 不在這個計畫的期間（例如這一階段月底之後）：不會出題也不會發
      WHEN plan_start IS NOT NULL AND (d < plan_start OR d > plan_end) THEN 'outside_plan'
      WHEN COALESCE(ov.skip, FALSE) THEN 'skipped'
      WHEN d < today THEN 'not_published'
      WHEN source IS NOT NULL THEN 'scheduled'
      WHEN ai.generation_status = 'generating' THEN 'generating'
      WHEN ai.generation_status = 'failed' THEN 'failed'
      ELSE 'waiting'
    END;

    days := days || jsonb_build_object(
      'date', d,
      'status', status,
      'source', source,
      'needsAttention', status = 'failed'
        OR (status IN ('waiting', 'generating') AND (d = today OR (d = today + 1 AND EXTRACT(HOUR FROM now_taipei) >= 12))),
      'skip', COALESCE(ov.skip, FALSE),
      'questions', questions,
      'aiStatus', ai.generation_status,
      'aiError', ai.generation_error,
      'publishedGroups', pub_groups,
      'closeAt', close_at,
      'eligible', eligible,
      'completed', completed,
      'averageScore', avg_score
    );
  END LOOP;

  RETURN jsonb_build_object(
    'today', today,
    'autoPublishEnabled', COALESCE((SELECT enabled FROM public.quiz_auto_publish_rules WHERE global_plan_id = p_global_plan_id), FALSE),
    'days', days
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) TO authenticated, service_role;
