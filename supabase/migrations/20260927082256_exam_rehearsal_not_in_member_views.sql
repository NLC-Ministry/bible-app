-- ============================================================================
-- 20260927082256_exam_rehearsal_not_in_member_views.sql  —  #258 後續修正
--
-- 問題：管理員在草稿卷上演練作答後，只要這份卷的公告已發佈，首頁卡片和「我的
-- 測驗」就會顯示「已完成作答／正式答案已鎖定」，看起來像演練變成了正式紀錄。
-- 原因：_exam_member_paper_summary、exam_my_papers 找「我在這份卷的作答」時沒有
-- 排除演練作答（is_test）。
--
-- 修正：
--   1. 這兩個函式排除 is_test：演練作答不會出現在會友端的個人紀錄。演練只在
--      作答頁（exam_get_for_attempt）和後台看得到。
--   2. 新增 exam_reset_my_rehearsal：管理員只清掉「自己」在草稿卷上的演練作答，
--      可以馬上重新演練（exam_reset_attempts 會清掉所有人的演練）。
-- 發佈時清除演練作答（exam_publish）的規則不變。
-- ============================================================================

-- ── 1. 會友端的個人紀錄排除演練作答 ──
CREATE OR REPLACE FUNCTION "public"."_exam_member_paper_summary"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_is_staff" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE pr public.exam_papers%ROWTYPE;official_at public.exam_attempts%ROWTYPE;practice_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ:=NOW();practice_end TIMESTAMPTZ;in_window BOOLEAN:=FALSE;
  can_enter BOOLEAN:=FALSE;can_practice BOOLEAN:=FALSE;result_ready BOOLEAN:=FALSE;
  show_pre BOOLEAN;disp_headline TEXT;disp_body TEXT;
BEGIN
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  practice_end:=public._exam_practice_close_at(pr.id);
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='official' AND NOT is_test;
  SELECT * INTO practice_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='practice' AND NOT is_test;
  in_window:=pr.open_at IS NOT NULL AND pr.close_at IS NOT NULL AND now_ts>=pr.open_at AND now_ts<pr.close_at;
  can_enter:=official_at.id IS NULL AND pr.status='published' AND in_window;
  can_practice:=pr.practice_retake_enabled AND pr.status IN('published','closed') AND now_ts<practice_end
    AND official_at.id IS NOT NULL AND official_at.status<>'in_progress';
  result_ready:=official_at.status='graded' AND(pr.results_published_at IS NOT NULL OR p_is_staff);
  -- 公告已發佈 → 一律顯示公告（等於預告自動被蓋掉，不用另外撤下）；
  -- 公告還沒發佈 → 預告開著且標題/內容都填了才顯示預告。
  show_pre:=(NOT pr.announcement_published) AND pr.pre_announcement_enabled
    AND COALESCE(btrim(pr.pre_announcement->>'headline'),'')<>'' AND COALESCE(btrim(pr.pre_announcement->>'body'),'')<>'';
  disp_headline:=CASE WHEN show_pre THEN pr.pre_announcement->>'headline' ELSE pr.announcement->>'headline' END;
  disp_body:=CASE WHEN show_pre THEN pr.pre_announcement->>'body' ELSE pr.announcement->>'body' END;
  RETURN jsonb_build_object('paperId',pr.id,'title',pr.title,'status',pr.status,
    'headline',COALESCE(disp_headline,''),'body',COALESCE(disp_body,''),
    'isPreAnnouncement',show_pre,
    'ctaLabel',COALESCE(NULLIF(pr.announcement->>'ctaLabel',''),'進入測驗'),'openAt',pr.open_at,
    'closeAt',pr.close_at,'practiceCloseAt',practice_end,'durationMinutes',pr.duration_minutes,
    'serverNow',now_ts,'inWindow',in_window,'canEnter',can_enter,'myAttemptStatus',official_at.status,
    'officialAttemptId',official_at.id,'canReviewOfficial',official_at.id IS NOT NULL AND official_at.status<>'in_progress',
    'canPractice',can_practice,'practiceAttemptId',practice_at.id,'practiceAttemptStatus',practice_at.status,
    'practiceReviewReady',practice_at.id IS NOT NULL,'resultReady',result_ready,
    'resultsPublishedAt',pr.results_published_at,
    'myTotalScore',CASE WHEN result_ready THEN official_at.total_score ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION "public"."_exam_member_paper_summary"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_is_staff" boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."_exam_member_paper_summary"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_is_staff" boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION "public"."exam_my_papers"("p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
    WHERE (oa.id IS NOT NULL OR pr.announcement_published = TRUE)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_my_papers"("p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_my_papers"("p_actor_id" "uuid") TO authenticated, service_role;

-- ── 2. 只清自己的演練作答 ──
CREATE OR REPLACE FUNCTION public.exam_reset_my_rehearsal(p_paper_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  pr        public.exam_papers%ROWTYPE;
  n_deleted INTEGER;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status <> 'draft' THEN RAISE EXCEPTION 'exam_rehearsal_draft_only'; END IF;

  DELETE FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND is_test;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  RETURN jsonb_build_object('paperId', pr.id, 'deletedAttempts', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) TO authenticated, service_role;
