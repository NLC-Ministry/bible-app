-- 0196_daily_quiz_simplify_review_announcement_stats.sql
--
-- 小測驗簡化，三件事：
--   (a) AI 生成完直接視為審核通過，不再需要牧者/管理員手動核准。
--   (b) 拿掉「同時發佈到首頁公告」——公告只影響 church_announcements，小測驗
--       本身給每個收件人的站內提醒（quiz_notifications）完全不受影響、照常發送。
--   (c) 統計簡化：只留參與率＋完整名單（含尚未作答的人），拿掉平均分數／
--       平均作答時間／每題正確率／PR／排行榜公布整套。會友自己完成後看得到
--       正解（本來就有，見 quiz_questions_for_member 的 include_answers），
--       這裡另外加上自己的作答時間。
--
-- 發佈權限（admin/pastor/大區長/牧區長/小組長）維持不變。小測驗跟大測驗
-- （exam_papers）本來就是兩套獨立資料表，互不影響，不用特別處理共存。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

-- ── (a) AI 生成即視為審核通過 ───────────────────────────────────────────────

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
  -- review_status 直接進 'approved'：不再有人工審核這道關卡。reviewed_by/
  -- reviewed_at 刻意留 NULL——沒有人真的審過，不要假造一筆審核紀錄。
  UPDATE public.daily_quizzes
  SET questions = p_questions,
      generation_status = 'ready',
      review_status = 'approved',
      generation_model = NULLIF(BTRIM(p_model), ''),
      generation_error = NULL,
      generated_at = NOW(),
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_quiz_id AND generation_status = 'generating';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_generation_not_reserved'; END IF;
END;
$complete_daily_quiz_generation$;

-- ── (b) 拿掉公告：publish_daily_quiz / schedule_daily_quiz_publish 簽名各少一個參數 ──

CREATE OR REPLACE FUNCTION public.publish_daily_quiz(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,
  p_scope_name TEXT DEFAULT NULL,
  p_variant TEXT DEFAULT NULL,
  p_custom_questions JSONB DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_answer_close_at TIMESTAMPTZ DEFAULT NULL
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
  admin_publication_id UUID;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  IF p_scope_type = 'admin' THEN
    IF actor_role NOT IN ('admin', 'pastor') THEN
      RAISE EXCEPTION 'quiz_publish_scope_required';
    END IF;
  ELSIF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all', 'admin') THEN
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

  IF p_scope_type = 'admin' THEN
    INSERT INTO public.quiz_publications(
      global_plan_id, quiz_date, quiz_id, small_group_id, scope_type, published_by, publisher_role, answer_close_at
    ) VALUES (
      p_global_plan_id, p_quiz_date, selected_quiz_id, NULL, 'admin', actor_id, actor_role, p_answer_close_at
    )
    ON CONFLICT (global_plan_id, quiz_date) WHERE scope_type = 'admin' DO UPDATE
      SET quiz_id = EXCLUDED.quiz_id, published_by = EXCLUDED.published_by,
          publisher_role = EXCLUDED.publisher_role, answer_close_at = EXCLUDED.answer_close_at,
          published_at = NOW()
    RETURNING id INTO admin_publication_id;

    INSERT INTO public.quiz_notifications(publication_id, recipient_id, message)
    SELECT admin_publication_id, profile.id, '每日小測驗（測試發布）已發布，完成後即可查看結果。'
    FROM public.profiles profile
    WHERE profile.is_active = TRUE
      AND public.role_code(profile.role_id) = 'admin'
    ON CONFLICT (publication_id, recipient_id) DO NOTHING;

    published_count := 1;
    target_count := 1;
    skipped_count := 0;
  ELSE
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
      global_plan_id, quiz_date, quiz_id, small_group_id, scope_type, published_by, publisher_role, answer_close_at
    )
    SELECT p_global_plan_id, p_quiz_date, selected_quiz_id, target_group_id, 'group', actor_id, actor_role, p_answer_close_at
    FROM UNNEST(target_group_ids) AS target(target_group_id)
    ON CONFLICT (global_plan_id, quiz_date, small_group_id) DO NOTHING;

    GET DIAGNOSTICS published_count = ROW_COUNT;
    skipped_count := target_count - published_count;

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
  END IF;

  RETURN jsonb_build_object(
    'publishedCount', published_count,
    'skippedCount', skipped_count,
    'targetCount', target_count,
    'quizId', selected_quiz_id
  );
END;
$publish_daily_quiz$;

REVOKE ALL ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ) TO authenticated, service_role;

-- 舊的 9-參數簽名（含 p_post_announcement）不會再被呼叫，清掉避免 PostgREST
-- 兩個同名多載搞混。
DROP FUNCTION IF EXISTS public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ, BOOLEAN);

