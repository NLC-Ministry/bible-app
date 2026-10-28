-- ============================================================================
-- 20261028075515_daily_quiz_makeup.sql  —  #643
--
-- 小測驗開放補發過去沒發出去的日子（例如 10/26 兩次自動出題都失敗、當天沒人補救）：
--   補發範圍：同一個計畫期間內（計畫還沒結束）、從來沒發佈過、不是補讀日（#641）、
--   沒有設「這天不發」的過去日子——_daily_quiz_makeup_allowed。
--   1. swap_daily_quiz_version（請 AI 出題）、set_daily_quiz_day_custom（自訂題目）：
--      符合補發範圍的過去日子不再擋 quiz_date_passed。
--   2. publish_daily_quiz_makeup（只給系統管理員）：發給全部小組，作答到補發當天 23:59（台北）；
--      題目來源和 00:00 自動發佈一樣（自訂題目優先，否則已備妥的 AI 題目）。成績算進原本那一天。
--   3. get_daily_quiz_calendar：可補發的過去日子回傳 canMakeup，照「等待出題／出題中／
--      出題失敗／已排程」顯示；過去的日子不標紅（needsAttention）。
--   4. get_daily_quiz_dashboard：多回傳 makeupQuizzes（過去日期、還在作答期間、發給自己小組
--      的發佈），形狀和 myQuiz 相同；兩者共用 _daily_quiz_member_view。
-- 函式本體取自 20261028072850_daily_quiz_rest_day.sql（swap、calendar）、
-- 20260928085701_daily_quiz_calendar.sql（custom）、20260929043341_daily_quiz_drop_legacy_publish.sql（dashboard）。
-- 依賴 20261028072850（_daily_quiz_reading_chapter_count）。
-- 只新增欄位與 RPC：舊版 App 忽略 makeupQuizzes，不需要 forceUpdateBuiltBefore。
-- 部署：nlc-data（允許 publish_daily_quiz_makeup）與 admin-api（稽核標籤）要重新部署。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._daily_quiz_makeup_allowed(p_global_plan_id uuid, p_quiz_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$
  SELECT p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date
    AND EXISTS (SELECT 1 FROM public.global_plans gp
                WHERE gp.id = p_global_plan_id
                  AND p_quiz_date BETWEEN gp.start_date AND gp.end_date
                  AND (NOW() AT TIME ZONE 'Asia/Taipei')::date <= gp.end_date)
    AND NOT public._daily_quiz_day_published(p_global_plan_id, p_quiz_date)
    AND public._daily_quiz_reading_chapter_count(p_global_plan_id, p_quiz_date) IS DISTINCT FROM 0
    AND NOT EXISTS (SELECT 1 FROM public.quiz_daily_overrides o
                    WHERE o.global_plan_id = p_global_plan_id AND o.quiz_date = p_quiz_date AND o.skip)
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_makeup_allowed(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_makeup_allowed(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public._daily_quiz_member_view(p_publication_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
DECLARE
  publication_row public.quiz_publications%ROWTYPE;
  quiz_row public.daily_quizzes%ROWTYPE;
  attempt_row public.quiz_attempts%ROWTYPE;
  actor_id UUID := p_actor_id;
BEGIN
  SELECT * INTO publication_row FROM public.quiz_publications WHERE id = p_publication_id;
  IF publication_row.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = publication_row.quiz_id;
  SELECT * INTO attempt_row
  FROM public.quiz_attempts
  WHERE publication_id = publication_row.id AND user_id = actor_id;
  RETURN jsonb_build_object(
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
END;
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_member_view(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_member_view(uuid, uuid) TO service_role;

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
  -- #643：同計畫期間內、還沒發佈的過去日子可以補出題、之後補發
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date
     AND NOT public._daily_quiz_makeup_allowed(p_global_plan_id, p_quiz_date) THEN
    RAISE EXCEPTION 'quiz_date_passed';
  END IF;
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

CREATE OR REPLACE FUNCTION public.set_daily_quiz_day_custom(p_global_plan_id uuid, p_quiz_date date, p_questions jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  old_custom UUID;
  new_custom UUID;
BEGIN
  -- #643：同計畫期間內、還沒發佈的過去日子可以補出題、之後補發
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date
     AND NOT public._daily_quiz_makeup_allowed(p_global_plan_id, p_quiz_date) THEN
    RAISE EXCEPTION 'quiz_date_passed';
  END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  IF p_questions IS NOT NULL THEN
    PERFORM public.validate_daily_quiz_questions(p_questions, 2, 10);
  END IF;

  SELECT custom_quiz_id INTO old_custom FROM public.quiz_daily_overrides
  WHERE global_plan_id = p_global_plan_id AND quiz_date = p_quiz_date;

  IF p_questions IS NOT NULL THEN
    INSERT INTO public.daily_quizzes(
      global_plan_id, quiz_date, variant, chapter_refs, questions,
      generation_status, review_status, reviewed_by, reviewed_at, generated_at, automatic_generation_attempts)
    VALUES (
      p_global_plan_id, p_quiz_date, 'C',
      COALESCE((SELECT q.chapter_refs FROM public.daily_quizzes q
                WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'), '[]'::jsonb),
      p_questions, 'ready', 'approved', actor_id, NOW(), NOW(), 0)
    RETURNING id INTO new_custom;
  END IF;

  INSERT INTO public.quiz_daily_overrides(global_plan_id, quiz_date, custom_quiz_id, updated_by, updated_at)
  VALUES (p_global_plan_id, p_quiz_date, new_custom, actor_id, NOW())
  ON CONFLICT (global_plan_id, quiz_date) DO UPDATE
    SET custom_quiz_id = EXCLUDED.custom_quiz_id, updated_by = EXCLUDED.updated_by, updated_at = NOW();

  -- 換掉的舊自訂題目沒有發佈過，直接刪掉，不留孤兒資料
  IF old_custom IS NOT NULL THEN
    DELETE FROM public.daily_quizzes q WHERE q.id = old_custom
      AND NOT EXISTS (SELECT 1 FROM public.quiz_publications pub WHERE pub.quiz_id = q.id);
  END IF;

  RETURN jsonb_build_object('quizDate', p_quiz_date, 'source', CASE WHEN new_custom IS NULL THEN 'ai' ELSE 'custom' END);
END;
$$;
REVOKE ALL ON FUNCTION public.set_daily_quiz_day_custom(uuid, date, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_quiz_day_custom(uuid, date, jsonb, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_daily_quiz_makeup(p_global_plan_id uuid, p_quiz_date date, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
  close_at TIMESTAMPTZ := ((((NOW() AT TIME ZONE 'Asia/Taipei')::date) + TIME '23:59:59') AT TIME ZONE 'Asia/Taipei');
  custom_questions JSONB;
  publish_result JSONB;
BEGIN
  -- 條件和 _daily_quiz_makeup_allowed 相同，這裡逐條檢查好給後台看得懂的錯誤
  IF p_quiz_date IS NULL OR p_quiz_date >= today THEN RAISE EXCEPTION 'quiz_makeup_not_past'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans gp
                 WHERE gp.id = p_global_plan_id AND p_quiz_date BETWEEN gp.start_date AND gp.end_date) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans gp WHERE gp.id = p_global_plan_id AND today <= gp.end_date) THEN
    RAISE EXCEPTION 'quiz_makeup_plan_ended';
  END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  IF public._daily_quiz_reading_chapter_count(p_global_plan_id, p_quiz_date) = 0 THEN RAISE EXCEPTION 'quiz_rest_day'; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_daily_overrides o
             WHERE o.global_plan_id = p_global_plan_id AND o.quiz_date = p_quiz_date AND o.skip) THEN
    RAISE EXCEPTION 'quiz_day_skipped';
  END IF;

  -- 和 run_daily_quiz_auto_publish 一樣：有自訂題目發自訂題目，否則發已備妥的 AI 題目
  SELECT q.questions INTO custom_questions
  FROM public.quiz_daily_overrides o JOIN public.daily_quizzes q ON q.id = o.custom_quiz_id
  WHERE o.global_plan_id = p_global_plan_id AND o.quiz_date = p_quiz_date;
  IF custom_questions IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.daily_quizzes q
    WHERE q.global_plan_id = p_global_plan_id AND q.quiz_date = p_quiz_date AND q.variant = 'A'
      AND q.generation_status = 'ready' AND q.review_status = 'approved') THEN
    RAISE EXCEPTION 'quiz_not_ready';
  END IF;

  publish_result := public.publish_daily_quiz(
    p_global_plan_id := p_global_plan_id,
    p_quiz_date := p_quiz_date,
    p_scope_type := 'all',
    p_scope_name := NULL,
    p_variant := CASE WHEN custom_questions IS NULL THEN 'A' END,
    p_custom_questions := custom_questions,
    p_actor_id := p_actor_id,
    p_answer_close_at := close_at);

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'source', CASE WHEN custom_questions IS NULL THEN 'ai' ELSE 'custom' END,
    'publishedCount', publish_result -> 'publishedCount',
    'answerCloseAt', close_at,
    'publishedBy', actor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_daily_quiz_makeup(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz_makeup(uuid, date, uuid) TO authenticated, service_role;

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
  can_makeup BOOLEAN;
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
    -- #643：過去沒發出去、還能補發的日子照「等待出題／出題中／失敗／已排程」顯示，不是「沒有發佈」
    can_makeup := d < today AND public._daily_quiz_makeup_allowed(p_global_plan_id, d);

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
      WHEN d < today AND NOT can_makeup THEN 'not_published'
      WHEN source IS NOT NULL THEN 'scheduled'
      WHEN ai.generation_status = 'generating' AND NOT ai_stale THEN 'generating'
      WHEN ai.generation_status = 'failed' OR ai_stale THEN 'failed'
      ELSE 'waiting'
    END;

    days := days || jsonb_build_object(
      'date', d,
      'status', status,
      'source', source,
      -- 補發是管理員自己決定要不要做的事，過去的日子不標紅
      'needsAttention', d >= today AND (status = 'failed'
        OR (status IN ('waiting', 'generating') AND (d = today OR (d = today + 1 AND EXTRACT(HOUR FROM now_taipei) >= 12)))),
      'canMakeup', can_makeup,
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
  my_quiz JSONB := NULL;
  makeup_quizzes JSONB := '[]'::jsonb;
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  SELECT publication.* INTO publication_row
  FROM public.quiz_publications publication
  WHERE publication.global_plan_id = p_global_plan_id
    AND publication.quiz_date = p_quiz_date
    AND publication.scope_type = 'group'
    AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id)
  ORDER BY publication.published_at DESC
  LIMIT 1;

  IF publication_row.id IS NOT NULL THEN
    my_quiz := public._daily_quiz_member_view(publication_row.id, actor_id);
  END IF;

  -- #643：過去日期補發、還在作答期間、發給自己小組的測驗（一天一份，依日期排）
  SELECT COALESCE(jsonb_agg(public._daily_quiz_member_view(makeup.id, actor_id) ORDER BY makeup.quiz_date), '[]'::jsonb)
  INTO makeup_quizzes
  FROM (
    SELECT DISTINCT ON (publication.quiz_date) publication.id, publication.quiz_date
    FROM public.quiz_publications publication
    WHERE publication.global_plan_id = p_global_plan_id
      AND publication.quiz_date < p_quiz_date
      AND publication.scope_type = 'group'
      AND publication.answer_close_at IS NOT NULL
      AND publication.answer_close_at > NOW()
      AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id)
    ORDER BY publication.quiz_date, publication.published_at DESC
  ) makeup;

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'role', actor_role,
    'myQuiz', my_quiz,
    'makeupQuizzes', makeup_quizzes
  );
END;
$get_daily_quiz_dashboard$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) TO authenticated, service_role;
