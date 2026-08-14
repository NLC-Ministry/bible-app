-- Redesign the daily-quiz publish flow: explicit scope + version selection
-- (instead of listing every group / random per-group variant assignment),
-- and a self-authored "Version C" that skips pastoral review, is personal
-- to whoever writes it (never joins the shared A/B review queue), and can
-- hold 2-10 questions instead of the fixed 5 used by the AI-generated A/B
-- versions.
--
-- From this migration forward, AI generation only ever produces 'A'/'B'
-- (see supabase/functions/generate-daily-quizzes and
-- request_daily_quiz_regeneration below). variant = 'C' is now exclusively
-- the self-authored slot, so no new column is needed to tell them apart.

-- Allow multiple 'C' rows per plan/date (one per publish action) while
-- keeping A/B singleton-per-day as before.
ALTER TABLE public.daily_quizzes
  DROP CONSTRAINT IF EXISTS daily_quizzes_global_plan_id_quiz_date_variant_key;

CREATE UNIQUE INDEX IF NOT EXISTS daily_quizzes_ai_variant_unique
  ON public.daily_quizzes(global_plan_id, quiz_date, variant)
  WHERE variant IN ('A', 'B');

-- Custom quizzes may have 2-10 questions; AI quizzes stay fixed at 5 (5 is
-- within this range, so existing attempts remain valid).
ALTER TABLE public.quiz_attempts
  DROP CONSTRAINT IF EXISTS quiz_attempts_total_check;
ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_attempts_total_check CHECK (total BETWEEN 2 AND 10);