CREATE OR REPLACE FUNCTION public.schedule_daily_quiz_publish(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,
  p_scope_name TEXT DEFAULT NULL,
  p_variant TEXT DEFAULT NULL,
  p_custom_questions JSONB DEFAULT NULL,
  p_publish_at TIMESTAMPTZ DEFAULT NULL,
  p_answer_close_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $schedule_daily_quiz_publish$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  ready_quiz_id UUID;
  new_schedule public.quiz_publication_schedules%ROWTYPE;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  IF p_scope_type = 'admin' THEN
    IF actor_role NOT IN ('admin', 'pastor') THEN
      RAISE EXCEPTION 'quiz_publish_scope_required';
    END IF;
  ELSIF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all', 'admin') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF p_publish_at IS NULL OR p_publish_at <= NOW() THEN
    RAISE EXCEPTION 'quiz_schedule_publish_time_required';
  END IF;

  IF p_custom_questions IS NOT NULL THEN
    PERFORM public.validate_daily_quiz_questions(p_custom_questions, 2, 10);
  ELSE
    IF COALESCE(p_variant, '') NOT IN ('A', 'B') THEN
      RAISE EXCEPTION 'quiz_not_ready';
    END IF;
    SELECT id INTO ready_quiz_id
    FROM public.daily_quizzes
    WHERE global_plan_id = p_global_plan_id
      AND quiz_date = p_quiz_date
      AND variant = p_variant
      AND generation_status = 'ready'
      AND review_status = 'approved';
    IF ready_quiz_id IS NULL THEN
      RAISE EXCEPTION 'quiz_not_ready';
    END IF;
  END IF;

  INSERT INTO public.quiz_publication_schedules(
    global_plan_id, quiz_date, scope_type, scope_name, variant, custom_questions,
    publish_at, answer_close_at, status, created_by
  ) VALUES (
    p_global_plan_id, p_quiz_date, p_scope_type, p_scope_name, p_variant, p_custom_questions,
    p_publish_at, p_answer_close_at, 'pending', actor_id
  )
  RETURNING * INTO new_schedule;

  RETURN jsonb_build_object(
    'id', new_schedule.id,
    'scopeType', new_schedule.scope_type,
    'scopeName', new_schedule.scope_name,
    'variant', new_schedule.variant,
    'hasCustomQuestions', new_schedule.custom_questions IS NOT NULL,
    'publishAt', new_schedule.publish_at,
    'answerCloseAt', new_schedule.answer_close_at
  );
END;
$schedule_daily_quiz_publish$;

REVOKE ALL ON FUNCTION public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN);

-- post_announcement 這個欄位跟著功能一起拿掉，不留死欄位。
ALTER TABLE public.quiz_publication_schedules
  DROP COLUMN IF EXISTS post_announcement;

CREATE OR REPLACE FUNCTION public.run_daily_quiz_schedule_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $run_daily_quiz_schedule_sweep$
DECLARE
  schedule_row public.quiz_publication_schedules%ROWTYPE;
  publish_result JSONB;
  processed_count INTEGER := 0;
  published_count INTEGER := 0;
  failed_count INTEGER := 0;
BEGIN
  FOR schedule_row IN
    SELECT * FROM public.quiz_publication_schedules
    WHERE status = 'pending' AND publish_at <= NOW()
    ORDER BY publish_at
  LOOP
    processed_count := processed_count + 1;
    BEGIN
      SELECT public.publish_daily_quiz(
        p_global_plan_id := schedule_row.global_plan_id,
        p_quiz_date := schedule_row.quiz_date,
        p_scope_type := schedule_row.scope_type,
        p_scope_name := schedule_row.scope_name,
        p_variant := schedule_row.variant,
        p_custom_questions := schedule_row.custom_questions,
        p_actor_id := schedule_row.created_by,
        p_answer_close_at := schedule_row.answer_close_at
      ) INTO publish_result;

      UPDATE public.quiz_publication_schedules
      SET status = 'published', fired_at = NOW()
      WHERE id = schedule_row.id;
      published_count := published_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.quiz_publication_schedules
      SET status = 'failed', failure_reason = SQLERRM, fired_at = NOW()
      WHERE id = schedule_row.id;
      failed_count := failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', processed_count,
    'published', published_count,
    'failed', failed_count
  );
END;
$run_daily_quiz_schedule_sweep$;

