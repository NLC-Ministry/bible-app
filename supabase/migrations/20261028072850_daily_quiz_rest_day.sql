-- ============================================================================
-- 20261028072850_daily_quiz_rest_day.sql  —  #641
--
-- 沒排章節的日子（補讀日）不出小測驗，後台日曆標「補讀日，不出題」：
--   章數比天數少的月份（例如利未記 27 章分給 10 月 31 天），每日分配取整數 0 章、
--   餘數從第 1 天起每天補 1 章，月底那幾天就沒有章節。Edge Function 這幾天直接回
--   no_reading_chapters，以前日曆卻顯示「等待出題」／按了出題變紅色「出題失敗」。
--   1. _daily_quiz_reading_chapter_count：某計畫某一天分到幾章（和 Edge Function 的
--      resolveDailyChapters、共用排程 buildChurchCampaignDays 同一套算法）；
--      沒有 segments、或 readings 沒填 to 時回 NULL（不判定，行為照舊）。只給 service_role。
--   2. get_daily_quiz_calendar：計畫期間內分到 0 章的日子狀態是 rest_day，
--      不需要處理（needsAttention=false）、不回傳 aiError。
--   3. swap_daily_quiz_version：補讀日回 quiz_rest_day，不建紀錄、不呼叫 AI。
-- 函式本體取自 20261019035001_daily_quiz_keep_passed_questions.sql。
-- 舊版後台不認得 rest_day 時只是顯示成原始字串，重新整理就好；不需要 forceUpdateBuiltBefore。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._daily_quiz_reading_chapter_count(p_global_plan_id uuid, p_quiz_date date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
DECLARE
  segments JSONB;
  seg JSONB;
  reading JSONB;
  total INTEGER := 0;
  day_count INTEGER;
  day_index INTEGER;
BEGIN
  SELECT gp.rules -> 'segments' INTO segments FROM public.global_plans gp WHERE gp.id = p_global_plan_id;
  -- 沒有 segments 的計畫（不是教會階段計畫）不判定
  IF jsonb_typeof(segments) IS DISTINCT FROM 'array' OR jsonb_array_length(segments) = 0 THEN RETURN NULL; END IF;

  -- 和 resolveDailyChapters 一樣取第一個涵蓋這一天的段落；沒有段落涵蓋＝沒排章節
  SELECT s.value INTO seg
  FROM jsonb_array_elements(segments) WITH ORDINALITY AS s(value, ord)
  WHERE s.value ->> 'startDate' <= to_char(p_quiz_date, 'YYYY-MM-DD') AND s.value ->> 'endDate' >= to_char(p_quiz_date, 'YYYY-MM-DD')
  ORDER BY s.ord
  LIMIT 1;
  IF seg IS NULL THEN RETURN 0; END IF;

  FOR reading IN SELECT r.value FROM jsonb_array_elements(COALESCE(seg -> 'readings', '[]'::jsonb)) AS r(value) LOOP
    -- 沒填 to（整卷書）時這裡沒有書卷章數可查：不判定，照舊交給 Edge Function
    IF COALESCE(reading ->> 'to', '') !~ '^[0-9]+$' OR COALESCE(reading ->> 'from', '1') !~ '^[0-9]+$' THEN RETURN NULL; END IF;
    total := total + GREATEST(0, (reading ->> 'to')::int - COALESCE((reading ->> 'from')::int, 1) + 1);
  END LOOP;

  day_count := ((seg ->> 'endDate')::date - (seg ->> 'startDate')::date) + 1;
  day_index := p_quiz_date - (seg ->> 'startDate')::date;
  IF day_count <= 0 OR day_index < 0 OR day_index >= day_count THEN RETURN 0; END IF;
  RETURN total / day_count + CASE WHEN day_index < total % day_count THEN 1 ELSE 0 END;
END;
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_reading_chapter_count(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_reading_chapter_count(uuid, date) TO service_role;

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
  -- #641：補讀日（這一天沒排章節）不出題
  IF public._daily_quiz_reading_chapter_count(p_global_plan_id, p_quiz_date) = 0 THEN RAISE EXCEPTION 'quiz_rest_day'; END IF;
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
  rest_day BOOLEAN;
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
    -- #641：計畫期間內、但這一天沒排章節（章數比天數少的月份，月底那幾天）
    rest_day := plan_start IS NOT NULL AND d BETWEEN plan_start AND plan_end
      AND public._daily_quiz_reading_chapter_count(p_global_plan_id, d) = 0;

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
      -- #641：補讀日不出題也不發佈；以前按出題留下的失敗紀錄也蓋過去，不再標紅
      WHEN rest_day THEN 'rest_day'
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
      'aiError', CASE WHEN rest_day THEN NULL WHEN ai_stale THEN 'generation_timeout' ELSE ai.generation_error END,
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
