-- Daily church quizzes: three generated variants, pastoral review, scoped
-- organization publishing, member notifications, and scored attempts.

CREATE TABLE IF NOT EXISTS public.daily_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_plan_id UUID NOT NULL REFERENCES public.global_plans(id) ON DELETE CASCADE,
  quiz_date DATE NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('A', 'B', 'C')),
  chapter_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  generation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (generation_status IN ('pending', 'generating', 'ready', 'failed')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved')),
  automatic_generation_attempts SMALLINT NOT NULL DEFAULT 0
    CHECK (automatic_generation_attempts BETWEEN 0 AND 1),
  generation_model TEXT,
  generation_error TEXT,
  generated_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (global_plan_id, quiz_date, variant)
);

CREATE TABLE IF NOT EXISTS public.quiz_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_plan_id UUID NOT NULL REFERENCES public.global_plans(id) ON DELETE CASCADE,
  quiz_date DATE NOT NULL,
  quiz_id UUID NOT NULL REFERENCES public.daily_quizzes(id) ON DELETE RESTRICT,
  small_group_id UUID NOT NULL REFERENCES public.small_groups(id) ON DELETE CASCADE,
  published_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  publisher_role TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (global_plan_id, quiz_date, small_group_id)
);

CREATE TABLE IF NOT EXISTS public.quiz_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.quiz_publications(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '今日小測驗已發布',
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (publication_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.quiz_publications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 5),
  total SMALLINT NOT NULL DEFAULT 5 CHECK (total = 5),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (publication_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quizzes_date_plan_review
  ON public.daily_quizzes(quiz_date DESC, global_plan_id, review_status);
CREATE INDEX IF NOT EXISTS idx_quiz_publications_group_date
  ON public.quiz_publications(small_group_id, quiz_date DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_notifications_recipient_status
  ON public.quiz_notifications(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_publication
  ON public.quiz_attempts(publication_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_small_group_id_active
  ON public.profiles(small_group_id)
  WHERE is_active = TRUE AND small_group_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_daily_quizzes_updated_at ON public.daily_quizzes;
CREATE TRIGGER trg_daily_quizzes_updated_at
  BEFORE UPDATE ON public.daily_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.daily_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.resolve_quiz_actor(p_actor_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $resolve_quiz_actor$
DECLARE
  resolved_id UUID;
BEGIN
  IF p_actor_id IS NOT NULL THEN
    IF auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'actor_override_forbidden';
    END IF;
    resolved_id := p_actor_id;
  ELSE
    resolved_id := public.current_profile_id();
  END IF;
  IF resolved_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = resolved_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'profile_required';
  END IF;
  RETURN resolved_id;
END;
$resolve_quiz_actor$;

CREATE OR REPLACE FUNCTION public.profile_belongs_to_quiz_group(
  p_profile_id UUID,
  p_small_group_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $profile_belongs_to_quiz_group$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.small_groups g ON g.id = p_small_group_id
    LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
    WHERE p.id = p_profile_id
      AND p.is_active = TRUE
      AND (
        p.small_group_id = g.id
        OR (
          public.values_overlap(p.small_group, g.name)
          AND (
            p.pastoral_zone_id = z.id
            OR COALESCE(z.name, '') = ''
            OR public.values_overlap(p.pastoral_zone, z.name)
          )
        )
      )
  );
$profile_belongs_to_quiz_group$;

CREATE OR REPLACE FUNCTION public.can_manage_quiz_group(
  p_actor_id UUID,
  p_small_group_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $can_manage_quiz_group$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.small_groups g ON g.id = p_small_group_id
    LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
    LEFT JOIN public.great_regions r ON r.id = z.great_region_id
    WHERE actor.id = p_actor_id
      AND actor.is_active = TRUE
      AND (
        public.role_code(actor.role_id) IN ('admin', 'pastor')
        OR (
          public.role_code(actor.role_id) = 'great_zone_leader'
          AND public.values_overlap(
            COALESCE(r.name, ''),
            COALESCE(NULLIF(actor.managed_regions, ''), actor.great_region, '')
          )
        )
        OR (
          public.role_code(actor.role_id) = 'zone_leader'
          AND public.values_overlap(
            COALESCE(z.name, ''),
            COALESCE(NULLIF(actor.managed_zones, ''), actor.pastoral_zone, '')
          )
        )
        OR (
          public.role_code(actor.role_id) = 'group_leader'
          AND public.values_overlap(
            g.name,
            COALESCE(NULLIF(actor.managed_groups, ''), actor.small_group, '')
          )
        )
      )
  );
$can_manage_quiz_group$;

CREATE OR REPLACE FUNCTION public.quiz_questions_for_member(
  p_questions JSONB,
  p_include_answers BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $quiz_questions_for_member$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', question->>'id',
      'question', question->>'question',
      'options', question->'options',
      'verseRef', question->>'verseRef'
    ) || CASE WHEN p_include_answers THEN jsonb_build_object(
      'correctIndex', (question->>'correctIndex')::INTEGER,
      'explanation', question->>'explanation'
    ) ELSE '{}'::JSONB END
    ORDER BY ordinal
  ), '[]'::JSONB)
  FROM jsonb_array_elements(COALESCE(p_questions, '[]'::JSONB)) WITH ORDINALITY AS item(question, ordinal);
$quiz_questions_for_member$;

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
  IF p_variant NOT IN ('A', 'B', 'C') THEN RAISE EXCEPTION 'invalid_quiz_variant'; END IF;
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
  ON CONFLICT (global_plan_id, quiz_date, variant) DO NOTHING
  RETURNING id INTO quiz_id;

  IF quiz_id IS NOT NULL THEN
    reserved := TRUE;
  ELSE
    SELECT id INTO quiz_id
    FROM public.daily_quizzes
    WHERE global_plan_id = p_global_plan_id
      AND quiz_date = p_quiz_date
      AND variant = p_variant;
  END IF;

  RETURN jsonb_build_object('quizId', quiz_id, 'reserved', reserved);
END;
$reserve_daily_quiz_generation$;

CREATE OR REPLACE FUNCTION public.complete_daily_quiz_generation(
  p_quiz_id UUID,
  p_questions JSONB,
  p_model TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $complete_daily_quiz_generation$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 5 THEN
    RAISE EXCEPTION 'quiz_five_questions_required';
  END IF;
  UPDATE public.daily_quizzes
  SET questions = p_questions,
      generation_status = 'ready',
      review_status = 'pending',
      generation_model = NULLIF(BTRIM(p_model), ''),
      generation_error = NULL,
      generated_at = NOW(),
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_quiz_id AND generation_status = 'generating';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_generation_not_reserved'; END IF;
END;
$complete_daily_quiz_generation$;

CREATE OR REPLACE FUNCTION public.fail_daily_quiz_generation(
  p_quiz_id UUID,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fail_daily_quiz_generation$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  UPDATE public.daily_quizzes
  SET generation_status = 'failed',
      review_status = 'pending',
      generation_error = LEFT(COALESCE(p_error, 'generation_failed'), 500)
  WHERE id = p_quiz_id AND generation_status = 'generating';
END;
$fail_daily_quiz_generation$;

CREATE OR REPLACE FUNCTION public.review_daily_quiz(
  p_quiz_id UUID,
  p_approved BOOLEAN,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $review_daily_quiz$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  result_row public.daily_quizzes%ROWTYPE;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor') THEN RAISE EXCEPTION 'quiz_review_required'; END IF;
  IF NOT p_approved AND EXISTS (SELECT 1 FROM public.quiz_publications WHERE quiz_id = p_quiz_id) THEN
    RAISE EXCEPTION 'quiz_already_published';
  END IF;

  UPDATE public.daily_quizzes
  SET review_status = CASE WHEN p_approved THEN 'approved' ELSE 'pending' END,
      reviewed_by = CASE WHEN p_approved THEN actor_id ELSE NULL END,
      reviewed_at = CASE WHEN p_approved THEN NOW() ELSE NULL END,
      updated_by = actor_id
  WHERE id = p_quiz_id AND generation_status = 'ready'
  RETURNING * INTO result_row;
  IF result_row.id IS NULL THEN RAISE EXCEPTION 'quiz_not_ready'; END IF;

  RETURN jsonb_build_object(
    'quizId', result_row.id,
    'reviewStatus', result_row.review_status,
    'reviewedAt', result_row.reviewed_at
  );
END;
$review_daily_quiz$;

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
  question JSONB;
  correct_index INTEGER;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor') THEN RAISE EXCEPTION 'quiz_review_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_publications WHERE quiz_id = p_quiz_id) THEN
    RAISE EXCEPTION 'quiz_already_published';
  END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 5 THEN
    RAISE EXCEPTION 'quiz_five_questions_required';
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

CREATE OR REPLACE FUNCTION public.publish_daily_quiz(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_small_group_ids UUID[] DEFAULT NULL,
  p_publish_all BOOLEAN DEFAULT FALSE,
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
  approved_quiz_ids UUID[];
  target_group_ids UUID[];
  requested_count INTEGER := 0;
  target_group_id UUID;
  selected_quiz_id UUID;
  publication_id UUID;
  published_count INTEGER := 0;
  skipped_count INTEGER := 0;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;

  SELECT ARRAY_AGG(id ORDER BY variant) INTO approved_quiz_ids
  FROM public.daily_quizzes
  WHERE global_plan_id = p_global_plan_id
    AND quiz_date = p_quiz_date
    AND generation_status = 'ready'
    AND review_status = 'approved';
  IF COALESCE(CARDINALITY(approved_quiz_ids), 0) = 0 THEN RAISE EXCEPTION 'quiz_approval_required'; END IF;

  IF p_publish_all OR p_small_group_ids IS NULL OR CARDINALITY(p_small_group_ids) = 0 THEN
    SELECT ARRAY_AGG(g.id ORDER BY g.sort_order, g.name) INTO target_group_ids
    FROM public.small_groups g
    WHERE public.can_manage_quiz_group(actor_id, g.id);
  ELSE
    SELECT COUNT(DISTINCT id) INTO requested_count FROM UNNEST(p_small_group_ids) AS requested(id);
    SELECT ARRAY_AGG(g.id ORDER BY g.sort_order, g.name) INTO target_group_ids
    FROM public.small_groups g
    WHERE g.id = ANY(p_small_group_ids)
      AND public.can_manage_quiz_group(actor_id, g.id);
    IF COALESCE(CARDINALITY(target_group_ids), 0) <> requested_count THEN
      RAISE EXCEPTION 'quiz_publish_scope_required';
    END IF;
  END IF;
  IF COALESCE(CARDINALITY(target_group_ids), 0) = 0 THEN RAISE EXCEPTION 'quiz_publish_groups_required'; END IF;

  FOREACH target_group_id IN ARRAY target_group_ids
  LOOP
    selected_quiz_id := approved_quiz_ids[
      1 + MOD(ABS(HASHTEXT(target_group_id::TEXT || p_quiz_date::TEXT)), CARDINALITY(approved_quiz_ids))
    ];
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
    'targetCount', CARDINALITY(target_group_ids)
  );
END;
$publish_daily_quiz$;

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
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT * INTO publication_row FROM public.quiz_publications WHERE id = p_publication_id;
  IF publication_row.id IS NULL THEN RAISE EXCEPTION 'quiz_publication_not_found'; END IF;
  IF NOT public.profile_belongs_to_quiz_group(actor_id, publication_row.small_group_id) THEN
    RAISE EXCEPTION 'quiz_assignment_required';
  END IF;
  SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
  IF quiz_row.id IS NULL OR quiz_row.review_status <> 'approved' THEN RAISE EXCEPTION 'quiz_not_available'; END IF;
  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> 5 THEN
    RAISE EXCEPTION 'quiz_five_answers_required';
  END IF;

  FOR question_index IN 0..4
  LOOP
    IF COALESCE(p_answers->>question_index, '') !~ '^[0-3]$' THEN
      RAISE EXCEPTION 'invalid_quiz_answer';
    END IF;
    answer_index := (p_answers->>question_index)::INTEGER;
    IF answer_index = (quiz_row.questions->question_index->>'correctIndex')::INTEGER THEN
      score_value := score_value + 1;
    END IF;
  END LOOP;

  INSERT INTO public.quiz_attempts(publication_id, user_id, answers, score)
  VALUES (p_publication_id, actor_id, p_answers, score_value)
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
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;

  SELECT publication.* INTO publication_row
  FROM public.quiz_publications publication
  WHERE publication.global_plan_id = p_global_plan_id
    AND publication.quiz_date = p_quiz_date
    AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id)
  ORDER BY publication.published_at DESC
  LIMIT 1;

  IF publication_row.id IS NOT NULL THEN
    SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
    SELECT * INTO attempt_row FROM public.quiz_attempts
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'variant', variant) ORDER BY variant), '[]'::JSONB)
  INTO approved_variants
  FROM public.daily_quizzes
  WHERE global_plan_id = p_global_plan_id
    AND quiz_date = p_quiz_date
    AND generation_status = 'ready'
    AND review_status = 'approved';

  SELECT COALESCE(SUM(automatic_generation_attempts), 0)::INTEGER INTO auto_request_count
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
    WHERE quiz.global_plan_id = p_global_plan_id AND quiz.quiz_date = p_quiz_date;
  END IF;

  IF actor_role IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', group_row.id,
      'name', group_row.name,
      'pastoralZone', group_row.pastoral_zone,
      'greatRegion', group_row.great_region,
      'memberCount', group_row.member_count,
      'publication', group_row.publication,
      'completedCount', group_row.completed_count,
      'averageScore', group_row.average_score,
      'members', group_row.members
    ) ORDER BY group_row.great_region, group_row.pastoral_zone, group_row.name), '[]'::JSONB)
    INTO managed_groups
    FROM (
      SELECT
        g.id,
        g.name,
        COALESCE(z.name, '') AS pastoral_zone,
        COALESCE(r.name, '') AS great_region,
        (SELECT COUNT(*) FROM public.profiles member WHERE public.profile_belongs_to_quiz_group(member.id, g.id)) AS member_count,
        CASE WHEN publication.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', publication.id,
          'variant', published_quiz.variant,
          'publisherRole', publication.publisher_role,
          'publisherName', COALESCE(publisher.name, ''),
          'publishedAt', publication.published_at
        ) END AS publication,
        (SELECT COUNT(*) FROM public.quiz_attempts attempt WHERE attempt.publication_id = publication.id) AS completed_count,
        (SELECT ROUND(AVG(attempt.score)::NUMERIC, 1) FROM public.quiz_attempts attempt WHERE attempt.publication_id = publication.id) AS average_score,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', member.id,
            'name', member.name,
            'completed', attempt.id IS NOT NULL,
            'score', attempt.score,
            'total', attempt.total,
            'completedAt', attempt.completed_at
          ) ORDER BY member.name)
          FROM public.profiles member
          LEFT JOIN public.quiz_attempts attempt
            ON attempt.publication_id = publication.id AND attempt.user_id = member.id
          WHERE public.profile_belongs_to_quiz_group(member.id, g.id)
        ), '[]'::JSONB) AS members
      FROM public.small_groups g
      LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
      LEFT JOIN public.great_regions r ON r.id = z.great_region_id
      LEFT JOIN public.quiz_publications publication
        ON publication.small_group_id = g.id
       AND publication.global_plan_id = p_global_plan_id
       AND publication.quiz_date = p_quiz_date
      LEFT JOIN public.daily_quizzes published_quiz ON published_quiz.id = publication.quiz_id
      LEFT JOIN public.profiles publisher ON publisher.id = publication.published_by
      WHERE public.can_manage_quiz_group(actor_id, g.id)
    ) AS group_row;
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