REVOKE ALL ON FUNCTION public.run_daily_quiz_schedule_sweep() FROM PUBLIC;

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
  pending_schedule JSONB := NULL;
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
    AND (
      (publication.scope_type = 'group' AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id))
      OR (publication.scope_type = 'admin' AND actor_role = 'admin')
    )
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
      'answerCloseAt', publication_row.answer_close_at,
      'questions', public.quiz_questions_for_member(quiz_row.questions, attempt_row.id IS NOT NULL),
      'attempt', CASE WHEN attempt_row.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', attempt_row.id,
        'answers', attempt_row.answers,
        'score', attempt_row.score,
        'total', attempt_row.total,
        'completedAt', attempt_row.completed_at,
        'timeSeconds', CASE WHEN attempt_row.completed_at > attempt_row.started_at
          THEN ROUND(EXTRACT(EPOCH FROM (attempt_row.completed_at - attempt_row.started_at))::numeric, 0) ELSE NULL END
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
    SELECT jsonb_build_object(
      'id', schedule.id,
      'scopeType', schedule.scope_type,
      'scopeName', schedule.scope_name,
      'variant', schedule.variant,
      'hasCustomQuestions', schedule.custom_questions IS NOT NULL,
      'publishAt', schedule.publish_at,
      'answerCloseAt', schedule.answer_close_at
    )
    INTO pending_schedule
    FROM public.quiz_publication_schedules schedule
    WHERE schedule.global_plan_id = p_global_plan_id
      AND schedule.quiz_date = p_quiz_date
      AND schedule.status = 'pending';

    WITH manageable_groups AS MATERIALIZED (
      SELECT
        g.id,
        g.name,
        g.pastoral_zone_id,
        COALESCE(z.name, '') AS pastoral_zone,
        COALESCE(r.name, '') AS great_region,
        z.sort_order AS zone_sort_order,
        r.sort_order AS great_region_sort_order
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
        AND publication.scope_type = 'group'
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
    ) ORDER BY group_row.great_region_sort_order NULLS LAST, group_row.zone_sort_order NULLS LAST,
      group_row.great_region, group_row.pastoral_zone, group_row.name), '[]'::JSONB)
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
    'myQuiz', my_quiz,
    'pendingSchedule', pending_schedule
  );
END;
$get_daily_quiz_dashboard$;

COMMENT ON FUNCTION public.get_daily_quiz_dashboard(UUID, DATE, UUID) IS
  'Returns quiz review, publication, and attempt data. AI-generated A/B variants auto-approve on generation (migration 0196) — reviewQuizzes/approvedVariants still reflect review_status for display, but nothing gates on a human review action anymore. managedGroups only reflects scope_type=''group'' publications. myQuiz.attempt includes timeSeconds (completed_at - started_at) so the member sees their own pace. pendingSchedule no longer carries postAnnouncement (removed in 0196). scope_type=''admin'' (0195) publishes to every admin profile for safe self-testing.';

-- ── (c) 統計簡化：只留參與率＋完整名單，拿掉平均分數/作答時間/每題正確率/PR ──

