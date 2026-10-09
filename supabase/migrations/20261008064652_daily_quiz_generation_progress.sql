-- ============================================================================
-- 20261008064652_daily_quiz_generation_progress.sql  —  #465
--
-- AI 出題的進度與「卡住」自癒：
--   1. daily_quizzes 加 generation_stage（queued → scripture → drafting →
--      reviewing → saving）與 generation_started_at，後台日曆顯示真實步驟。
--   2. 出題中（generating）超過 5 分鐘沒有任何進度更新，就視為失敗
--      （Edge Function 被平台砍掉時來不及寫 failed，原本會永遠卡在出題中）：
--      日曆顯示「出題失敗（generation_timeout）」，「請 AI 出題」與排程都能接手重出。
--   3. swap_daily_quiz_version 不再只是刪掉舊題目再丟背景請求，而是直接建一筆
--      generating／queued 的列，Edge Function 預約時接手；背景請求沒送到時，
--      5 分鐘後一樣會變成失敗，不會停在「等待出題」。
--
-- 函式本體分別取自：reserve_daily_quiz_generation（0092）、
-- reserve_daily_quiz_regeneration（0090）、complete_daily_quiz_generation（0196）、
-- fail_daily_quiz_generation（0084）、get_daily_quiz_calendar（20260928094106）、
-- swap_daily_quiz_version（20260928085701）。
-- 部署順序：先推這支 migration，再部署 generate-daily-quizzes（新版 Edge Function
-- 會呼叫 set_daily_quiz_generation_stage）。舊版 Edge Function 搭配新 migration 仍可運作。
-- ============================================================================

ALTER TABLE public.daily_quizzes
  ADD COLUMN IF NOT EXISTS generation_stage TEXT,
  ADD COLUMN IF NOT EXISTS generation_started_at TIMESTAMPTZ;

ALTER TABLE public.daily_quizzes DROP CONSTRAINT IF EXISTS daily_quizzes_generation_stage_check;
ALTER TABLE public.daily_quizzes ADD CONSTRAINT daily_quizzes_generation_stage_check
  CHECK (generation_stage IS NULL OR generation_stage IN ('queued', 'scripture', 'drafting', 'reviewing', 'saving'));