CREATE OR REPLACE FUNCTION public.get_quiz_notifications(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_quiz_notifications$
DECLARE
  actor_id UUID;
  result JSONB;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', notification.id,
    'type', 'quiz',
    'status', notification.status,
    'message', notification.message,
    'sent_on', publication.quiz_date,
    'globalPlanId', publication.global_plan_id,
    'quizDate', publication.quiz_date,
    'createdAt', notification.created_at,
    'sender', jsonb_build_object(
      'name', publisher.name,
      'role_definition', jsonb_build_object('code', publication.publisher_role)
    )
  ) ORDER BY notification.created_at DESC), '[]'::JSONB) INTO result
  FROM (
    SELECT *
    FROM public.quiz_notifications
    WHERE recipient_id = actor_id
    ORDER BY created_at DESC
    LIMIT 50
  ) notification
  JOIN public.quiz_publications publication ON publication.id = notification.publication_id
  JOIN public.profiles publisher ON publisher.id = publication.published_by
  ;
  RETURN result;
END;
$get_quiz_notifications$;

CREATE OR REPLACE FUNCTION public.mark_quiz_notifications_read(
  p_notification_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $mark_quiz_notifications_read$
DECLARE
  actor_id UUID;
  affected INTEGER;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  UPDATE public.quiz_notifications
  SET status = 'read', read_at = NOW()
  WHERE recipient_id = actor_id
    AND status = 'unread'
    AND (p_notification_id IS NULL OR id = p_notification_id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$mark_quiz_notifications_read$;

REVOKE ALL ON FUNCTION public.resolve_quiz_actor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_belongs_to_quiz_group(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_quiz_group(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_daily_quiz(UUID, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_daily_quiz_questions(UUID, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_daily_quiz(UUID, DATE, UUID[], BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_daily_quiz(UUID, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_quiz_dashboard(UUID, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_quiz_notifications(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_quiz_notifications_read(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_daily_quiz(UUID, BOOLEAN, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_daily_quiz_questions(UUID, JSONB, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(UUID, DATE, UUID[], BOOLEAN, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_daily_quiz(UUID, JSONB, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_dashboard(UUID, DATE, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_quiz_notifications(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_quiz_notifications_read(UUID, UUID) TO authenticated, service_role;

COMMENT ON TABLE public.daily_quizzes IS
  'Three church-wide AI-generated quiz variants per plan/date. Automatic generation is hard-limited to one attempt per variant.';
COMMENT ON TABLE public.quiz_publications IS
  'One immutable quiz assignment per organization small group, plan, and date.';
