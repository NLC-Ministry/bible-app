-- 0195_daily_quiz_admin_scope_and_scoped_announcement.sql
--
-- 兩件事：
--   (a) 小測驗發佈新增 p_scope_type = 'admin'：只發給系統管理員，不透過任何
--       小組，讓管理員可以用自己的帳號實際看到會友端畫面長怎樣，而不會有
--       任何真實會友收到、也不會混進任何小組的平均分數/名單。
--   (b) 「同時發佈到首頁公告」不再只能綁「全部小組」——公告本身現在也帶
--       跟測驗一樣的範圍（大區/牧區/小組/僅系統管理員），只有範圍內的人看
--       得到，admin 一律看得到全部（沿用 church_announcements 既有的
--       admin bypass）。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

-- ── 1. quiz_publications：small_group_id 改成可為空，加 scope_type ────────
-- 既有的 UNIQUE (global_plan_id, quiz_date, small_group_id) 對 NULL
-- small_group_id 不會擋重複（Postgres 唯一約束把每個 NULL 都當成不同值），
-- 所以額外用 partial unique index 擋「同一天發第二次 admin 測試」。

ALTER TABLE public.quiz_publications
  ALTER COLUMN small_group_id DROP NOT NULL;

ALTER TABLE public.quiz_publications
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'group'
    CHECK (scope_type IN ('group', 'admin'));

ALTER TABLE public.quiz_publications
  ADD CONSTRAINT quiz_publications_scope_shape_check
    CHECK (
      (scope_type = 'group' AND small_group_id IS NOT NULL)
      OR (scope_type = 'admin' AND small_group_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_publications_admin_scope
  ON public.quiz_publications(global_plan_id, quiz_date)
  WHERE scope_type = 'admin';

-- 排程發佈用的是另一張表，scope_type 有自己的 CHECK，也要加 'admin' 進去，
-- 否則「排程發佈＋僅系統管理員」一律被資料庫擋掉。
ALTER TABLE public.quiz_publication_schedules
  DROP CONSTRAINT IF EXISTS quiz_publication_schedules_scope_type_check;
ALTER TABLE public.quiz_publication_schedules
  ADD CONSTRAINT quiz_publication_schedules_scope_type_check
    CHECK (scope_type IN ('group', 'zone', 'region', 'all', 'admin'));

-- ── 2. church_announcements：加範圍欄位。NULL/'all' = 現行行為（全教會）──

ALTER TABLE public.church_announcements
  ADD COLUMN IF NOT EXISTS audience_scope_type TEXT,
  ADD COLUMN IF NOT EXISTS audience_scope_name TEXT;

ALTER TABLE public.church_announcements
  ADD CONSTRAINT church_announcements_audience_scope_check
    CHECK (audience_scope_type IS NULL OR audience_scope_type IN ('all', 'region', 'zone', 'group', 'admin'));

CREATE OR REPLACE FUNCTION public.profile_matches_announcement_scope(
  p_profile_id UUID,
  p_scope_type TEXT,
  p_scope_name TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $profile_matches_announcement_scope$
  SELECT CASE
    WHEN p_scope_type IS NULL OR p_scope_type = 'all' THEN TRUE
    WHEN p_scope_type = 'admin' THEN EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND public.role_code(p.role_id) = 'admin'
    )
    WHEN p_scope_type = 'region' THEN EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND public.values_overlap(p.great_region, p_scope_name)
    )
    WHEN p_scope_type = 'zone' THEN EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND public.values_overlap(p.pastoral_zone, p_scope_name)
    )
    WHEN p_scope_type = 'group' THEN EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND public.values_overlap(p.small_group, p_scope_name)
    )
    ELSE FALSE
  END;
$profile_matches_announcement_scope$;

REVOKE ALL ON FUNCTION public.profile_matches_announcement_scope(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_matches_announcement_scope(UUID, TEXT, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS announcements_read_published ON public.church_announcements;
CREATE POLICY announcements_read_published ON public.church_announcements FOR SELECT TO authenticated
  USING (
    (is_published = TRUE AND public.profile_matches_announcement_scope(public.current_profile_id(), audience_scope_type, audience_scope_name))
    OR (SELECT my_role FROM public.get_my_profile()) = 'admin'
  );

-- ── 3. schedule_announcement：尾端加範圍參數（'all' 存成 NULL，跟既有資料一致）──

CREATE OR REPLACE FUNCTION public.schedule_announcement(
  p_title        TEXT,
  p_content      TEXT,
  p_published_at TIMESTAMPTZ DEFAULT NOW(),
  p_created_by   UUID DEFAULT NULL,
  p_expires_at   TIMESTAMPTZ DEFAULT NULL,
  p_scope_type   TEXT DEFAULT NULL,
  p_scope_name   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF BTRIM(COALESCE(p_title, '')) = '' THEN RAISE EXCEPTION 'announcement_title_required'; END IF;
  IF p_scope_type IS NOT NULL AND p_scope_type NOT IN ('all', 'region', 'zone', 'group', 'admin') THEN
    RAISE EXCEPTION 'announcement_scope_invalid';
  END IF;
  INSERT INTO public.church_announcements(
    title, content, is_published, published_at, expires_at, created_by,
    audience_scope_type, audience_scope_name
  )
  VALUES (
    p_title, COALESCE(p_content, ''), TRUE, COALESCE(p_published_at, NOW()), p_expires_at, p_created_by,
    NULLIF(p_scope_type, 'all'),
    CASE WHEN p_scope_type IN ('region', 'zone', 'group') THEN p_scope_name ELSE NULL END
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_announcement(TEXT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_announcement(TEXT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

-- ── 4. publish_daily_quiz：加 'admin' 範圍分支；公告不再限「全部小組」───────

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
  admin_publication_id UUID;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  -- 'admin' 範圍是拿自己帳號測試用的，只有 admin/pastor 能發（本來就能管全部
  -- 小組，這裡只是換一條不吃小組模型的路徑，不是放寬權限）。
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
  END IF;

  IF p_post_announcement THEN
    announcement_expires_at := (p_quiz_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei';
    PERFORM public.schedule_announcement(
      '【提醒】今日小測驗已發布',
      '今天的小測驗已經發布，完成速讀進度後就可以進入作答囉！',
      NOW(),
      actor_id,
      announcement_expires_at,
      p_scope_type,
      p_scope_name
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

-- ── 5. schedule_daily_quiz_publish：範圍檢查同步加 'admin' ─────────────────

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

-- ── 6. get_daily_quiz_dashboard：myQuiz 多認 admin 範圍的發布 ──────────────

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
  'Returns quiz review, publication, and attempt data. Review queue and approved-variant badges are scoped to A/B only; self-authored C quizzes are personal to their publish action. managedGroups only reflects scope_type=''group'' publications (admin-scope test publications are personal, surfaced only via myQuiz for the admin who is a recipient). pendingSchedule (migration 0189/0190) is the one pending auto-publish schedule for this plan/date, if any, including whether it will also post a home announcement. scope_type=''admin'' (migration 0195) publishes to every admin profile, bypassing the small-group model entirely, for safely previewing the member experience without touching any real group''s stats.';

NOTIFY pgrst, 'reload schema';
