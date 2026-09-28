-- ============================================================================
-- 20260928064718_daily_quiz_auto_publish.sql  —  #306（小測驗 Q1，屬於 #305）
--
-- 小測驗每天自動發佈、AI 提前一天出題：
--   1. quiz_auto_publish_rules：每個計畫一條規則（開／關）。開著的計畫，每天 00:00
--      自動發給全部小組、23:59:59（台北）截止，用 AI 出的那一版（A）。
--      發佈者記成開啟規則的那位系統管理員（quiz_publications.published_by 不能是空的）。
--   2. quiz_daily_overrides：某一天「這天不發」／改用自訂題目。#306 先支援「這天不發」，
--      編輯畫面在 #307。
--   3. run_daily_quiz_auto_publish()：由既有的 run_daily_quiz_schedule_sweep（pg_cron 每
--      5 分鐘，經 daily-quiz-schedule-sweep Edge Function 用 service role 呼叫）順便執行。
--      冪等：已經發給全部小組就跳過；題目還沒出好就等下一輪。
--   4. 發佈權限收回：publish_daily_quiz／schedule_daily_quiz_publish 只有系統管理員可用，
--      拿掉 scope_type='admin'（僅系統管理員測試用）。舊的 7 個參數版本 publish_daily_quiz
--      直接刪掉（前端都用具名參數呼叫 8 個參數的版本）。
--   5. AI 出題改成前一天 12:00 產生隔天、只出一版（A）；20:00 對還沒出好的再試一次。
--      缺題只在後台標紅（#307），不另外發通知（2026-09-28 決定）。
--      pg_cron 只在正式環境調整（staging 刻意沒有排程，見 docs/staging.md）。
-- ============================================================================