-- Shared question-shape validation, factored out of update_daily_quiz_questions
-- so the new custom-publish path can reuse it with a different count range.
CREATE OR REPLACE FUNCTION public.validate_daily_quiz_questions(
  p_questions JSONB,
  p_min_count INTEGER,
  p_max_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $validate_daily_quiz_questions$
DECLARE
  question JSONB;
  correct_index INTEGER;
BEGIN
  IF jsonb_typeof(p_questions) <> 'array'
    OR jsonb_array_length(p_questions) < p_min_count
    OR jsonb_array_length(p_questions) > p_max_count
  THEN
    RAISE EXCEPTION 'invalid_quiz_question_count';
  END IF;
  FOR question IN SELECT value FROM jsonb_array_elements(p_questions)
  LOOP
    IF BTRIM(COALESCE(question->>'question', '')) = ''
      OR BTRIM(COALESCE(question->>'verseRef', '')) = ''
      OR BTRIM(COALESCE(question->>'explanation', '')) = ''
      OR jsonb_typeof(question->'options') <> 'array'
      OR jsonb_array_length(question->'options') <> 4
      OR COALESCE(question->>'correctIndex', '') !~ '^[0-3]$'
    THEN
      RAISE EXCEPTION 'invalid_quiz_question';
    END IF;
    correct_index := (question->>'correctIndex')::INTEGER;
    IF BTRIM(COALESCE(question->'options'->>correct_index, '')) = '' THEN
      RAISE EXCEPTION 'invalid_quiz_question';
    END IF;
  END LOOP;
END;
$validate_daily_quiz_questions$;

REVOKE ALL ON FUNCTION public.validate_daily_quiz_questions(JSONB, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_daily_quiz_questions(JSONB, INTEGER, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_daily_quiz_questions(
  p_quiz_id UUID,
  p_questions JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $update_daily_quiz_questions$
DECLARE
  actor_id UUID;
  actor_role TEXT;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor') THEN RAISE EXCEPTION 'quiz_review_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_publications WHERE quiz_id = p_quiz_id) THEN
    RAISE EXCEPTION 'quiz_already_published';
  END IF;
  PERFORM public.validate_daily_quiz_questions(p_questions, 5, 5);

  UPDATE public.daily_quizzes
  SET questions = p_questions,
      generation_status = 'ready',
      review_status = 'pending',
      reviewed_by = NULL,
      reviewed_at = NULL,
      updated_by = actor_id
  WHERE id = p_quiz_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_not_found'; END IF;
  RETURN jsonb_build_object('quizId', p_quiz_id, 'reviewStatus', 'pending');
END;
$update_daily_quiz_questions$;

-- publish_daily_quiz: parameter list changes (scope selection replaces
-- group-id-array/publish-all, and an explicit version/custom-questions
-- choice replaces the old per-group HASHTEXT random assignment), so this
-- needs DROP + CREATE rather than CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.publish_daily_quiz(UUID, DATE, UUID[], BOOLEAN, UUID);

CREATE FUNCTION public.publish_daily_quiz(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,                     -- 'group' | 'zone' | 'region' | 'all'
  p_scope_name TEXT DEFAULT NULL,        -- group/zone/region NAME; NULL when scope_type='all'
  p_variant TEXT DEFAULT NULL,           -- 'A' or 'B' — publish an existing approved AI quiz
  p_custom_questions JSONB DEFAULT NULL, -- when set, create+publish a fresh self-authored 'C' quiz instead
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $publish_daily_quiz$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  selected_quiz_id UUID;
  source_chapter_refs JSONB;
  target_group_ids UUID[];
  target_group_id UUID;
  publication_id UUID;
  published_count INTEGER := 0;
  skipped_count INTEGER := 0;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;

  IF p_custom_questions IS NOT NULL THEN
    PERFORM public.validate_daily_quiz_questions(p_custom_questions, 2, 10);
    SELECT quiz.chapter_refs INTO source_chapter_refs
    FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant IN ('A', 'B')
    ORDER BY quiz.variant
    LIMIT 1;

    INSERT INTO public.daily_quizzes(
      global_plan_id, quiz_date, variant, chapter_refs, questions,
      generation_status, review_status, reviewed_by, reviewed_at, generated_at,
      automatic_generation_attempts
    ) VALUES (
      p_global_plan_id, p_quiz_date, 'C', COALESCE(source_chapter_refs, '[]'::JSONB), p_custom_questions,
      'ready', 'approved', actor_id, NOW(), NOW(),
      0
    )
    RETURNING id INTO selected_quiz_id;
  ELSE
    IF COALESCE(p_variant, '') NOT IN ('A', 'B') THEN RAISE EXCEPTION 'quiz_not_ready'; END IF;
    SELECT id INTO selected_quiz_id
    FROM public.daily_quizzes
    WHERE global_plan_id = p_global_plan_id
      AND quiz_date = p_quiz_date
      AND variant = p_variant
      AND generation_status = 'ready'
      AND review_status = 'approved';
    IF selected_quiz_id IS NULL THEN RAISE EXCEPTION 'quiz_not_ready'; END IF;
  END IF;

  WITH scoped_groups AS (
    SELECT g.id
    FROM public.small_groups g
    LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
    LEFT JOIN public.great_regions r ON r.id = z.great_region_id
    WHERE public.can_manage_quiz_group(actor_id, g.id)
      AND (
        p_scope_type = 'all'
        OR (p_scope_type = 'group' AND g.name = p_scope_name)
        OR (p_scope_type = 'zone' AND COALESCE(z.name, '') = p_scope_name)
        OR (p_scope_type = 'region' AND COALESCE(r.name, '') = p_scope_name)
      )
  )
  SELECT ARRAY_AGG(id) INTO target_group_ids FROM scoped_groups;

  IF COALESCE(CARDINALITY(target_group_ids), 0) = 0 THEN RAISE EXCEPTION 'quiz_publish_groups_required'; END IF;

  FOREACH target_group_id IN ARRAY target_group_ids
  LOOP
    publication_id := NULL;
    INSERT INTO public.quiz_publications(
      global_plan_id, quiz_date, quiz_id, small_group_id, published_by, publisher_role
    ) VALUES (
      p_global_plan_id, p_quiz_date, selected_quiz_id, target_group_id, actor_id, actor_role
    )
    ON CONFLICT (global_plan_id, quiz_date, small_group_id) DO NOTHING
    RETURNING id INTO publication_id;

    IF publication_id IS NULL THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.quiz_notifications(publication_id, recipient_id, message)
    SELECT publication_id, profile.id, '今日小測驗已發布，點擊即可開始作答。'
    FROM public.profiles profile
    WHERE public.profile_belongs_to_quiz_group(profile.id, target_group_id)
    ON CONFLICT (publication_id, recipient_id) DO NOTHING;
    published_count := published_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'publishedCount', published_count,
    'skippedCount', skipped_count,
    'targetCount', CARDINALITY(target_group_ids),
    'quizId', selected_quiz_id
  );
END;
$publish_daily_quiz$;

REVOKE ALL ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID) TO authenticated, service_role;

-- Dashboard: keep the shared pastoral review queue and "ready to publish"
-- badge list scoped to A/B only, so self-authored 'C' quizzes never clutter
-- the church-wide review board. managed_groups is unchanged (still powers
-- the per-scope results view on the frontend).
CREATE OR REPLACE FUNCTION public.get_daily_quiz_dashboard(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_daily_quiz_dashboard$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  publication_row public.quiz_publications%ROWTYPE;
  quiz_row public.daily_quizzes%ROWTYPE;
  attempt_row public.quiz_attempts%ROWTYPE;
  my_quiz JSONB := NULL;
  review_quizzes JSONB := '[]'::JSONB;
  managed_groups JSONB := '[]'::JSONB;
  approved_variants JSONB := '[]'::JSONB;
  auto_request_count INTEGER := 0;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  SELECT publication.* INTO publication_row
  FROM public.quiz_publications publication
  WHERE publication.global_plan_id = p_global_plan_id
    AND publication.quiz_date = p_quiz_date
    AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id)
  ORDER BY publication.published_at DESC
  LIMIT 1;

  IF publication_row.id IS NOT NULL THEN
    SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
    SELECT * INTO attempt_row
    FROM public.quiz_attempts
    WHERE publication_id = publication_row.id AND user_id = actor_id;
    my_quiz := jsonb_build_object(
      'publicationId', publication_row.id,
      'quizId', quiz_row.id,
      'quizDate', publication_row.quiz_date,
      'variant', quiz_row.variant,
      'chapterRefs', quiz_row.chapter_refs,
      'publisherRole', publication_row.publisher_role,
      'publishedAt', publication_row.published_at,
      'questions', public.quiz_questions_for_member(quiz_row.questions, attempt_row.id IS NOT NULL),
      'attempt', CASE WHEN attempt_row.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', attempt_row.id,
        'answers', attempt_row.answers,
        'score', attempt_row.score,
        'total', attempt_row.total,
        'completedAt', attempt_row.completed_at
      ) END
    );
  END IF;

  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'variant', variant) ORDER BY variant)
        FILTER (WHERE generation_status = 'ready' AND review_status = 'approved' AND variant IN ('A', 'B')),
      '[]'::JSONB
    ),
    COALESCE(SUM(automatic_generation_attempts), 0)::INTEGER
  INTO approved_variants, auto_request_count
  FROM public.daily_quizzes
  WHERE global_plan_id = p_global_plan_id AND quiz_date = p_quiz_date;

  IF actor_role IN ('admin', 'pastor') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', quiz.id,
      'variant', quiz.variant,
      'chapterRefs', quiz.chapter_refs,
      'questions', quiz.questions,
      'generationStatus', quiz.generation_status,
      'reviewStatus', quiz.review_status,
      'generationError', quiz.generation_error,
      'generatedAt', quiz.generated_at,
      'reviewedAt', quiz.reviewed_at
    ) ORDER BY quiz.variant), '[]'::JSONB)
    INTO review_quizzes
    FROM public.daily_quizzes quiz
    WHERE quiz.global_plan_id = p_global_plan_id AND quiz.quiz_date = p_quiz_date
      AND quiz.variant IN ('A', 'B');
  END IF;

  IF actor_role IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    WITH manageable_groups AS MATERIALIZED (
      SELECT
        g.id,
        g.name,
        g.pastoral_zone_id,
        COALESCE(z.name, '') AS pastoral_zone,
        COALESCE(r.name, '') AS great_region
      FROM public.small_groups g
      LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
      LEFT JOIN public.great_regions r ON r.id = z.great_region_id
      WHERE actor_role IN ('admin', 'pastor')
         OR public.can_manage_quiz_group(actor_id, g.id)
    ),
    direct_members AS (
      SELECT
        group_row.id AS group_id,
        member.id,
        member.name
      FROM manageable_groups group_row
      JOIN public.profiles member
        ON member.small_group_id = group_row.id
       AND member.is_active = TRUE
    ),
    legacy_members AS (
      SELECT
        group_row.id AS group_id,
        member.id,
        member.name
      FROM public.profiles member
      CROSS JOIN LATERAL unnest(string_to_array(COALESCE(member.small_group, ''), ',')) legacy_group_name(value)
      JOIN manageable_groups group_row
        ON btrim(legacy_group_name.value) <> ''
       AND btrim(legacy_group_name.value) = btrim(group_row.name)
       AND (
         member.pastoral_zone_id = group_row.pastoral_zone_id
         OR group_row.pastoral_zone = ''
         OR public.values_overlap(member.pastoral_zone, group_row.pastoral_zone)
       )
      WHERE member.is_active = TRUE
    ),
    member_matches AS MATERIALIZED (
      SELECT group_id, id, name FROM direct_members
      UNION
      SELECT group_id, id, name FROM legacy_members
    ),
    member_counts AS (
      SELECT group_id, COUNT(*)::INTEGER AS member_count
      FROM member_matches
      GROUP BY group_id
    ),
    target_publications AS MATERIALIZED (
      SELECT publication.*
      FROM public.quiz_publications publication
      WHERE publication.global_plan_id = p_global_plan_id
        AND publication.quiz_date = p_quiz_date
    ),
    attempt_stats AS (
      SELECT
        attempt.publication_id,
        COUNT(*)::INTEGER AS completed_count,
        ROUND(AVG(attempt.score)::NUMERIC, 1) AS average_score
      FROM public.quiz_attempts attempt
      JOIN target_publications publication ON publication.id = attempt.publication_id
      GROUP BY attempt.publication_id
    ),
    published_members AS (
      SELECT
        publication.small_group_id AS group_id,
        jsonb_agg(jsonb_build_object(
          'id', member.id,
          'name', member.name,
          'completed', attempt.id IS NOT NULL,
          'score', attempt.score,
          'total', attempt.total,
          'completedAt', attempt.completed_at
        ) ORDER BY member.name) AS members
      FROM target_publications publication
      JOIN member_matches member ON member.group_id = publication.small_group_id
      LEFT JOIN public.quiz_attempts attempt
        ON attempt.publication_id = publication.id AND attempt.user_id = member.id
      GROUP BY publication.small_group_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', group_row.id,
      'name', group_row.name,
      'pastoralZone', group_row.pastoral_zone,
      'greatRegion', group_row.great_region,
      'memberCount', COALESCE(member_count.member_count, 0),
      'publication', CASE WHEN publication.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', publication.id,
        'variant', published_quiz.variant,
        'publisherRole', publication.publisher_role,
        'publisherName', COALESCE(publisher.name, ''),
        'publishedAt', publication.published_at
      ) END,
      'completedCount', COALESCE(attempt_stat.completed_count, 0),
      'averageScore', attempt_stat.average_score,
      'members', COALESCE(published_member.members, '[]'::JSONB)
    ) ORDER BY group_row.great_region, group_row.pastoral_zone, group_row.name), '[]'::JSONB)
    INTO managed_groups
    FROM manageable_groups group_row
    LEFT JOIN member_counts member_count ON member_count.group_id = group_row.id
    LEFT JOIN target_publications publication ON publication.small_group_id = group_row.id
    LEFT JOIN public.daily_quizzes published_quiz ON published_quiz.id = publication.quiz_id
    LEFT JOIN public.profiles publisher ON publisher.id = publication.published_by
    LEFT JOIN attempt_stats attempt_stat ON attempt_stat.publication_id = publication.id
    LEFT JOIN published_members published_member ON published_member.group_id = group_row.id;
  END IF;

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'role', actor_role,
    'canReview', actor_role IN ('admin', 'pastor'),
    'canPublish', actor_role IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader'),
    'automaticRequestCount', auto_request_count,
    'approvedVariants', approved_variants,
    'reviewQuizzes', review_quizzes,
    'managedGroups', managed_groups,
    'myQuiz', my_quiz
  );
