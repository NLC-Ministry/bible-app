-- ============================================================================
-- 20260929043341_daily_quiz_drop_legacy_publish.sql  —  #308（小測驗 Q3，屬於 #305）
--
-- 小測驗改成每天 00:00 自動發佈（#306）、後台 7 天日曆（#307）之後，清掉用不到的
-- 舊東西。畫面不會有變化。
--
--   1. 刪函式：
--      * schedule_daily_quiz_publish／cancel_daily_quiz_schedule：舊的「排程發佈」
--        （正式環境 0 筆排程）。
--      * request_daily_quiz_regeneration：舊的 A／B 版「重新生成某一版」；換題改走
--        swap_daily_quiz_version（#307）。
--      * update_daily_quiz_questions：舊的「審核時逐題修改 AI 題目」；要改題目就改成
--        自訂題目（set_daily_quiz_day_custom）。
--      前端從 #307 起都不再呼叫，nlc-data allowlist 同步移除。
--   2. run_daily_quiz_schedule_sweep 只剩自動發佈（pg_cron 每 5 分鐘經
--      daily-quiz-schedule-sweep Edge Function 呼叫，名字不變，Edge Function 不用改）。
--   3. get_daily_quiz_dashboard 只回會友自己的 myQuiz：審核用的 reviewQuizzes／
--      approvedVariants、發佈用的 managedGroups、pendingSchedule 都拿掉。會友端
--      （plan.js）只讀 myQuiz；統計看 daily_quiz_get_stats。順帶省掉小組長／牧者每次
--      打開計畫頁都要跑一次的全小組名單查詢。「僅系統管理員（測試用）」
--      （scope_type='admin'）的發佈也不再顯示（正式環境 0 次）。
--   4. publish_daily_quiz：只給 service_role（小組長、牧區長、系統管理員都不能從前端
--      發佈了，只剩自動發佈這條路）；拿掉 scope_type='admin' 分支與 B 版。
--   5. 刪 quiz_publication_schedules 表。
--
-- 舊前端相容性：舊版只有管理員後台會呼叫被刪的函式或讀被拿掉的欄位，重新整理就好；
-- 會友端只用 myQuiz，形狀不變。不需要設 forceUpdateBuiltBefore。
-- daily_quizzes 的 variant 欄位與歷史 B 版資料保留（已發佈過的紀錄要留著）。
-- ============================================================================

-- ── 1. 刪函式（依名稱刪掉所有多載，不怕漏掉舊簽名）──
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('schedule_daily_quiz_publish', 'cancel_daily_quiz_schedule',
                        'request_daily_quiz_regeneration', 'update_daily_quiz_questions')
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn);
  END LOOP;
END $$;

-- ── 2. 排程掃描只剩自動發佈 ──
CREATE OR REPLACE FUNCTION public.run_daily_quiz_schedule_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  auto_result JSONB;
BEGIN
  -- #306：每天 00:00 自動發佈。排程每 5 分鐘跑一次，00:00 那一輪就會發；
  -- 冪等，當天之後的每一輪只補沒發到的小組（例如題目晚一點才出好）。
  BEGIN
    auto_result := public.run_daily_quiz_auto_publish();
  EXCEPTION WHEN OTHERS THEN
    auto_result := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object('autoPublish', auto_result);
END;
$function$;
REVOKE ALL ON FUNCTION public.run_daily_quiz_schedule_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_quiz_schedule_sweep() TO service_role;

-- ── 3. 會友端的今日小測驗 ──
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

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'role', actor_role,
    'myQuiz', my_quiz
  );
END;
$get_daily_quiz_dashboard$;
REVOKE ALL ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_daily_quiz_dashboard(UUID, DATE, UUID) IS
  'Returns the caller''s own daily quiz for the date (myQuiz): the group publication they belong to, member-safe questions, and their attempt. Admin data (review, publish, pending schedule) was removed in #308; statistics come from daily_quiz_get_stats.';

-- ── 4. 發佈只剩自動發佈（service_role）──
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
BEGIN
  actor_id := public.resolve_quiz_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  -- 發佈者記成開啟自動發佈規則的系統管理員（run_daily_quiz_auto_publish 帶進來）
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
      AND quiz.variant = 'A'
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
    IF COALESCE(p_variant, '') <> 'A' THEN
      RAISE EXCEPTION 'quiz_not_ready';
    END IF;
    SELECT id INTO selected_quiz_id
    FROM public.daily_quizzes
    WHERE global_plan_id = p_global_plan_id
      AND quiz_date = p_quiz_date
      AND variant = 'A'
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
    global_plan_id, quiz_date, quiz_id, small_group_id, scope_type, published_by, publisher_role, answer_close_at
  )
  SELECT p_global_plan_id, p_quiz_date, selected_quiz_id, target_group_id, 'group', actor_id, actor_role, p_answer_close_at
  FROM UNNEST(target_group_ids) AS target(target_group_id)
  ON CONFLICT (global_plan_id, quiz_date, small_group_id) DO NOTHING;

  GET DIAGNOSTICS published_count = ROW_COUNT;
  skipped_count := target_count - published_count;

  RETURN jsonb_build_object(
    'publishedCount', published_count,
    'skippedCount', skipped_count,
    'targetCount', target_count,
    'quizId', selected_quiz_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) TO service_role;

-- ── 5. 刪舊的排程表 ──
-- 不加 CASCADE：萬一還有東西依賴這張表，寧可 migration 失敗也不要默默連帶刪掉。
DROP TABLE IF EXISTS public.quiz_publication_schedules;

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

NOTIFY pgrst, 'reload schema';
