-- ============================================================================
-- 20261019035001_daily_quiz_keep_passed_questions.sql  —  #589
--
-- 小測驗 AI 出題失敗時，保留已通過審核的題目，下次只補不足的題數：
--   1. daily_quizzes.kept_questions：出題失敗時已通過「舉證比對＋盲審」的題目（最多 4 題）。
--   2. fail_daily_quiz_generation 多一個 p_kept_questions（NULL＝不動，例如 503／逾時根本沒審完）。
--      舊的兩個參數版本刪掉，避免 PostgREST 遇到兩個同名函式不知道叫哪個；
--      舊版 Edge Function 用兩個具名參數呼叫，新函式的預設值一樣接得住。
--   3. complete_daily_quiz_generation 成功時清空 kept_questions。
--   4. reserve_daily_quiz_regeneration（20:00 重試）保留；swap_daily_quiz_version
--      （「請 AI 出題」）在出題失敗或卡住時保留，已經出好 5 題時（「換一版」）照舊整版重出。
--   5. get_daily_quiz_calendar 回傳 keptQuestions；remove_daily_quiz_kept_question
--      讓管理員把不要的那一題拿掉（只給系統管理員）。
-- 函式本體取自 20261008064652_daily_quiz_generation_progress.sql。
-- 部署順序：先推這支 migration，再部署 generate-daily-quizzes。
-- ============================================================================

ALTER TABLE public.daily_quizzes
  ADD COLUMN IF NOT EXISTS kept_questions JSONB NOT NULL DEFAULT '[]'::jsonb;

DROP FUNCTION IF EXISTS public.fail_daily_quiz_generation(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.fail_daily_quiz_generation(
  p_quiz_id UUID,
  p_error TEXT,
  p_kept_questions JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fail_daily_quiz_generation$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_kept_questions IS NOT NULL AND jsonb_typeof(p_kept_questions) <> 'array' THEN
    RAISE EXCEPTION 'invalid_kept_questions';
  END IF;
  UPDATE public.daily_quizzes
  SET generation_status = 'failed',
      generation_stage = NULL,
      review_status = 'pending',
      generation_error = LEFT(COALESCE(p_error, 'generation_failed'), 500),
      kept_questions = COALESCE(p_kept_questions, kept_questions)
  WHERE id = p_quiz_id AND generation_status = 'generating';
END;
$fail_daily_quiz_generation$;
REVOKE ALL ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT, JSONB) TO service_role;

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
      kept_questions = '[]'::jsonb,
      generated_at = NOW(),
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_quiz_id AND generation_status = 'generating';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_generation_not_reserved'; END IF;
END;
$complete_daily_quiz_generation$;
REVOKE ALL ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_quiz_generation(UUID, JSONB, TEXT) TO service_role;

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
      -- #589：重試失敗的出題時保留已通過的題目；重出已經出好的就從頭來
      kept_questions = CASE WHEN quiz.generation_status = 'ready' THEN '[]'::jsonb ELSE quiz.kept_questions END,
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
  kept JSONB;
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

  -- #589：出題失敗（或卡住）時已通過審核的題目留著，下次只補不足的題數；
  -- 已經出好 5 題時按「換一版」＝整版重出，不保留。
  SELECT q.kept_questions INTO kept FROM public.daily_quizzes q
  WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
    AND q.generation_status <> 'ready';

  DELETE FROM public.daily_quizzes q
  WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
    AND NOT EXISTS (SELECT 1 FROM public.quiz_publications pub WHERE pub.quiz_id = q.id);

  -- #465：先建一筆排隊中的列，後台馬上看得到「排隊中」；Edge Function 預約時接手。
  -- 背景請求沒送到的話，5 分鐘後這一列會被當成失敗，不會一直停在等待出題。
  INSERT INTO public.daily_quizzes(
    global_plan_id, quiz_date, variant, generation_status, automatic_generation_attempts,
    generation_stage, generation_started_at, kept_questions
  ) VALUES (
    p_global_plan_id, p_quiz_date, 'A', 'generating', 1, 'queued', NOW(), COALESCE(kept, '[]'::jsonb)
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
      -- #589：出題還沒成功時，已通過審核、會保留到下次的題目
      'keptQuestions', CASE WHEN ai.generation_status IS DISTINCT FROM 'ready' THEN COALESCE(ai.kept_questions, '[]'::jsonb) ELSE '[]'::jsonb END,
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

-- ── 管理員拿掉一題保留的題目 ──
CREATE OR REPLACE FUNCTION public.remove_daily_quiz_kept_question(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_question_id TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $remove_daily_quiz_kept_question$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  remaining JSONB;
BEGIN
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  UPDATE public.daily_quizzes q
  SET kept_questions = COALESCE((
        SELECT jsonb_agg(item ORDER BY ordinal)
        FROM jsonb_array_elements(q.kept_questions) WITH ORDINALITY AS kept(item, ordinal)
        WHERE COALESCE(item->>'id', '') <> p_question_id), '[]'::jsonb),
      updated_by = actor_id
  WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
    AND q.generation_status <> 'ready'
  RETURNING q.kept_questions INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'quiz_kept_question_not_found'; END IF;
  RETURN jsonb_build_object('quizDate', p_quiz_date, 'keptCount', jsonb_array_length(remaining));
END;
$remove_daily_quiz_kept_question$;
REVOKE ALL ON FUNCTION public.remove_daily_quiz_kept_question(UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_daily_quiz_kept_question(UUID, DATE, TEXT, UUID) TO authenticated, service_role;