END;
$get_daily_quiz_dashboard$;

COMMENT ON FUNCTION public.get_daily_quiz_dashboard(UUID, DATE, UUID) IS
  'Returns quiz review, publication, and attempt data. Review queue and approved-variant badges are scoped to A/B only; self-authored C quizzes are personal to their publish action.';

-- submit_daily_quiz: score dynamically by however many questions the quiz
-- actually has (2-10 for custom, 5 for AI), instead of a hardcoded 0..4/5.
CREATE OR REPLACE FUNCTION public.submit_daily_quiz(
  p_publication_id UUID,
  p_answers JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $submit_daily_quiz$
DECLARE
  actor_id UUID;
  publication_row public.quiz_publications%ROWTYPE;
  quiz_row public.daily_quizzes%ROWTYPE;
  attempt_row public.quiz_attempts%ROWTYPE;
  answer_index INTEGER;
  score_value INTEGER := 0;
  question_index INTEGER;
  question_count INTEGER;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT * INTO publication_row FROM public.quiz_publications WHERE id = p_publication_id;
  IF publication_row.id IS NULL THEN RAISE EXCEPTION 'quiz_publication_not_found'; END IF;
  IF NOT public.profile_belongs_to_quiz_group(actor_id, publication_row.small_group_id) THEN
    RAISE EXCEPTION 'quiz_assignment_required';
  END IF;
  SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
  IF quiz_row.id IS NULL OR quiz_row.review_status <> 'approved' THEN RAISE EXCEPTION 'quiz_not_available'; END IF;

  question_count := jsonb_array_length(quiz_row.questions);
  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> question_count THEN
    RAISE EXCEPTION 'quiz_answers_required';
  END IF;

  FOR question_index IN 0..(question_count - 1)
  LOOP
    IF COALESCE(p_answers->>question_index, '') !~ '^[0-3]$' THEN
      RAISE EXCEPTION 'invalid_quiz_answer';
    END IF;
    answer_index := (p_answers->>question_index)::INTEGER;
    IF answer_index = (quiz_row.questions->question_index->>'correctIndex')::INTEGER THEN
      score_value := score_value + 1;
    END IF;
  END LOOP;

  INSERT INTO public.quiz_attempts(publication_id, user_id, answers, score, total)
  VALUES (p_publication_id, actor_id, p_answers, score_value, question_count)
  ON CONFLICT (publication_id, user_id) DO NOTHING
  RETURNING * INTO attempt_row;
  IF attempt_row.id IS NULL THEN
    SELECT * INTO attempt_row FROM public.quiz_attempts
    WHERE publication_id = p_publication_id AND user_id = actor_id;
  END IF;

  RETURN jsonb_build_object(
    'attemptId', attempt_row.id,
    'score', attempt_row.score,
    'total', attempt_row.total,
    'answers', attempt_row.answers,
    'completedAt', attempt_row.completed_at,
    'questions', public.quiz_questions_for_member(quiz_row.questions, TRUE)
  );
END;
$submit_daily_quiz$;

-- Manual regeneration only ever offers A/B now — C is never AI-generated.
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
  IF p_variant NOT IN ('A', 'B') THEN RAISE EXCEPTION 'invalid_quiz_variant'; END IF;
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
  p_variants TEXT[] DEFAULT ARRAY['A', 'B']::TEXT[],
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
  WHERE UPPER(BTRIM(value)) IN ('A', 'B');
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

COMMENT ON FUNCTION public.request_daily_quiz_regeneration(UUID, DATE, TEXT[], UUID) IS
  'Queues pastor/admin requested A/B generation. C is never AI-generated — it is authored directly at publish time.';

COMMENT ON TABLE public.daily_quizzes IS
  'A/B: church-wide AI quiz variants, cron-generated once daily, pastor/admin may retry or replace unapproved variants. C: self-authored by whoever publishes it, auto-approved, one row per publish action (not singleton-per-day).';
