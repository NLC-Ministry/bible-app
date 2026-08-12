-- Allow pastor/admin initiated quiz generation retries without a daily cap.
-- Automatic cron still runs once per day. The atomic status transition below
-- prevents duplicate clicks from producing duplicate Gemini requests.

ALTER TABLE public.daily_quizzes
  DROP CONSTRAINT IF EXISTS daily_quizzes_automatic_generation_attempts_check;

ALTER TABLE public.daily_quizzes
  ADD CONSTRAINT daily_quizzes_automatic_generation_attempts_check
  CHECK (automatic_generation_attempts >= 0);

CREATE OR REPLACE FUNCTION public.lock_approved_daily_quiz_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $lock_approved_daily_quiz_content$
BEGIN
  IF OLD.review_status = 'approved' AND (
    NEW.review_status IS DISTINCT FROM OLD.review_status
    OR NEW.questions IS DISTINCT FROM OLD.questions
    OR NEW.chapter_refs IS DISTINCT FROM OLD.chapter_refs
    OR NEW.generation_status IS DISTINCT FROM OLD.generation_status
    OR NEW.generation_model IS DISTINCT FROM OLD.generation_model
  ) THEN
    RAISE EXCEPTION 'quiz_approval_locked';
  END IF;
  RETURN NEW;
END;
$lock_approved_daily_quiz_content$;

DROP TRIGGER IF EXISTS trg_daily_quizzes_lock_approved_content ON public.daily_quizzes;
CREATE TRIGGER trg_daily_quizzes_lock_approved_content
  BEFORE UPDATE ON public.daily_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.lock_approved_daily_quiz_content();

CREATE OR REPLACE FUNCTION public.reserve_daily_quiz_regeneration(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_variant TEXT,
  p_chapter_refs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reserve_daily_quiz_regeneration$
DECLARE
  quiz_id UUID;
  reserved BOOLEAN := FALSE;
  current_status TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_variant NOT IN ('A', 'B', 'C') THEN RAISE EXCEPTION 'invalid_quiz_variant'; END IF;
  IF jsonb_typeof(p_chapter_refs) <> 'array' OR jsonb_array_length(p_chapter_refs) = 0 THEN
    RAISE EXCEPTION 'quiz_chapters_required';
  END IF;

  UPDATE public.daily_quizzes quiz
  SET chapter_refs = p_chapter_refs,
      generation_status = 'generating',
      review_status = 'pending',
      automatic_generation_attempts = quiz.automatic_generation_attempts + 1,
      generation_model = NULL,
      generation_error = NULL,
      generated_at = NULL,
      reviewed_by = NULL,
      reviewed_at = NULL,
      updated_by = NULL
  WHERE quiz.global_plan_id = p_global_plan_id
    AND quiz.quiz_date = p_quiz_date
    AND quiz.variant = p_variant
    AND quiz.generation_status IN ('failed', 'ready')
    AND quiz.review_status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.quiz_publications publication WHERE publication.quiz_id = quiz.id
    )
  RETURNING quiz.id INTO quiz_id;

  IF quiz_id IS NOT NULL THEN
    reserved := TRUE;
  ELSE
    SELECT quiz.id, quiz.generation_status
    INTO quiz_id, current_status
    FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = p_variant;
  END IF;

  RETURN jsonb_build_object(
    'quizId', quiz_id,
    'reserved', reserved,
    'status', current_status
  );
END;
$reserve_daily_quiz_regeneration$;

CREATE OR REPLACE FUNCTION public.request_daily_quiz_regeneration(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_variants TEXT[] DEFAULT ARRAY['A', 'B', 'C']::TEXT[],
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $request_daily_quiz_regeneration$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  cron_secret TEXT;
  normalized_variants TEXT[];
  request_id BIGINT;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(profile.role_id) INTO actor_role
  FROM public.profiles profile
  WHERE profile.id = actor_id;

  IF actor_role NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'quiz_regeneration_permission_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.global_plans plan
    WHERE plan.id = p_global_plan_id
      AND p_quiz_date BETWEEN plan.start_date AND plan.end_date
  ) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;

  SELECT ARRAY_AGG(DISTINCT UPPER(BTRIM(value)) ORDER BY UPPER(BTRIM(value)))
  INTO normalized_variants
  FROM UNNEST(COALESCE(p_variants, ARRAY[]::TEXT[])) AS item(value)
  WHERE UPPER(BTRIM(value)) IN ('A', 'B', 'C');
  IF COALESCE(CARDINALITY(normalized_variants), 0) = 0 THEN
    RAISE EXCEPTION 'quiz_regeneration_variants_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = ANY(normalized_variants)
      AND quiz.review_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'quiz_already_approved';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.daily_quizzes quiz
    JOIN public.quiz_publications publication ON publication.quiz_id = quiz.id
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = ANY(normalized_variants)
  ) THEN
    RAISE EXCEPTION 'quiz_already_published';
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'quiz_generation_cron_secret'
  LIMIT 1;
  IF cron_secret IS NULL THEN RAISE EXCEPTION 'quiz_generation_secret_missing'; END IF;

  SELECT net.http_post(
    url := 'https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/generate-daily-quizzes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := jsonb_build_object(
      'source', 'manual',
      'quizDate', p_quiz_date,
      'planId', p_global_plan_id,
      'variants', TO_JSONB(normalized_variants),
      'retryExisting', TRUE,
      'requestedBy', actor_id
    )
  ) INTO request_id;

  RETURN jsonb_build_object('queued', TRUE, 'requestId', request_id, 'variants', normalized_variants);
END;
$request_daily_quiz_regeneration$;

REVOKE ALL ON FUNCTION public.reserve_daily_quiz_regeneration(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_daily_quiz_regeneration(UUID, DATE, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) IS
  'Queues pastor/admin requested generation. Repeated clicks are deduplicated by reserve_daily_quiz_regeneration.';

COMMENT ON FUNCTION public.lock_approved_daily_quiz_content() IS
  'Makes approved quiz questions and approval status immutable.';

COMMENT ON TABLE public.daily_quizzes IS
  'Church-wide AI quiz variants. Cron generates once daily; pastor/admin may retry or replace unapproved variants without a fixed cap.';