CREATE OR REPLACE FUNCTION public.daily_quiz_get_stats(
  p_global_plan_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $daily_quiz_get_stats$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  scoped_publication_ids UUID[];
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_stats_permission_required';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'quiz_stats_date_range_required';
  END IF;

  SELECT COALESCE(array_agg(qp.id), '{}') INTO scoped_publication_ids
  FROM public.quiz_publications qp
  JOIN public.daily_quizzes dq ON dq.id = qp.quiz_id
  WHERE dq.global_plan_id = p_global_plan_id
    AND qp.quiz_date BETWEEN p_from_date AND p_to_date
    AND qp.scope_type = 'group'
    AND public.can_manage_quiz_group(actor_id, qp.small_group_id);

  RETURN jsonb_build_object(
    -- 參與率：每天發布對象裡，實際有送出答案的比例。
    'trend', COALESCE((
      WITH per_publication AS (
        SELECT
          dq.quiz_date,
          qp.id AS publication_id,
          (
            SELECT COUNT(DISTINCT p.id)
            FROM public.profiles p
            JOIN public.reading_plans rp ON rp.user_id = p.id AND rp.global_plan_id = p_global_plan_id
            WHERE p.small_group_id = qp.small_group_id AND p.is_active = TRUE
          ) AS eligible
        FROM public.quiz_publications qp
        JOIN public.daily_quizzes dq ON dq.id = qp.quiz_id
        WHERE qp.id = ANY(scoped_publication_ids)
      ),
      eligible_by_date AS (
        SELECT quiz_date, SUM(eligible) AS eligible_sum
        FROM per_publication
        GROUP BY quiz_date
      ),
      attempts_by_date AS (
        SELECT
          pp.quiz_date,
          COUNT(qa.id) FILTER (WHERE qa.status = 'submitted') AS submitted_count
        FROM per_publication pp
        LEFT JOIN public.quiz_attempts qa ON qa.publication_id = pp.publication_id
        GROUP BY pp.quiz_date
      )
      SELECT jsonb_agg(jsonb_build_object(
        'quizDate', e.quiz_date,
        'eligible', e.eligible_sum,
        'submitted', COALESCE(a.submitted_count, 0),
        'participationRate', CASE WHEN e.eligible_sum > 0
          THEN ROUND(COALESCE(a.submitted_count, 0)::numeric / e.eligible_sum * 100, 1) ELSE NULL END
      ) ORDER BY e.quiz_date)
      FROM eligible_by_date e
      LEFT JOIN attempts_by_date a ON a.quiz_date = e.quiz_date
    ), '[]'::jsonb),

    -- 完整名單：範圍內每個有資格作答的人都列一筆，包含還沒作答的（completed=false）。
    'roster', COALESCE((
      WITH eligible_members AS (
        SELECT DISTINCT
          qp.id AS publication_id,
          dq.quiz_date,
          p.id AS user_id,
          p.name,
          sg.name AS small_group,
          pz.name AS pastoral_zone,
          gr.name AS great_region
        FROM public.quiz_publications qp
        JOIN public.daily_quizzes dq ON dq.id = qp.quiz_id
        JOIN public.profiles p ON p.small_group_id = qp.small_group_id AND p.is_active = TRUE
        JOIN public.reading_plans rp ON rp.user_id = p.id AND rp.global_plan_id = p_global_plan_id
        LEFT JOIN public.small_groups sg ON sg.id = qp.small_group_id
        LEFT JOIN public.pastoral_zones pz ON pz.id = sg.pastoral_zone_id
        LEFT JOIN public.great_regions gr ON gr.id = pz.great_region_id
        WHERE qp.id = ANY(scoped_publication_ids)
      )
      SELECT jsonb_agg(jsonb_build_object(
        'userId', em.user_id,
        'name', em.name,
        'smallGroup', em.small_group,
        'pastoralZone', em.pastoral_zone,
        'greatRegion', em.great_region,
        'quizDate', em.quiz_date,
        'completed', qa.id IS NOT NULL,
        'score', qa.score,
        'total', qa.total,
        'completedAt', qa.completed_at
      ) ORDER BY em.quiz_date DESC, em.name)
      FROM eligible_members em
      LEFT JOIN public.quiz_attempts qa
        ON qa.publication_id = em.publication_id AND qa.user_id = em.user_id AND qa.status = 'submitted'
    ), '[]'::jsonb)
  );
END;
$daily_quiz_get_stats$;

REVOKE ALL ON FUNCTION public.daily_quiz_get_stats(UUID, DATE, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_quiz_get_stats(UUID, DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.daily_quiz_get_stats(UUID, DATE, DATE, UUID) IS
  '後台範圍內的小測驗統計（migration 0196 簡化版）：trend 只留每天參與率，roster 列出範圍內每個有資格作答的人（含還沒作答的，completed=false）。不再有平均分數/平均作答時間/每題正確率/PR，只看 scope_type=''group'' 的發布（不含 admin 測試發布）。';

-- ── 會友端「我的測驗」：拿掉 PR/排行榜，加上自己的作答時間 ─────────────────

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
      'timeSeconds', qa.time_seconds
    ) ORDER BY qa.quiz_date DESC)
    FROM (
      SELECT qa.score, qa.total, dq.quiz_date,
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
GRANT EXECUTE ON FUNCTION public.daily_quiz_get_my_results(UUID, DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.daily_quiz_get_my_results(UUID, DATE, DATE, UUID) IS
  '會友端「我的測驗」小測驗分頁用（migration 0196 簡化版）：只回傳呼叫者自己的分數與作答時間，不再有 PR/排行榜，不含任何他人分數或名次。';

-- PR／排行榜公布整套不再被任何地方呼叫，一併清掉，不留死程式碼。
DROP FUNCTION IF EXISTS public.daily_quiz_reveal_leaderboard(UUID, DATE, UUID);
DROP FUNCTION IF EXISTS public._daily_quiz_score_pop(UUID, DATE, UUID, UUID);
DROP FUNCTION IF EXISTS public._daily_quiz_team_avg_pop(UUID, DATE, INTEGER);

-- 人工審核整支 RPC 也不再被任何地方呼叫（AI 生成即核准，見上方 (a)）。
DROP FUNCTION IF EXISTS public.review_daily_quiz(UUID, BOOLEAN, UUID);

NOTIFY pgrst, 'reload schema';
