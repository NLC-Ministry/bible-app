-- 小測驗自動排程發佈 + 作答截止時間。
--
-- 現況（發佈永遠是「按下去馬上發」）：publish_daily_quiz 沒有任何時間參數，
-- quiz_publications.published_at 一律 DEFAULT NOW()，daily_quiz_submit_answer／
-- daily_quiz_finalize_attempt／submit_daily_quiz 完全沒有任何時間檢查。這支
-- migration 加兩個獨立但相關的概念：
--   1. 排程發佈——admin.js「發佈」分頁選好範圍/版本後，除了「馬上發佈」，
--      也可以「設定排程」：存一筆 pending 排程，時間到了由 pg_cron 掃描後
--      自動呼叫 publish_daily_quiz。使用者要求「要先審核/確認過題目才能設
--      定排程」，所以 schedule_daily_quiz_publish 對 A/B/自訂題目的就緒檢查
--      跟 publish_daily_quiz 完全一樣（同一段邏輯搬過來，不是等時間到了才
--      發現題目沒就緒）。
--   2. 作答截止時間——排程時可以順便指定一個可選的 answer_close_at，寫進
--      quiz_publications；三支送出答案的 RPC 都要擋「已經截止還硬送」。
--      立即發佈（沒有走排程）維持 answer_close_at = NULL，行為不變。
--
-- 排程本身不是「每天固定」，是每次進發佈分頁手動決定當天（quiz_date）要不
-- 要用；同一天只能有一筆待發佈排程（partial unique index），要換就先取消。

