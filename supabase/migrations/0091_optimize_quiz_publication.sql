-- Publish every target group and its member notifications with set-based
-- statements.  The previous per-group loop repeatedly scanned profiles and
-- could exceed Postgres' statement timeout for region/church-wide publishes,
-- rolling the whole transaction back.

CREATE OR REPLACE FUNCTION public.publish_daily_quiz(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,
  p_scope_name TEXT DEFAULT NULL,
  p_variant TEXT DEFAULT NULL,
  p_custom_questions JSONB DEFAULT NULL,
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
  target_count INTEGER := 0;
  published_count INTEGER := 0;
  skipped_count INTEGER := 0;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

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
      'ready', 'approved', actor_id, NOW(), NOW(), 0
    )
    RETURNING id INTO selected_quiz_id;
  ELSE
    IF COALESCE(p_variant, '') NOT IN ('A', 'B') THEN
      RAISE EXCEPTION 'quiz_not_ready';
    END IF;
    SELECT id INTO selected_quiz_id
    FROM public.daily_quizzes
    WHERE global_plan_id = p_global_plan_id
      AND quiz_date = p_quiz_date
      AND variant = p_variant
      AND generation_status = 'ready'
      AND review_status = 'approved';
    IF selected_quiz_id IS NULL THEN
      RAISE EXCEPTION 'quiz_not_ready';
    END IF;
  END IF;

  SELECT ARRAY_AGG(g.id ORDER BY g.id)
  INTO target_group_ids
  FROM public.small_groups g
  LEFT JOIN public.pastoral_zones z ON z.id = g.pastoral_zone_id
  LEFT JOIN public.great_regions r ON r.id = z.great_region_id
  WHERE public.can_manage_quiz_group(actor_id, g.id)
    AND (
      p_scope_type = 'all'
      OR (p_scope_type = 'group' AND g.name = p_scope_name)
      OR (p_scope_type = 'zone' AND COALESCE(z.name, '') = p_scope_name)
      OR (p_scope_type = 'region' AND COALESCE(r.name, '') = p_scope_name)
    );

  target_count := COALESCE(CARDINALITY(target_group_ids), 0);
  IF target_count = 0 THEN
    RAISE EXCEPTION 'quiz_publish_groups_required';
  END IF;

  INSERT INTO public.quiz_publications(
    global_plan_id, quiz_date, quiz_id, small_group_id, published_by, publisher_role
  )
  SELECT p_global_plan_id, p_quiz_date, selected_quiz_id, target_group_id, actor_id, actor_role
  FROM UNNEST(target_group_ids) AS target(target_group_id)
  ON CONFLICT (global_plan_id, quiz_date, small_group_id) DO NOTHING;

  GET DIAGNOSTICS published_count = ROW_COUNT;
  skipped_count := target_count - published_count;

  -- Direct small_group_id assignments use the partial profile index.  The
  -- second branch preserves legacy text-only assignments without making the
  -- common path call profile_belongs_to_quiz_group once per profile/group.
  INSERT INTO public.quiz_notifications(publication_id, recipient_id, message)
  SELECT recipient.publication_id, recipient.recipient_id, '每日小測驗已發布，完成後即可查看結果。'
  FROM (
    SELECT publication.id AS publication_id, profile.id AS recipient_id
    FROM public.quiz_publications publication
    JOIN public.profiles profile
      ON profile.small_group_id = publication.small_group_id
     AND profile.is_active = TRUE
    WHERE publication.global_plan_id = p_global_plan_id
      AND publication.quiz_date = p_quiz_date
      AND publication.quiz_id = selected_quiz_id
      AND publication.small_group_id = ANY(target_group_ids)

    UNION

    SELECT publication.id AS publication_id, profile.id AS recipient_id
    FROM public.quiz_publications publication
    JOIN public.small_groups group_row ON group_row.id = publication.small_group_id
    LEFT JOIN public.pastoral_zones zone_row ON zone_row.id = group_row.pastoral_zone_id
    JOIN public.profiles profile
      ON profile.is_active = TRUE
     AND profile.small_group_id IS NULL
     AND public.values_overlap(profile.small_group, group_row.name)
     AND (
       profile.pastoral_zone_id = zone_row.id
       OR COALESCE(zone_row.name, '') = ''
       OR public.values_overlap(profile.pastoral_zone, zone_row.name)
     )
    WHERE publication.global_plan_id = p_global_plan_id
      AND publication.quiz_date = p_quiz_date
      AND publication.quiz_id = selected_quiz_id
      AND publication.small_group_id = ANY(target_group_ids)
  ) AS recipient
  ON CONFLICT (publication_id, recipient_id) DO NOTHING;

  RETURN jsonb_build_object(
    'publishedCount', published_count,
    'skippedCount', skipped_count,
    'targetCount', target_count,
    'quizId', selected_quiz_id
  );
END;
$publish_daily_quiz$;

REVOKE ALL ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

