-- ============================================================================
-- 20260928175636_daily_quiz_publish_no_notification.sql
--
-- 小測驗發佈不再發通知（2026-09-29 決定）。
--
-- 現在每天 00:00 自動發佈（20260928064718），每發一次就在每個會友的鈴鐺塞一則
-- 「每日小測驗已發布」，天天都有、等於噪音。這支只把 publish_daily_quiz 裡兩段
-- INSERT INTO public.quiz_notifications 拿掉，其餘本體原封不動取自
-- 20260928064718_daily_quiz_auto_publish.sql 的定義（簽章、權限都不變）。
--
-- 不動的東西：
--   * quiz_notifications 表、get_quiz_notifications／mark_quiz_notifications_read
--     都保留，舊通知照樣看得到。
--   * 手動發佈、排程發佈（run_daily_quiz_schedule_sweep）、每日自動發佈
--     （run_daily_quiz_auto_publish）都走 publish_daily_quiz，改這一支三條路一起生效。
--
-- 另外：已經發出去、還沒讀的舊小測驗通知一次標成已讀（檔尾，2026-09-29 使用者同意），
-- 鈴鐺上的數字不會再被舊的小測驗通知撐著。只改 status/read_at，不刪資料。
-- 不用重部署任何 Edge Function。
-- ============================================================================

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

    -- 不發通知（見檔頭）。

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

    -- 不發通知（見檔頭）。
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

-- 舊的未讀小測驗通知一次標成已讀（跟 mark_quiz_notifications_read 同樣的欄位寫法）。
UPDATE public.quiz_notifications
SET status = 'read', read_at = NOW()
WHERE status = 'unread';

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
