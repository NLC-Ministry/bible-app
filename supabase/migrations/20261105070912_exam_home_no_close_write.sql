-- ============================================================================
-- #675 首頁測驗卡片不再執行關卷寫入
--
-- exam_home_exams、exam_home_banner 是開首頁就會打的讀取，以前開頭都會 PERFORM _exam_close_expired_papers()：
-- 每個人開首頁都跑一次刪試作、逐卷關卷、逐作答計分。這支把這個呼叫拿掉，兩支 RPC 變成純讀取。
--
-- 【關卷的觸發點還有哪些】
--   1. pg_cron 排程 exam-auto-close（0122，每分鐘）。staging 刻意不建排程（docs/staging.md），正式站要確認：
--        SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'exam-auto-close';
--      **套用到正式站之前先查，應該有一筆 active=true**；沒有的話先補排程再套這支。
--   2. 其餘 RPC 開頭照舊呼叫：exam_get_for_attempt、exam_get_my_result、exam_my_papers、exam_get_paper_admin、
--      exam_get_stats、exam_start_attempt、exam_start_practice、exam_save_progress、exam_submit_attempt、
--      exam_mark_practice_complete、exam_publish_results、exam_finalize_expired。
--      所以就算排程失效，管理員打開試卷、會友點進測驗或查成績時一樣會關卷，不會永遠不關卷或看不到成績。
--
-- 【到時間立刻看到已截止】排程最多晚一分鐘，這段期間卡片要跟關卷後一樣，所以
-- _exam_member_paper_summary 用 close_at 推算：status／stage 當成已關閉；作答中的正式作答當成 submitted
-- （可以查看作答、可以開題目回顧）；到期的重作練習當成 submitted。按下去進的 RPC 都會先關卷。
-- 已知差異（最多一分鐘）：沒有簡答的卷，關卷後狀態會是 graded，推算時先顯示 submitted。
-- 只影響管理員自己的卡片（會友要等成績公布才看得到結果，而公布前一定已經關卷）。
--
-- 沒有改簽章、沒有新增 RPC，nlc-data 白名單不用動；舊版前端不受影響，不需要 forceUpdateBuiltBefore。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._exam_member_paper_summary(p_paper_id uuid, p_actor_id uuid, p_is_staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE pr public.exam_papers%ROWTYPE;official_at public.exam_attempts%ROWTYPE;practice_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ:=NOW();practice_end TIMESTAMPTZ;in_window BOOLEAN:=FALSE;
  can_enter BOOLEAN:=FALSE;can_practice BOOLEAN:=FALSE;result_ready BOOLEAN:=FALSE;
  disp_headline TEXT;disp_body TEXT;
  v_past_close BOOLEAN;v_status TEXT;v_official_status TEXT;v_practice_status TEXT;
BEGIN
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  practice_end:=public._exam_practice_close_at(pr.id);
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='official' AND NOT is_test;
  SELECT * INTO practice_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='practice' AND NOT is_test;
  -- 過了截止時間、排程還沒跑到（#675）：回傳內容跟關卷後一樣。條件跟 _exam_close_expired_papers 相同。
  v_past_close:=COALESCE(pr.status='published' AND pr.close_at<=now_ts,FALSE);
  v_status:=CASE WHEN v_past_close THEN 'closed' ELSE pr.status END;
  v_official_status:=CASE WHEN v_past_close AND official_at.status='in_progress' THEN 'submitted' ELSE official_at.status END;
  v_practice_status:=CASE WHEN practice_at.status='in_progress' AND now_ts>=practice_end THEN 'submitted' ELSE practice_at.status END;
  in_window:=pr.open_at IS NOT NULL AND pr.close_at IS NOT NULL AND now_ts>=pr.open_at AND now_ts<pr.close_at;
  can_enter:=official_at.id IS NULL AND pr.status='published' AND in_window;
  can_practice:=pr.practice_retake_enabled AND v_status IN('published','closed') AND now_ts<practice_end
    AND official_at.id IS NOT NULL AND v_official_status<>'in_progress';
  result_ready:=official_at.status='graded' AND(pr.results_published_at IS NOT NULL OR p_is_staff);
  -- 首頁卡片文字：有填用填的，沒填用試卷標題／開放時間自動產生（預告已退場，不再讀）
  disp_headline:=COALESCE(NULLIF(btrim(pr.announcement->>'headline'),''),pr.title);
  disp_body:=COALESCE(NULLIF(btrim(pr.announcement->>'body'),''),
    public._exam_default_card_body(pr.open_at,pr.close_at,pr.duration_minutes));
  RETURN jsonb_build_object('paperId',pr.id,'title',pr.title,'status',v_status,
    'stage',public._exam_paper_stage(v_status,pr.open_at,pr.results_published_at),
    'headline',COALESCE(disp_headline,''),'body',COALESCE(disp_body,''),
    'isPreAnnouncement',FALSE,
    'ctaLabel',COALESCE(NULLIF(pr.announcement->>'ctaLabel',''),'進入測驗'),'openAt',pr.open_at,
    'closeAt',pr.close_at,'practiceCloseAt',practice_end,'durationMinutes',pr.duration_minutes,
    'serverNow',now_ts,'inWindow',in_window,'canEnter',can_enter,'myAttemptStatus',v_official_status,
    'officialAttemptId',official_at.id,'canReviewOfficial',official_at.id IS NOT NULL AND v_official_status<>'in_progress',
    'canPractice',can_practice,'practiceAttemptId',practice_at.id,'practiceAttemptStatus',v_practice_status,
    'practiceReviewReady',practice_at.id IS NOT NULL,'resultReady',result_ready,
    'resultsPublishedAt',pr.results_published_at,
    'myTotalScore',CASE WHEN result_ready THEN official_at.total_score ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public._exam_member_paper_summary(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_member_paper_summary(uuid, uuid, boolean) TO authenticated, service_role;

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
  SELECT pr.id INTO paper_id FROM public.exam_papers pr
  WHERE pr.status IN ('published', 'closed') AND public._exam_home_visible(pr.id, actor_id)
  ORDER BY pr.published_at DESC NULLS LAST,pr.created_at DESC LIMIT 1;
  IF paper_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._exam_member_paper_summary(paper_id,actor_id,is_staff);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_home_banner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_home_banner(uuid) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.exam_home_exams(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_home_exams(uuid) TO authenticated, service_role;