-- ── 1. 規則與每日覆寫（只透過下面的 RPC 存取）──
CREATE TABLE IF NOT EXISTS public.quiz_auto_publish_rules (
  global_plan_id UUID PRIMARY KEY REFERENCES public.global_plans(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.quiz_auto_publish_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiz_auto_publish_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.quiz_auto_publish_rules TO service_role;

CREATE TABLE IF NOT EXISTS public.quiz_daily_overrides (
  global_plan_id UUID NOT NULL REFERENCES public.global_plans(id) ON DELETE CASCADE,
  quiz_date DATE NOT NULL,
  skip BOOLEAN NOT NULL DEFAULT FALSE,
  custom_quiz_id UUID REFERENCES public.daily_quizzes(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (global_plan_id, quiz_date)
);
ALTER TABLE public.quiz_daily_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiz_daily_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.quiz_daily_overrides TO service_role;

-- ── 2. 規則的讀取／設定（只有系統管理員）──
CREATE OR REPLACE FUNCTION public.get_daily_quiz_auto_publish_rule(p_global_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  rule public.quiz_auto_publish_rules%ROWTYPE;
BEGIN
  IF (SELECT public.role_code(role_id) FROM public.profiles WHERE id = actor_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'quiz_publish_admin_only';
  END IF;
  SELECT * INTO rule FROM public.quiz_auto_publish_rules WHERE global_plan_id = p_global_plan_id;
  RETURN jsonb_build_object(
    'enabled', COALESCE(rule.enabled, FALSE),
    'updatedAt', rule.updated_at,
    'enabledByName', (SELECT p.name FROM public.profiles p WHERE p.id = rule.enabled_by)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_auto_publish_rule(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_auto_publish_rule(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_daily_quiz_auto_publish_rule(p_global_plan_id uuid, p_enabled boolean, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF (SELECT public.role_code(role_id) FROM public.profiles WHERE id = actor_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'quiz_publish_admin_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.global_plans WHERE id = p_global_plan_id) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;
  INSERT INTO public.quiz_auto_publish_rules(global_plan_id, enabled, enabled_by, updated_at)
  VALUES (p_global_plan_id, COALESCE(p_enabled, FALSE), actor_id, NOW())
  ON CONFLICT (global_plan_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, enabled_by = EXCLUDED.enabled_by, updated_at = NOW();
  RETURN public.get_daily_quiz_auto_publish_rule(p_global_plan_id, p_actor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_daily_quiz_auto_publish_rule(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_quiz_auto_publish_rule(uuid, boolean, uuid) TO authenticated, service_role;

-- ── 4. 發佈權限收回（只改權限那一段，函式本體取自目前的定義）──
DROP FUNCTION IF EXISTS public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.publish_daily_quiz(p_global_plan_id uuid, p_quiz_date date, p_scope_type text, p_scope_name text DEFAULT NULL::text, p_variant text DEFAULT NULL::text, p_custom_questions jsonb DEFAULT NULL::jsonb, p_actor_id uuid DEFAULT NULL::uuid, p_answer_close_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- #306：只有系統管理員可以發佈（小組長、牧區長只看統計）；「僅系統管理員（測試用）」範圍拿掉
  IF actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'quiz_publish_admin_only';
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
$function$;
REVOKE ALL ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.schedule_daily_quiz_publish(p_global_plan_id uuid, p_quiz_date date, p_scope_type text, p_scope_name text DEFAULT NULL::text, p_variant text DEFAULT NULL::text, p_custom_questions jsonb DEFAULT NULL::jsonb, p_publish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_answer_close_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- #306：只有系統管理員可以發佈（小組長、牧區長只看統計）；「僅系統管理員（測試用）」範圍拿掉
  IF actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'quiz_publish_admin_only';
  END IF;
  IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN
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
$function$;
REVOKE ALL ON FUNCTION public.schedule_daily_quiz_publish(uuid, date, text, text, text, jsonb, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_daily_quiz_publish(uuid, date, text, text, text, jsonb, timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ── 3. 每天 00:00 自動發佈（由排程掃描呼叫；只給 service_role）──
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

    IF NOT EXISTS (SELECT 1 FROM public.daily_quizzes q
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
        p_variant := 'A',
        p_custom_questions := NULL,
        p_actor_id := rule.enabled_by,
        p_answer_close_at := close_at);
      results := results || jsonb_build_object('planId', rule.global_plan_id, 'status', 'published',
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

-- 排程掃描順便跑自動發佈（本體取自目前的定義）
CREATE OR REPLACE FUNCTION public.run_daily_quiz_schedule_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  schedule_row public.quiz_publication_schedules%ROWTYPE;
  publish_result JSONB;
  processed_count INTEGER := 0;
  published_count INTEGER := 0;
  failed_count INTEGER := 0;
  auto_result JSONB;
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

  -- #306：每天 00:00 自動發佈。排程每 5 分鐘跑一次，00:00 那一輪就會發；
  -- 冪等，當天之後的每一輪只補沒發到的小組（例如題目晚一點才出好）。
  BEGIN
    auto_result := public.run_daily_quiz_auto_publish();
  EXCEPTION WHEN OTHERS THEN
    auto_result := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'autoPublish', auto_result,
    'processed', processed_count,
    'published', published_count,
    'failed', failed_count
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.run_daily_quiz_schedule_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_quiz_schedule_sweep() TO service_role;

-- ── 5. AI 提前一天出題：12:00 產生隔天、只出 A 版；20:00 對失敗的再試一次 ──
DROP FUNCTION IF EXISTS public.invoke_daily_church_quiz_generation();
CREATE OR REPLACE FUNCTION public.invoke_daily_church_quiz_generation(p_retry boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
  target_date DATE := ((now() AT TIME ZONE 'Asia/Taipei')::date + 1);
BEGIN
  IF NOT public.is_feature_enabled('daily_quiz') THEN
    RAISE LOG 'Daily quiz feature is disabled; skipping scheduled generation';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'quiz_generation_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'quiz_generation_cron_secret not found in Vault; skipping daily quiz generation';
    RETURN;
  END IF;

  target_url := public.edge_function_url('generate-daily-quizzes');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping daily quiz generation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object(
      'source', CASE WHEN p_retry THEN 'pg_cron_retry' ELSE 'pg_cron' END,
      'quizDate', to_char(target_date, 'YYYY-MM-DD'),
      'variants', jsonb_build_array('A'),
      -- 20:00：只重做失敗的（reserve_daily_quiz_regeneration 不會動已經出好的題目）
      'retryExisting', p_retry
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_daily_church_quiz_generation(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_daily_church_quiz_generation(boolean) TO service_role;

-- pg_cron：只在已經有出題排程的環境（正式環境）調整；staging 刻意沒有排程。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-daily-church-quizzes') THEN
    PERFORM cron.unschedule('generate-daily-church-quizzes');
    PERFORM cron.schedule('generate-daily-church-quizzes', '0 4 * * *',
      'SELECT public.invoke_daily_church_quiz_generation();');                 -- 台北 12:00
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retry-daily-church-quizzes') THEN
      PERFORM cron.unschedule('retry-daily-church-quizzes');
    END IF;
    PERFORM cron.schedule('retry-daily-church-quizzes', '0 12 * * *',
      'SELECT public.invoke_daily_church_quiz_generation(p_retry := true);');  -- 台北 20:00
  END IF;
END $$;

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