-- 出題中但超過 5 分鐘沒有進度（updated_at 由觸發器在每次更新時刷新，進度更新就是心跳）
CREATE OR REPLACE FUNCTION public._daily_quiz_generation_stale(p_status text, p_updated_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$
  SELECT COALESCE(p_status = 'generating' AND p_updated_at < NOW() - INTERVAL '5 minutes', FALSE);
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_generation_stale(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_generation_stale(text, timestamptz) TO service_role;

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
    generation_status, automatic_generation_attempts,
    generation_stage, generation_started_at
  ) VALUES (
    p_global_plan_id, p_quiz_date, p_variant, p_chapter_refs,
    'generating', 1,
    'scripture', NOW()
  )
  ON CONFLICT (global_plan_id, quiz_date, variant)
    WHERE variant IN ('A', 'B')
  DO NOTHING
  RETURNING id INTO quiz_id;

  IF quiz_id IS NOT NULL THEN
    reserved := TRUE;
  ELSE
    -- #465：接手「請 AI 出題」建好的排隊列，或已經卡住（超過 5 分鐘沒進度）的出題
    UPDATE public.daily_quizzes quiz
    SET chapter_refs = p_chapter_refs,
        generation_stage = 'scripture',
        generation_started_at = NOW(),
        generation_error = NULL
    WHERE quiz.global_plan_id = p_global_plan_id
      AND quiz.quiz_date = p_quiz_date
      AND quiz.variant = p_variant
      AND quiz.generation_status = 'generating'
      AND (quiz.generation_stage = 'queued'
           OR public._daily_quiz_generation_stale(quiz.generation_status, quiz.updated_at))
      AND NOT EXISTS (SELECT 1 FROM public.quiz_publications publication WHERE publication.quiz_id = quiz.id)
    RETURNING quiz.id INTO quiz_id;

    IF quiz_id IS NOT NULL THEN
      reserved := TRUE;
    ELSE
      SELECT quiz.id INTO quiz_id
      FROM public.daily_quizzes quiz
      WHERE quiz.global_plan_id = p_global_plan_id
        AND quiz.quiz_date = p_quiz_date
        AND quiz.variant = p_variant;
    END IF;
  END IF;

  RETURN jsonb_build_object('quizId', quiz_id, 'reserved', reserved);
END;
$reserve_daily_quiz_generation$;
REVOKE ALL ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_quiz_generation(UUID, DATE, TEXT, JSONB) TO service_role;

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
      generation_stage = 'scripture',
      generation_started_at = NOW(),
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
    -- #465：卡住的出題（超過 5 分鐘沒進度）也可以重做
    AND (quiz.generation_status IN ('failed', 'ready')
         OR public._daily_quiz_generation_stale(quiz.generation_status, quiz.updated_at))
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
REVOKE ALL ON FUNCTION public.reserve_daily_quiz_regeneration(UUID, DATE, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_quiz_regeneration(UUID, DATE, TEXT, JSONB) TO service_role;

-- Edge Function 每進到下一步就呼叫一次；同時刷新 updated_at（心跳）
CREATE OR REPLACE FUNCTION public.set_daily_quiz_generation_stage(p_quiz_id uuid, p_stage text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_stage NOT IN ('scripture', 'drafting', 'reviewing', 'saving') THEN RAISE EXCEPTION 'invalid_generation_stage'; END IF;
  UPDATE public.daily_quizzes
  SET generation_stage = p_stage
  WHERE id = p_quiz_id AND generation_status = 'generating';
END;
$$;
REVOKE ALL ON FUNCTION public.set_daily_quiz_generation_stage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_quiz_generation_stage(uuid, text) TO service_role;

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
      generation_stage = NULL,
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
REVOKE ALL ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) TO service_role;

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
      generation_stage = NULL,
      review_status = 'pending',
      generation_error = LEFT(COALESCE(p_error, 'generation_failed'), 500)
  WHERE id = p_quiz_id AND generation_status = 'generating';
END;
$fail_daily_quiz_generation$;
REVOKE ALL ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT) TO service_role;

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
  ai_stale BOOLEAN;
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
    -- #465：出題中卡超過 5 分鐘沒有進度，當成失敗
    ai_stale := public._daily_quiz_generation_stale(ai.generation_status, ai.updated_at);

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
      WHEN ai.generation_status = 'generating' AND NOT ai_stale THEN 'generating'
      WHEN ai.generation_status = 'failed' OR ai_stale THEN 'failed'
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
      'aiError', CASE WHEN ai_stale THEN 'generation_timeout' ELSE ai.generation_error END,
      'aiStage', CASE WHEN ai_stale THEN NULL ELSE ai.generation_stage END,
      'aiStartedAt', ai.generation_started_at,
      'publishedGroups', pub_groups,
      'closeAt', close_at,
      'eligible', eligible,
      'completed', completed,
      'averageScore', avg_score
    );
  END LOOP;

  RETURN jsonb_build_object(
    'today', today,
    'serverNow', NOW(),
    'autoPublishEnabled', COALESCE((SELECT enabled FROM public.quiz_auto_publish_rules WHERE global_plan_id = p_global_plan_id), FALSE),
    'days', days
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.swap_daily_quiz_version(p_global_plan_id uuid, p_quiz_date date, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  cron_secret TEXT;
  target_url TEXT;
  request_id BIGINT;
  queued_id UUID;
BEGIN
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'quiz_date_passed'; END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans plan
                 WHERE plan.id = p_global_plan_id AND p_quiz_date BETWEEN plan.start_date AND plan.end_date) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;
  -- #465：卡住（超過 5 分鐘沒進度）的出題不算「出題中」，可以重出
  IF EXISTS (SELECT 1 FROM public.daily_quizzes q WHERE q.global_plan_id = p_global_plan_id
             AND q.quiz_date = p_quiz_date AND q.variant = 'A' AND q.generation_status = 'generating'
             AND NOT public._daily_quiz_generation_stale(q.generation_status, q.updated_at)) THEN
    RAISE EXCEPTION 'quiz_generating';
  END IF;

  -- 先確認能叫得到 AI，才刪舊題目（不然會變成沒題目）
  SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets WHERE name = 'quiz_generation_cron_secret' LIMIT 1;
  IF cron_secret IS NULL THEN RAISE EXCEPTION 'quiz_generation_secret_missing'; END IF;
  target_url := public.edge_function_url('generate-daily-quizzes');
  IF target_url IS NULL THEN RAISE EXCEPTION 'edge_function_url_missing'; END IF;

  DELETE FROM public.daily_quizzes q
  WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
    AND NOT EXISTS (SELECT 1 FROM public.quiz_publications pub WHERE pub.quiz_id = q.id);

  -- #465：先建一筆排隊中的列，後台馬上看得到「排隊中」；Edge Function 預約時接手。
  -- 背景請求沒送到的話，5 分鐘後這一列會被當成失敗，不會一直停在等待出題。
  INSERT INTO public.daily_quizzes(
    global_plan_id, quiz_date, variant, generation_status, automatic_generation_attempts,
    generation_stage, generation_started_at
  ) VALUES (
    p_global_plan_id, p_quiz_date, 'A', 'generating', 1, 'queued', NOW()
  )
  ON CONFLICT (global_plan_id, quiz_date, variant) WHERE variant IN ('A', 'B') DO NOTHING
  RETURNING id INTO queued_id;

  SELECT net.http_post(
    url := target_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := jsonb_build_object(
      'source', 'swap',
      'quizDate', p_quiz_date,
      'planId', p_global_plan_id,
      'variants', jsonb_build_array('A'),
      'retryExisting', FALSE,
      'requestedBy', actor_id)
  ) INTO request_id;

  RETURN jsonb_build_object('queued', TRUE, 'requestId', request_id, 'quizId', queued_id);
END;
$$;
REVOKE ALL ON FUNCTION public.swap_daily_quiz_version(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_daily_quiz_version(uuid, date, uuid) TO authenticated, service_role;
