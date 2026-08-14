-- Keep AI quiz reservations compatible with the partial A/B uniqueness index
-- introduced by 0090. PostgreSQL can only infer that index when the
-- ON CONFLICT target repeats its predicate.

CREATE OR REPLACE FUNCTION public.reserve_daily_quiz_generation(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_variant TEXT,
  p_chapter_refs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reserve_daily_quiz_generation$
DECLARE
  quiz_id UUID;
  reserved BOOLEAN := FALSE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_variant NOT IN ('A', 'B') THEN RAISE EXCEPTION 'invalid_quiz_variant'; END IF;
  IF jsonb_typeof(p_chapter_refs) <> 'array' OR jsonb_array_length(p_chapter_refs) = 0 THEN
    RAISE EXCEPTION 'quiz_chapters_required';
  END IF;

  INSERT INTO public.daily_quizzes(
    global_plan_id, quiz_date, variant, chapter_refs,
    generation_status, automatic_generation_attempts
  ) VALUES (
    p_global_plan_id, p_quiz_date, p_variant, p_chapter_refs,
    'generating', 1
  )
  ON CONFLICT (global_plan_id, quiz_date, variant)
    WHERE variant IN ('A', 'B')
  DO NOTHING
  RETURNING id INTO quiz_id;

  IF quiz_id IS NOT NULL THEN
    reserved := TRUE;
  ELSE
    SELECT quiz.id INTO quiz_id
    FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = p_variant;
  END IF;

  RETURN jsonb_build_object('quizId', quiz_id, 'reserved', reserved);
END;
$reserve_daily_quiz_generation$;

REVOKE ALL ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) IS
  'Atomically reserves one AI-generated A/B quiz row per plan/date/variant using the partial unique index.';
