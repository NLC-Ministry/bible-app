-- ============================================================================
-- 20260928085701_daily_quiz_calendar.sql  —  #307（小測驗 Q2，屬於 #305）
--
-- 小測驗後台改成 7 天日曆。這支 migration 提供日曆需要的後端（全部只給系統管理員）：
--   · get_daily_quiz_calendar：每天一格的狀態、題目、完成率
--       準備中的狀態：等待出題／出題中／出題失敗／已排程（AI 題目或自訂題目）／這天不發
--       發佈後：作答中／已結束；過去沒發的日子：沒有發佈
--       needsAttention：今天或明天（中午後）還沒有題目、或 AI 出題失敗 → 後台標紅
--       （缺題只在後台標紅，不另外發通知，#306 決定）
--   · set_daily_quiz_day_skip：這天不發／恢復
--   · set_daily_quiz_day_custom：改成自訂題目（存成 C 版）／改回 AI 題目
--   · swap_daily_quiz_version：換一版——刪掉還沒發佈的 A 版，請 AI 重新出題。
--     原本的 request_daily_quiz_regeneration 遇到已核准的題目會拒絕，而 AI 題目
--     一律自動核准，所以另外寫。daily_quizzes 的鎖定 trigger 只擋 UPDATE。
--   · run_daily_quiz_auto_publish：有自訂題目的日子發自訂題目。
-- 已經發佈的日子一律不能再改（quiz_already_published）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._daily_quiz_require_admin(p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF (SELECT public.role_code(role_id) FROM public.profiles WHERE id = actor_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'quiz_publish_admin_only';
  END IF;
  RETURN actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_require_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_require_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._daily_quiz_day_published(p_global_plan_id uuid, p_quiz_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.quiz_publications
                 WHERE global_plan_id = p_global_plan_id AND quiz_date = p_quiz_date)
$$;
REVOKE ALL ON FUNCTION public._daily_quiz_day_published(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_quiz_day_published(uuid, date) TO service_role;

-- ── 日曆 ──
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
BEGIN
  PERFORM public._daily_quiz_require_admin(p_actor_id);
  start_day := COALESCE(p_from, today);

  FOR i IN 0 .. GREATEST(LEAST(COALESCE(p_days, 7), 31), 1) - 1 LOOP
    d := start_day + i;
    ov := NULL; ai := NULL; custom := NULL;
    SELECT * INTO ov FROM public.quiz_daily_overrides WHERE global_plan_id = p_global_plan_id AND quiz_date = d;
    SELECT * INTO ai FROM public.daily_quizzes WHERE global_plan_id = p_global_plan_id AND quiz_date = d AND variant = 'A';
    IF ov.custom_quiz_id IS NOT NULL THEN
      SELECT * INTO custom FROM public.daily_quizzes WHERE id = ov.custom_quiz_id;
    END IF;

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
      WHEN COALESCE(ov.skip, FALSE) THEN 'skipped'
      WHEN d < today THEN 'not_published'
      WHEN source IS NOT NULL THEN 'scheduled'
      WHEN ai.generation_status = 'generating' THEN 'generating'
      WHEN ai.generation_status = 'failed' THEN 'failed'
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
      'aiError', ai.generation_error,
      'publishedGroups', pub_groups,
      'closeAt', close_at,
      'eligible', eligible,
      'completed', completed,
      'averageScore', avg_score
    );
  END LOOP;

  RETURN jsonb_build_object(
    'today', today,
    'autoPublishEnabled', COALESCE((SELECT enabled FROM public.quiz_auto_publish_rules WHERE global_plan_id = p_global_plan_id), FALSE),
    'days', days
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) TO authenticated, service_role;

-- ── 這天不發／恢復 ──
CREATE OR REPLACE FUNCTION public.set_daily_quiz_day_skip(p_global_plan_id uuid, p_quiz_date date, p_skip boolean, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
BEGIN
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'quiz_date_passed'; END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  INSERT INTO public.quiz_daily_overrides(global_plan_id, quiz_date, skip, updated_by, updated_at)
  VALUES (p_global_plan_id, p_quiz_date, COALESCE(p_skip, FALSE), actor_id, NOW())
  ON CONFLICT (global_plan_id, quiz_date) DO UPDATE
    SET skip = EXCLUDED.skip, updated_by = EXCLUDED.updated_by, updated_at = NOW();
  RETURN jsonb_build_object('quizDate', p_quiz_date, 'skip', COALESCE(p_skip, FALSE));
END;
$$;
REVOKE ALL ON FUNCTION public.set_daily_quiz_day_skip(uuid, date, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_quiz_day_skip(uuid, date, boolean, uuid) TO authenticated, service_role;

-- ── 改成自訂題目（p_questions 為 NULL＝改回 AI 題目）──
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
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'quiz_date_passed'; END IF;
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

-- ── 換一版：刪掉還沒發佈的 A 版，請 AI 重新出題 ──
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
BEGIN
  IF p_quiz_date < (NOW() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'quiz_date_passed'; END IF;
  IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans plan
                 WHERE plan.id = p_global_plan_id AND p_quiz_date BETWEEN plan.start_date AND plan.end_date) THEN
    RAISE EXCEPTION 'quiz_plan_date_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_quizzes q WHERE q.global_plan_id = p_global_plan_id
             AND q.quiz_date = p_quiz_date AND q.variant = 'A' AND q.generation_status = 'generating') THEN
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

  RETURN jsonb_build_object('queued', TRUE, 'requestId', request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.swap_daily_quiz_version(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_daily_quiz_version(uuid, date, uuid) TO authenticated, service_role;

-- ── 自動發佈：有自訂題目的日子發自訂題目 ──
CREATE OR REPLACE FUNCTION public.run_daily_quiz_auto_publish(p_now timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  today DATE := (p_now AT TIME ZONE 'Asia/Taipei')::date;
  close_at TIMESTAMPTZ := ((((p_now AT TIME ZONE 'Asia/Taipei')::date) + TIME '23:59:59') AT TIME ZONE 'Asia/Taipei');
  rule RECORD;
  group_total INTEGER;
  published_groups INTEGER;
  custom_questions JSONB;
  publish_result JSONB;
  results JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_feature_enabled('daily_quiz') THEN
    RETURN jsonb_build_object('status', 'feature_disabled');
  END IF;
  SELECT COUNT(*) INTO group_total FROM public.small_groups;

  FOR rule IN
    SELECT r.global_plan_id, r.enabled_by
    FROM public.quiz_auto_publish_rules r
    JOIN public.global_plans gp ON gp.id = r.global_plan_id
    WHERE r.enabled AND gp.start_date <= today AND gp.end_date >= today
  LOOP
    IF EXISTS (SELECT 1 FROM public.quiz_daily_overrides o
               WHERE o.global_plan_id = rule.global_plan_id AND o.quiz_date = today AND o.skip) THEN
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'skipped');
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO published_groups FROM public.quiz_publications
    WHERE global_plan_id = rule.global_plan_id AND quiz_date = today AND scope_type = 'group';
    IF published_groups >= group_total THEN
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'already_published');
      CONTINUE;
    END IF;

    SELECT q.questions INTO custom_questions
    FROM public.quiz_daily_overrides o JOIN public.daily_quizzes q ON q.id = o.custom_quiz_id
    WHERE o.global_plan_id = rule.global_plan_id AND o.quiz_date = today;

    IF custom_questions IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.daily_quizzes q
      WHERE q.global_plan_id = rule.global_plan_id AND q.quiz_date = today AND q.variant = 'A'
        AND q.generation_status = 'ready' AND q.review_status = 'approved') THEN
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'no_quiz');
      CONTINUE;
    END IF;

    BEGIN
      publish_result := public.publish_daily_quiz(
        p_global_plan_id := rule.global_plan_id,
        p_quiz_date := today,
        p_scope_type := 'all',
        p_scope_name := NULL,
        p_variant := CASE WHEN custom_questions IS NULL THEN 'A' END,
        p_custom_questions := custom_questions,
        p_actor_id := rule.enabled_by,
        p_answer_close_at := close_at);
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'published',
        'source', CASE WHEN custom_questions IS NULL THEN 'ai' ELSE 'custom' END,
        'publishedCount', publish_result->'publishedCount');
    EXCEPTION WHEN OTHERS THEN
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'failed', 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('quizDate', today, 'plans', results);
END;
$$;
REVOKE ALL ON FUNCTION public.run_daily_quiz_auto_publish(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_quiz_auto_publish(timestamptz) TO service_role;

-- 保險：小測驗函式都不能讓 anon 執行（0214 的規則）
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE '%daily_quiz%' OR p.proname LIKE '%church_quiz%')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can execute: %', bad; END IF;
END $$;