-- ── 1. 新表：待發佈排程 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quiz_publication_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_plan_id UUID NOT NULL REFERENCES public.global_plans(id) ON DELETE CASCADE,
  quiz_date DATE NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'zone', 'region', 'all')),
  scope_name TEXT,
  variant TEXT CHECK (variant IN ('A', 'B')),
  custom_questions JSONB,
  publish_at TIMESTAMPTZ NOT NULL,
  answer_close_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'cancelled', 'failed')),
  failure_reason TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fired_at TIMESTAMPTZ,
  CHECK ((variant IS NOT NULL) <> (custom_questions IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_publication_schedules_one_pending_per_day
  ON public.quiz_publication_schedules(global_plan_id, quiz_date)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_quiz_publication_schedules_due
  ON public.quiz_publication_schedules(publish_at)
  WHERE status = 'pending';

ALTER TABLE public.quiz_publication_schedules ENABLE ROW LEVEL SECURITY;
-- 沒有任何 policy——跟 daily_quizzes/quiz_publications 一樣，一律走
-- SECURITY DEFINER RPC，不開放前端直接 .from() 存取。

-- ── 2. quiz_publications 加作答截止欄位（nullable，立即發佈維持 NULL）──

ALTER TABLE public.quiz_publications
  ADD COLUMN IF NOT EXISTS answer_close_at TIMESTAMPTZ;

-- ── 3. publish_daily_quiz：尾端加一個可選的作答截止時間參數 ───────────
-- 只加新參數（在最尾端、有 DEFAULT），不改既有參數的順序/型別，Postgres
-- 才會當成「replace 同一個函式」而不是另外疊一個 overload；既有的
-- REVOKE/GRANT 沿用同一個簽章寫一次即可。

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

-- ── 4. schedule_daily_quiz_publish：驗證邏輯跟 publish_daily_quiz 前半段
-- 完全一樣（這就是「要先審核/確認過才能排程」的實際檢查點），驗過了不是
-- 馬上發，是存一筆 pending 排程，等 pg_cron 掃到時間才真的發。────────────

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

  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN
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

-- ── 5. cancel_daily_quiz_schedule ─────────────────────────────────────
-- 權限刻意只給「本人」或 admin/pastor，不比照 publish_daily_quiz 重新算一次
-- 範圍內有哪些小組——一筆排程本來就只可能是設定它的那個人負責的範圍，不用
-- 再重算，而且避免「另一個管得到重疊範圍的區長」誤取消別人排程。

CREATE OR REPLACE FUNCTION public.cancel_daily_quiz_schedule(
  p_schedule_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cancel_daily_quiz_schedule$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  schedule_row public.quiz_publication_schedules%ROWTYPE;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  SELECT * INTO schedule_row
  FROM public.quiz_publication_schedules
  WHERE id = p_schedule_id AND status = 'pending';
  IF schedule_row.id IS NULL THEN
    RAISE EXCEPTION 'quiz_schedule_not_found';
  END IF;

  IF actor_role NOT IN ('admin', 'pastor') AND schedule_row.created_by <> actor_id THEN
    RAISE EXCEPTION 'quiz_publish_scope_required';
  END IF;

  UPDATE public.quiz_publication_schedules
  SET status = 'cancelled'
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object('id', p_schedule_id, 'status', 'cancelled');
END;
$cancel_daily_quiz_schedule$;

REVOKE ALL ON FUNCTION public.cancel_daily_quiz_schedule(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_daily_quiz_schedule(UUID, UUID) TO authenticated, service_role;

-- ── 6. run_daily_quiz_schedule_sweep：pg_cron 掃描，只有排程 Edge Function
-- 用 service-role client 呼叫得到（沒加進 nlc-data 的 allowlist）。每筆排程
-- 用獨立的 BEGIN/EXCEPTION 包住，一筆發佈失敗不影響其他筆。────────────────

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

-- ── 7. 作答截止檢查：daily_quiz_submit_answer／daily_quiz_finalize_attempt／
-- submit_daily_quiz 都要擋「已經截止還硬送」。────────────────────────────

CREATE OR REPLACE FUNCTION public.daily_quiz_submit_answer(
  p_publication_id      UUID,
  p_question_id         TEXT,
  p_response            JSONB,
  p_time_spent_seconds  INTEGER DEFAULT NULL,
  p_actor_id            UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $daily_quiz_submit_answer$
DECLARE
  actor_id         UUID;
  publication_row  public.quiz_publications%ROWTYPE;
  quiz_row         public.daily_quizzes%ROWTYPE;
  attempt_row      public.quiz_attempts%ROWTYPE;
  question         JSONB;
  question_type    TEXT;
  is_correct       BOOLEAN;
  remaining_answers JSONB;
  updated_answers  JSONB;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT * INTO publication_row FROM public.quiz_publications WHERE id = p_publication_id;
  IF publication_row.id IS NULL THEN RAISE EXCEPTION 'quiz_publication_not_found'; END IF;
  IF NOT public.profile_belongs_to_quiz_group(actor_id, publication_row.small_group_id) THEN
    RAISE EXCEPTION 'quiz_assignment_required';
  END IF;
  IF publication_row.answer_close_at IS NOT NULL AND NOW() > publication_row.answer_close_at THEN
    RAISE EXCEPTION 'quiz_answer_window_closed';
  END IF;
  SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
  IF quiz_row.id IS NULL OR quiz_row.review_status <> 'approved' THEN RAISE EXCEPTION 'quiz_not_available'; END IF;

  SELECT q INTO question FROM jsonb_array_elements(quiz_row.questions) q
    WHERE COALESCE(q->>'id', '') = p_question_id;
  IF question IS NULL THEN RAISE EXCEPTION 'quiz_question_not_found'; END IF;
  -- 舊格式（AI 產生）沒有 type 欄位，一律當單選判分。
  question_type := COALESCE(question->>'type', 'single');
  is_correct := public._quiz_answer_is_correct(
    question_type,
    COALESCE(question->'answerKey', question->'correctIndex'),
    p_response
  );

  SELECT * INTO attempt_row FROM public.quiz_attempts
    WHERE publication_id = p_publication_id AND user_id = actor_id;

  IF attempt_row.id IS NULL THEN
    INSERT INTO public.quiz_attempts(publication_id, user_id, answers, score, total, status, started_at, completed_at)
    VALUES (p_publication_id, actor_id, '[]'::JSONB, NULL, jsonb_array_length(quiz_row.questions), 'in_progress', NOW(), NULL)
    ON CONFLICT (publication_id, user_id) DO NOTHING
    RETURNING * INTO attempt_row;
    IF attempt_row.id IS NULL THEN
      SELECT * INTO attempt_row FROM public.quiz_attempts
        WHERE publication_id = p_publication_id AND user_id = actor_id;
    END IF;
  END IF;

  IF attempt_row.status = 'submitted' THEN RAISE EXCEPTION 'quiz_already_submitted'; END IF;

  -- 同一題重送＝取代舊的那筆（讓離線佇列重試也是安全、可重複執行的操作）。
  SELECT COALESCE(jsonb_agg(a), '[]'::JSONB) INTO remaining_answers
  FROM jsonb_array_elements(attempt_row.answers) a
  WHERE COALESCE(a->>'questionId', '') <> p_question_id;

  updated_answers := remaining_answers || jsonb_build_array(jsonb_build_object(
    'questionId', p_question_id,
    'response', p_response,
    'correct', is_correct,
    'timeSpentSeconds', p_time_spent_seconds
  ));

  UPDATE public.quiz_attempts SET answers = updated_answers WHERE id = attempt_row.id;

  RETURN jsonb_build_object(
    'attemptId', attempt_row.id,
    'questionId', p_question_id,
    'correct', is_correct,
    'answeredCount', jsonb_array_length(updated_answers),
    'totalQuestions', attempt_row.total
  );
END;
$daily_quiz_submit_answer$;

REVOKE ALL ON FUNCTION public.daily_quiz_submit_answer(UUID, TEXT, JSONB, INTEGER, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.daily_quiz_finalize_attempt(
  p_publication_id UUID,
  p_actor_id       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $daily_quiz_finalize_attempt$
DECLARE
  actor_id      UUID;
  attempt_row   public.quiz_attempts%ROWTYPE;
  publication_row public.quiz_publications%ROWTYPE;
  correct_count INTEGER;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT * INTO attempt_row FROM public.quiz_attempts
    WHERE publication_id = p_publication_id AND user_id = actor_id;
  IF attempt_row.id IS NULL THEN RAISE EXCEPTION 'quiz_attempt_not_found'; END IF;

  IF attempt_row.status = 'submitted' THEN
    RETURN jsonb_build_object(
      'attemptId', attempt_row.id, 'score', attempt_row.score, 'total', attempt_row.total,
      'completedAt', attempt_row.completed_at, 'alreadySubmitted', TRUE
    );
  END IF;

  SELECT * INTO publication_row FROM public.quiz_publications WHERE id = attempt_row.publication_id;
  IF publication_row.answer_close_at IS NOT NULL AND NOW() > publication_row.answer_close_at THEN
    RAISE EXCEPTION 'quiz_answer_window_closed';
  END IF;

  IF jsonb_array_length(attempt_row.answers) < attempt_row.total THEN
    RAISE EXCEPTION 'quiz_incomplete';
  END IF;

  SELECT COUNT(*) INTO correct_count
  FROM jsonb_array_elements(attempt_row.answers) a
  WHERE (a->>'correct')::BOOLEAN IS TRUE;

  UPDATE public.quiz_attempts
  SET score = correct_count, status = 'submitted', completed_at = NOW()
  WHERE id = attempt_row.id
  RETURNING * INTO attempt_row;

  RETURN jsonb_build_object(
    'attemptId', attempt_row.id, 'score', attempt_row.score, 'total', attempt_row.total,
    'answers', attempt_row.answers, 'completedAt', attempt_row.completed_at
  );
END;
$daily_quiz_finalize_attempt$;

REVOKE ALL ON FUNCTION public.daily_quiz_finalize_attempt(UUID, UUID) FROM PUBLIC, anon, authenticated;

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
  IF publication_row.answer_close_at IS NOT NULL AND NOW() > publication_row.answer_close_at THEN
    RAISE EXCEPTION 'quiz_answer_window_closed';
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

-- ── 8. get_daily_quiz_dashboard：myQuiz 帶 answerCloseAt，canPublish 角色
-- 多回傳今天這個 plan/date 的 pendingSchedule（有的話）。────────────────────

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
  'Returns quiz review, publication, and attempt data. Review queue and approved-variant badges are scoped to A/B only; self-authored C quizzes are personal to their publish action. managedGroups is ordered by great_regions/pastoral_zones.sort_order (migration 0133), not name. pendingSchedule (migration 0189) is the one pending auto-publish schedule for this plan/date, if any.';

-- ── 9. pg_cron：每 5 分鐘掃一次到期排程 ────────────────────────────────
-- 密鑰設定（跟 devotion video sync / issue report maintenance 同一套流程）：
--   SELECT vault.create_secret('<隨機字串>', 'daily_quiz_schedule_sweep_cron_secret', '排程發佈掃描器共用密鑰');
-- Edge Function 的環境變數 DAILY_QUIZ_SCHEDULE_SWEEP_SECRET 要設成同一個值。

CREATE OR REPLACE FUNCTION public.invoke_daily_quiz_schedule_sweep()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_daily_quiz_schedule_sweep$
DECLARE
  cron_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'daily_quiz_schedule_sweep_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'daily_quiz_schedule_sweep_cron_secret not found in Vault; skipping daily quiz schedule sweep';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/daily-quiz-schedule-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$invoke_daily_quiz_schedule_sweep$;

REVOKE ALL ON FUNCTION public.invoke_daily_quiz_schedule_sweep() FROM PUBLIC;

DO $schedule_daily_quiz_sweep$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'daily-quiz-schedule-sweep' LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'daily-quiz-schedule-sweep',
    '*/5 * * * *',
    'SELECT public.invoke_daily_quiz_schedule_sweep();'
  );
END;
$schedule_daily_quiz_sweep$;

NOTIFY pgrst, 'reload schema';
