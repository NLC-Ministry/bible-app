-- ============================================================================
-- 20260928043848_exam_home_card_until_exam_ends.sql  —  #298 上線前修正（#297 第 2 批）
--
-- 問題：20260928031148 讓首頁與「我的測驗」顯示所有 status IN ('published','closed')
-- 的卷，而且永遠留著。正式環境兩份已結束的舊卷（當時沒發佈預告文，現在首頁看不到）
-- 上線後會突然出現在每個人的首頁與「我的測驗」。
--
-- 規則（2026-09-28 決定）：
--   首頁卡片
--     · 還沒結束（已排程、作答中）：所有人都看得到
--     · 結束後：只有有正式作答的人看得到，而且只到結束那天為止——隔天（台北時間
--       00:00）就從首頁拿掉。「結束」＝實際收卷時間（提前結束時是 closed_at）。
--     · 沒作答的人：結束後就看不到
--   我的測驗：自己有正式作答的卷永遠查得到；另外列出還沒結束的卷。
-- 試作（is_test）不算作答（20260927082256 起）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._exam_home_visible(p_paper_id uuid, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN pr.status = 'published' AND NOW() < pr.close_at THEN TRUE                -- 已排程、作答中
    WHEN pr.status NOT IN ('published', 'closed') THEN FALSE                       -- 準備中永遠不顯示
    ELSE EXISTS (
        SELECT 1 FROM public.exam_attempts a
        WHERE a.paper_id = pr.id AND a.user_id = p_actor_id
          AND a.attempt_kind = 'official' AND NOT a.is_test)
      AND NOW() < ((date_trunc('day', COALESCE(pr.closed_at, pr.close_at) AT TIME ZONE 'Asia/Taipei')
                    + INTERVAL '1 day') AT TIME ZONE 'Asia/Taipei')                 -- 結束那天為止
  END
  FROM public.exam_papers pr WHERE pr.id = p_paper_id
$$;
REVOKE ALL ON FUNCTION public._exam_home_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_home_visible(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.exam_home_exams(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam') THEN RETURN '[]'::jsonb; END IF;
  PERFORM public._exam_close_expired_papers();

  RETURN COALESCE((
    SELECT jsonb_agg(public._exam_member_paper_summary(pr.id, actor_id, is_staff)
      ORDER BY
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.status = 'published' AND NOW() < pr.open_at) DESC,
        pr.open_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    WHERE pr.status IN ('published', 'closed') AND public._exam_home_visible(pr.id, actor_id)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_home_exams(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_home_exams(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_home_banner(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);is_staff BOOLEAN:=public._exam_actor_role(actor_id)IN('admin','pastor');
  paper_id UUID;
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam')THEN RETURN NULL; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT pr.id INTO paper_id FROM public.exam_papers pr
  WHERE pr.status IN ('published', 'closed') AND public._exam_home_visible(pr.id, actor_id)
  ORDER BY pr.published_at DESC NULLS LAST,pr.created_at DESC LIMIT 1;
  IF paper_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._exam_member_paper_summary(paper_id,actor_id,is_staff);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_home_banner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_home_banner(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_my_papers(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam') THEN RETURN '[]'::jsonb; END IF;
  PERFORM public._exam_close_expired_papers();

  RETURN COALESCE((
    SELECT jsonb_agg(public._exam_member_paper_summary(pr.id, actor_id, is_staff)
      ORDER BY
        (oa.status = 'in_progress') DESC,
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.results_published_at IS NOT NULL) DESC,
        pr.close_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    LEFT JOIN public.exam_attempts oa
      ON oa.paper_id = pr.id AND oa.user_id = actor_id AND oa.attempt_kind = 'official' AND NOT oa.is_test
    -- 自己作答過的永遠查得到；另外列出還沒結束的卷
    WHERE pr.status IN ('published', 'closed')
      AND (oa.id IS NOT NULL OR (pr.status = 'published' AND NOW() < pr.close_at))
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_my_papers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_my_papers(uuid) TO authenticated, service_role;

-- 保險：大測驗函式都不能讓 anon 執行（0214 的規則）
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%exam%'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can execute: %', bad; END IF;
END $$;
