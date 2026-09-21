-- 小測驗發佈時，可以選擇「同時發佈到首頁公告」。
--
-- 首頁公告（church_announcements）目前完全沒有範圍/對象概念——is_published
-- 就是全教會看得到，跟小測驗發佈可以只選一個小組/牧區完全不一樣。所以這個
-- 選項刻意只在發佈範圍＝「全部小組」時才能勾（前後端都擋），避免沒收到這
-- 份測驗的會友看到公告以為自己也有，造成誤會。
--
-- schedule_announcement（migration 0185）當初是為了「之後 PR 公布會呼叫它」
-- 先準備的通用能力，但從來沒有真的被呼叫過（0187 甚至把它的 EXECUTE 權限
-- 整個收回，前端/service_role 都叫不到）。這裡第一次真的用它——從
-- publish_daily_quiz 內部呼叫，不需要另外 GRANT：SECURITY DEFINER 函式互相
-- 呼叫時是用「擁有者」的權限，兩個函式是同一個 migration 角色建的，本來就
-- 叫得動。公告內容固定、不開放自訂文字，避免變成一個小小的公告編輯器；
-- expires_at 設在 quiz_date 隔天台灣午夜，測驗當天結束後公告自動失效，不用
-- 管理員手動清理。

-- ── 1. quiz_publication_schedules 加欄位（nullable? 不，NOT NULL DEFAULT
-- FALSE——排程跟立即發佈的驗證邏輯共用同一套「必須全部小組」規則）───────

ALTER TABLE public.quiz_publication_schedules
  ADD COLUMN IF NOT EXISTS post_announcement BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. publish_daily_quiz：尾端加 p_post_announcement，勾了就順便發公告 ──

CREATE OR REPLACE FUNCTION public.publish_daily_quiz(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,
  p_scope_name TEXT DEFAULT NULL,
  p_variant TEXT DEFAULT NULL,
  p_custom_questions JSONB DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_answer_close_at TIMESTAMPTZ DEFAULT NULL,
  p_post_announcement BOOLEAN DEFAULT FALSE
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
  announcement_expires_at TIMESTAMPTZ;
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
  IF p_post_announcement AND p_scope_type <> 'all' THEN
    RAISE EXCEPTION 'quiz_announcement_requires_church_wide';
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
    global_plan_id, quiz_date, quiz_id, small_group_id, published_by, publisher_role, answer_close_at
  )
  SELECT p_global_plan_id, p_quiz_date, selected_quiz_id, target_group_id, actor_id, actor_role, p_answer_close_at
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

  IF p_post_announcement THEN
    announcement_expires_at := (p_quiz_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei';
    PERFORM public.schedule_announcement(
      '【提醒】今日小測驗已發布',
      '今天的小測驗已經發布，完成速讀進度後就可以進入作答囉！',
      NOW(),
      actor_id,
      announcement_expires_at
    );
  END IF;

  RETURN jsonb_build_object(
    'publishedCount', published_count,
    'skippedCount', skipped_count,
    'targetCount', target_count,
    'quizId', selected_quiz_id
  );
END;
$publish_daily_quiz$;

REVOKE ALL ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ, BOOLEAN) TO authenticated, service_role;

-- ── 3. schedule_daily_quiz_publish：一樣尾端加 p_post_announcement，同一套
-- 「必須全部小組」驗證，存進新欄位，等 sweep 真的發佈時才會真的發公告。────

CREATE OR REPLACE FUNCTION public.schedule_daily_quiz_publish(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_scope_type TEXT,
  p_scope_name TEXT DEFAULT NULL,
  p_variant TEXT DEFAULT NULL,
  p_custom_questions JSONB DEFAULT NULL,
  p_publish_at TIMESTAMPTZ DEFAULT NULL,
  p_answer_close_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_post_announcement BOOLEAN DEFAULT FALSE
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

  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF p_post_announcement AND p_scope_type <> 'all' THEN
    RAISE EXCEPTION 'quiz_announcement_requires_church_wide';
  END IF;
  IF p_publish_at IS NULL OR p_publish_at <= NOW() THEN
    RAISE EXCEPTION 'quiz_schedule_publish_time_required';
  END IF;

  -- 就緒檢查：跟 publish_daily_quiz 完全同一套規則，只是驗完不發、先存起來。
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
    publish_at, answer_close_at, status, created_by, post_announcement
  ) VALUES (
    p_global_plan_id, p_quiz_date, p_scope_type, p_scope_name, p_variant, p_custom_questions,
    p_publish_at, p_answer_close_at, 'pending', actor_id, COALESCE(p_post_announcement, FALSE)
  )
  RETURNING * INTO new_schedule;

  RETURN jsonb_build_object(
    'id', new_schedule.id,
    'scopeType', new_schedule.scope_type,
    'scopeName', new_schedule.scope_name,
    'variant', new_schedule.variant,
    'hasCustomQuestions', new_schedule.custom_questions IS NOT NULL,
    'publishAt', new_schedule.publish_at,
    'answerCloseAt', new_schedule.answer_close_at,
    'postAnnouncement', new_schedule.post_announcement
  );
END;
$schedule_daily_quiz_publish$;

REVOKE ALL ON FUNCTION public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) TO authenticated, service_role;

-- ── 4. run_daily_quiz_schedule_sweep：把排程存的 post_announcement 傳給
-- publish_daily_quiz。其餘邏輯不變。──────────────────────────────────────

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
        p_answer_close_at := schedule_row.answer_close_at,
        p_post_announcement := schedule_row.post_announcement
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

-- ── 5. get_daily_quiz_dashboard：pendingSchedule 多帶 postAnnouncement ────

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
      'answerCloseAt', publication_row.answer_close_at,
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
    SELECT jsonb_build_object(
      'id', schedule.id,
      'scopeType', schedule.scope_type,
      'scopeName', schedule.scope_name,
      'variant', schedule.variant,
      'hasCustomQuestions', schedule.custom_questions IS NOT NULL,
      'publishAt', schedule.publish_at,
      'answerCloseAt', schedule.answer_close_at,
      'postAnnouncement', schedule.post_announcement
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
  'Returns quiz review, publication, and attempt data. Review queue and approved-variant badges are scoped to A/B only; self-authored C quizzes are personal to their publish action. managedGroups is ordered by great_regions/pastoral_zones.sort_order (migration 0133), not name. pendingSchedule (migration 0189/0190) is the one pending auto-publish schedule for this plan/date, if any, including whether it will also post a home announcement.';

NOTIFY pgrst, 'reload schema';
