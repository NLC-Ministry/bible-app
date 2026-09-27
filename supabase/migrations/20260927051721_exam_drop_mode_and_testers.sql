-- ============================================================================
-- 20260927051721_exam_drop_mode_and_testers.sql  —  #260（大測驗 C3）
--
-- C1（#258）改成單一試卷、C2（#259）刪掉正式環境的 3 份舊測試卷之後，
-- exam_papers.mode 只剩 'live'、pushed_from_id 全部是 NULL、exam_paper_testers 是空的。
-- 這裡把它們連同相關函式一起移除：
--   1. 改寫 12 個還在讀 mode／pushed_from_id 的函式（以正式環境 2026-09-27 的定義為基礎，
--      只拿掉 mode 相關的判斷，其餘不動；原本「只看正式卷」的篩選等於不篩，行為不變）。
--   2. 刪除 exam_push_to_live、exam_set_mode、試考名單的 3 個函式、_exam_can_access_test。
--   3. 刪除 exam_paper_testers 資料表、exam_papers.pushed_from_id、exam_papers.mode。
-- exam_attempts.is_test 保留，意思是「草稿上的演練作答」（#257）。
--
-- 舊版前端：RPC 回傳不再有 mode／pushedFromId，舊程式讀到 undefined 只是不顯示「測試版」
-- 標記，一般使用不會壞，不需要 forceUpdateBuiltBefore。
-- 先確認沒有殘留資料，有的話中止（C2 應該已經清乾淨）。
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.exam_papers WHERE mode <> 'live') THEN
    RAISE EXCEPTION 'exam_papers still has non-live papers; run C2 (#259) first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exam_papers WHERE pushed_from_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exam_papers.pushed_from_id still set; run C2 (#259) first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exam_paper_testers) THEN
    RAISE EXCEPTION 'exam_paper_testers is not empty';
  END IF;
END $guard$;

-- ── _exam_member_paper_summary ──
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
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='official';
  SELECT * INTO practice_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='practice';
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

-- ── exam_get_for_attempt ──
CREATE OR REPLACE FUNCTION "public"."exam_get_for_attempt"("p_paper_id" "uuid" DEFAULT NULL::"uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_preview" boolean DEFAULT false, "p_attempt_kind" "text" DEFAULT 'official'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
  pr public.exam_papers%ROWTYPE;
  at public.exam_attempts%ROWTYPE;
  official_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ := NOW();
  practice_end TIMESTAMPTZ;
  open_state TEXT;
  want_preview BOOLEAN;
BEGIN
  PERFORM public._exam_close_expired_papers();
  IF p_attempt_kind NOT IN ('official', 'practice') THEN RAISE EXCEPTION 'exam_attempt_kind_invalid'; END IF;

  IF p_paper_id IS NOT NULL THEN
    SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  ELSE
    SELECT * INTO pr FROM public.exam_papers
    WHERE is_staff OR status IN ('published', 'closed')
    ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'no_paper'); END IF;

  practice_end := public._exam_practice_close_at(pr.id);
  want_preview := COALESCE(p_preview, FALSE) AND is_staff;
  SELECT * INTO official_at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  SELECT * INTO at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = p_attempt_kind;

  IF want_preview THEN
    open_state := 'preview';                         -- 只看題目，不建作答
  ELSIF p_attempt_kind = 'practice' THEN
    IF at.id IS NOT NULL THEN
      open_state := CASE WHEN now_ts < practice_end AND pr.status IN ('published', 'closed') THEN 'open' ELSE 'closed' END;
    ELSIF pr.practice_retake_enabled AND pr.status IN ('published', 'closed') AND now_ts < practice_end
      AND official_at.id IS NOT NULL AND official_at.status <> 'in_progress' THEN
      open_state := 'practice_ready';
    ELSE
      open_state := 'not_open';
    END IF;
  ELSIF at.id IS NOT NULL THEN
    open_state := CASE WHEN at.status = 'in_progress' THEN 'open' ELSE pr.status END;
  ELSIF pr.status = 'draft' THEN
    open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;   -- 管理員演練
  ELSIF pr.status <> 'published' THEN
    open_state := CASE WHEN is_staff THEN 'preview' ELSE 'not_open' END;
  ELSIF now_ts < pr.open_at THEN
    open_state := 'not_open';
  ELSIF now_ts >= pr.close_at THEN
    open_state := 'closed';
  ELSE
    open_state := 'open';
  END IF;

  RETURN jsonb_build_object('state', open_state, 'preview', want_preview, 'attemptKind', p_attempt_kind,
    'paper', jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status,
      'openAt', pr.open_at, 'closeAt', pr.close_at, 'practiceCloseAt', practice_end,
      'durationMinutes', pr.duration_minutes, 'totalPoints', pr.total_points, 'pledge', pr.pledge,
      'practiceRetakeEnabled', pr.practice_retake_enabled),
    'attempt', CASE WHEN at.id IS NULL OR want_preview THEN NULL ELSE jsonb_build_object(
      'id', at.id, 'status', at.status, 'attemptKind', at.attempt_kind, 'countsTowardScore', at.attempt_kind = 'official',
      'isRehearsal', at.is_test,
      'startedAt', at.started_at, 'deadlineAt', at.deadline_at, 'submittedAt', at.submitted_at,
      'secondsRemaining', CASE WHEN at.attempt_kind = 'practice' THEN NULL
                               ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int END,
      'layout', at.layout, 'paperSnapshot', at.paper_snapshot,
      'savedAnswers', COALESCE((SELECT jsonb_object_agg(question_id::text, response) FROM public.exam_answers
        WHERE attempt_id = at.id AND response IS NOT NULL), '{}'::jsonb),
      'autoScore', at.auto_score, 'manualScore', at.manual_score, 'totalScore', at.total_score) END,
    'officialAttemptStatus', official_at.status,
    'previewQuestions', CASE WHEN at.id IS NOT NULL AND NOT want_preview THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', q.id, 'section', q.section, 'position', q.position,
        'points', q.points, 'payload', public._exam_public_payload(q.section, q.payload, q.points))
      ORDER BY q.section, q.position) FROM public.exam_questions q WHERE q.paper_id = pr.id), '[]'::jsonb) END);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_get_for_attempt"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_preview" boolean, "p_attempt_kind" "text") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_get_for_attempt"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_preview" boolean, "p_attempt_kind" "text") TO authenticated, service_role;

-- ── exam_get_paper_admin ──
CREATE OR REPLACE FUNCTION "public"."exam_get_paper_admin"("p_paper_id" "uuid" DEFAULT NULL::"uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);target UUID:=p_paper_id;papers JSONB;result JSONB;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN('admin','pastor') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pr.id,'title',pr.title,'status',pr.status,
    'createdAt',pr.created_at,
    'questionCount',(SELECT COUNT(*) FROM public.exam_questions q WHERE q.paper_id=pr.id),
    'attemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id),
    'officialAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='official'),
    'practiceAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='practice'))
    ORDER BY pr.created_at DESC),'[]'::jsonb) INTO papers FROM public.exam_papers pr;
  IF target IS NULL THEN SELECT id INTO target FROM public.exam_papers ORDER BY created_at DESC LIMIT 1; END IF;
  IF target IS NULL THEN RETURN jsonb_build_object('papers',papers,'paper',NULL,'questions','[]'::jsonb,'attemptCount',0); END IF;
  SELECT jsonb_build_object('papers',papers,'paper',to_jsonb(pr),
    'attemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id),
    'officialAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='official'),
    'practiceAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='practice'),
    'questions',COALESCE((SELECT jsonb_agg(to_jsonb(q)ORDER BY q.section,q.position)
      FROM public.exam_questions q WHERE q.paper_id=pr.id),'[]'::jsonb)) INTO result
  FROM public.exam_papers pr WHERE pr.id=target;
  RETURN COALESCE(result,jsonb_build_object('papers',papers,'paper',NULL,'questions','[]'::jsonb,'attemptCount',0));
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_get_paper_admin"("p_paper_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_get_paper_admin"("p_paper_id" "uuid", "p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_get_stats ──
CREATE OR REPLACE FUNCTION "public"."exam_get_stats"("p_paper_id" "uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_require_first_round" boolean DEFAULT false, "p_reading_book" "text" DEFAULT NULL::"text", "p_book_chapters" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  actor_id UUID:=public.resolve_quiz_actor(p_actor_id);actor public.profiles%ROWTYPE;role_c TEXT;
  pr public.exam_papers%ROWTYPE;mreg TEXT[];mzon TEXT[];mgrp TEXT[];scoped UUID[];scoped_stats UUID[];scope_label TEXT;
  scope_all BOOLEAN;v_book TEXT;v_filter BOOLEAN;
  pr_visible BOOLEAN;results_pub BOOLEAN;church_scores NUMERIC[];region_avgs NUMERIC[];zone_avgs NUMERIC[];
  group_avgs NUMERIC[];team3_avgs NUMERIC[];team6_avgs NUMERIC[];
  eligible_count INTEGER;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO actor FROM public.profiles WHERE id=actor_id;
  role_c:=COALESCE(public.role_code(actor.role_id),'member');
  IF role_c NOT IN('admin','pastor','great_zone_leader','zone_leader','group_leader') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  mreg:=ARRAY(SELECT NULLIF(BTRIM(x),'')FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_regions,''),actor.great_region,''),','))x WHERE NULLIF(BTRIM(x),'')IS NOT NULL);
  mzon:=ARRAY(SELECT NULLIF(BTRIM(x),'')FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_zones,''),actor.pastoral_zone,''),','))x WHERE NULLIF(BTRIM(x),'')IS NOT NULL);
  mgrp:=ARRAY(SELECT NULLIF(BTRIM(x),'')FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_groups,''),actor.small_group,''),','))x WHERE NULLIF(BTRIM(x),'')IS NOT NULL);
  scope_label:=CASE WHEN role_c IN('admin','pastor')THEN'all' ELSE'scoped' END;
  scope_all:=(role_c IN('admin','pastor'));
  v_book:=NULLIF(BTRIM(COALESCE(p_reading_book,'')),'');
  v_filter:=COALESCE(p_require_first_round,FALSE) AND v_book IS NOT NULL;

  SELECT COALESCE(array_agg(a.id),'{}')INTO scoped
  FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
  WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND(
    role_c IN('admin','pastor')OR(role_c='great_zone_leader' AND p.great_region=ANY(mreg))
    OR(role_c='zone_leader' AND p.pastoral_zone=ANY(mzon))
    OR(role_c='group_leader' AND p.small_group=ANY(mgrp)));

  -- 只統計已讀完該書卷一遍的人（toggle 開啟時）
  IF v_filter THEN
    SELECT COALESCE(array_agg(a.id),'{}')INTO scoped_stats
    FROM public.exam_attempts a
    WHERE a.id=ANY(scoped) AND public._user_read_book_once(a.user_id,v_book,p_book_chapters);
  ELSE
    scoped_stats:=scoped;
  END IF;

  -- 參與率的應考母體：範圍內 is_active 會友；有綁定計畫的卷只算有登記那個
  -- 計畫讀經進度的人（跟團隊排行「這個計畫底下」同一套邏輯），獨立測驗卷
  -- （沒綁定）母體就是範圍內全部 is_active 會友。
  SELECT COUNT(*)INTO eligible_count
  FROM public.profiles p
  WHERE p.is_active=TRUE AND(
    role_c IN('admin','pastor')OR(role_c='great_zone_leader' AND p.great_region=ANY(mreg))
    OR(role_c='zone_leader' AND p.pastoral_zone=ANY(mzon))
    OR(role_c='group_leader' AND p.small_group=ANY(mgrp)))
    AND(pr.linked_plan_id IS NULL OR EXISTS(
      SELECT 1 FROM public.reading_plans rp WHERE rp.user_id=p.id AND rp.global_plan_id=pr.linked_plan_id));

  results_pub:=pr.results_published_at IS NOT NULL;
  pr_visible:=results_pub OR scope_all;
  IF pr_visible THEN
    church_scores:=ARRAY(SELECT a.total_score FROM public.exam_attempts a
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='graded' AND a.total_score IS NOT NULL
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters)));
    region_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
      GROUP BY COALESCE(NULLIF(p.great_region,''),'（未分區）'));
    zone_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
      GROUP BY COALESCE(NULLIF(p.great_region,''),'（未分區）'),COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）'));
    group_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
      GROUP BY COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）'),COALESCE(NULLIF(p.small_group,''),'（未分組）'));
    team3_avgs:=public._exam_team_avg_pop(pr.id,3);
    team6_avgs:=public._exam_team_avg_pop(pr.id,6);
  END IF;

  RETURN jsonb_build_object(
    'paper',jsonb_build_object('id',pr.id,'title',pr.title,'status',pr.status,'totalPoints',pr.total_points,'linkedPlanId',pr.linked_plan_id),
    'scope',scope_label,'prVisible',pr_visible,'resultsPublished',results_pub,
    'readingBook',v_book,'requireFirstRound',v_filter,
    'overall',(SELECT jsonb_build_object('attempts',COUNT(*),
      'submitted',COUNT(*)FILTER(WHERE a.status IN('submitted','graded')),
      'graded',COUNT(*)FILTER(WHERE a.status='graded'),'inProgress',COUNT(*)FILTER(WHERE a.status='in_progress'),
      'avgAuto',ROUND(AVG(a.auto_score)FILTER(WHERE a.status IN('submitted','graded'))::numeric,1),
      'avgManual',ROUND(AVG(a.manual_score)FILTER(WHERE a.status='graded')::numeric,1),
      'avgTotal',ROUND(AVG(a.total_score)FILTER(WHERE a.status='graded')::numeric,1),
      'maxTotal',MAX(a.total_score)FILTER(WHERE a.status='graded'),'minTotal',MIN(a.total_score)FILTER(WHERE a.status='graded'),
      'eligibleCount',eligible_count,
      'participationRate',CASE WHEN eligible_count>0
        THEN ROUND(COUNT(*)FILTER(WHERE a.status IN('submitted','graded'))::numeric/eligible_count,3) ELSE NULL END,
      'notReadCount',(SELECT COUNT(*)FROM public.exam_attempts a2 WHERE a2.id=ANY(scoped)AND a2.status IN('submitted','graded')
        AND v_book IS NOT NULL AND NOT public._user_read_book_once(a2.user_id,v_book,p_book_chapters)))
      FROM public.exam_attempts a WHERE a.id=ANY(scoped_stats)),
    'byRegion',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',x.name,'count',x.count,'graded',x.graded,
      'avgTotal',x."avgTotal",'pr',CASE WHEN pr_visible THEN public._exam_pr(x."avgTotal",region_avgs)ELSE NULL END)
      ORDER BY x.sort_order NULLS LAST,x.name)FROM(
      SELECT COALESCE(NULLIF(p.great_region,''),'（未分區）')name,gr.sort_order,COUNT(*)count,
        COUNT(*)FILTER(WHERE a.status='graded')graded,ROUND(AVG(a.total_score)FILTER(WHERE a.status='graded')::numeric,1)"avgTotal"
      FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      LEFT JOIN public.great_regions gr ON gr.name=p.great_region
      WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')GROUP BY 1,gr.sort_order)x),'[]'::jsonb),
    'byZone',COALESCE((SELECT jsonb_agg(jsonb_build_object('region',x.region,'name',x.name,'count',x.count,'graded',x.graded,
      'avgTotal',x."avgTotal",'pr',CASE WHEN pr_visible THEN public._exam_pr(x."avgTotal",zone_avgs)ELSE NULL END)
      ORDER BY x.region_sort NULLS LAST,x.zone_sort NULLS LAST,x.region,x.name)FROM(
      SELECT COALESCE(NULLIF(p.great_region,''),'（未分區）')region,
        COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）')name,
        gr.sort_order region_sort,pz.sort_order zone_sort,COUNT(*)count,
        COUNT(*)FILTER(WHERE a.status='graded')graded,ROUND(AVG(a.total_score)FILTER(WHERE a.status='graded')::numeric,1)"avgTotal"
      FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      LEFT JOIN public.great_regions gr ON gr.name=p.great_region
      LEFT JOIN public.pastoral_zones pz ON pz.name=p.pastoral_zone AND pz.great_region_id=gr.id
      WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')GROUP BY 1,2,gr.sort_order,pz.sort_order)x),'[]'::jsonb),
    'byGroup',COALESCE((SELECT jsonb_agg(jsonb_build_object('zone',x.zone,'name',x.name,'count',x.count,'graded',x.graded,
      'avgTotal',x."avgTotal",'pr',CASE WHEN pr_visible THEN public._exam_pr(x."avgTotal",group_avgs)ELSE NULL END)
      ORDER BY x.zone_sort NULLS LAST,x.zone,x.name)FROM(
      SELECT COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）')zone,
        COALESCE(NULLIF(p.small_group,''),'（未分組）')name,
        pz.sort_order zone_sort,COUNT(*)count,
        COUNT(*)FILTER(WHERE a.status='graded')graded,ROUND(AVG(a.total_score)FILTER(WHERE a.status='graded')::numeric,1)"avgTotal"
      FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      LEFT JOIN public.great_regions gr ON gr.name=p.great_region
      LEFT JOIN public.pastoral_zones pz ON pz.name=p.pastoral_zone AND pz.great_region_id=gr.id
      WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')GROUP BY 1,2,pz.sort_order)x),'[]'::jsonb),
    -- 沒綁定計畫的獨立測驗卷不顯示任何團隊統計（byTeamSize / teamRanking）：
    -- 沒有計畫脈絡就沒有「這份卷的團隊」這個概念，硬要算只會把毫不相干、
    -- 剛好也在某個 3/6 人隊的人湊在一起，變成誤導性的假資訊。byTeamSize 的
    -- 隊員身分判定也加 m.global_plan_id=pr.linked_plan_id，只認「在這個計畫
    -- 底下」的隊籍——不然即使這個計畫本身沒隊，個人若剛好在別的計畫掛著
    -- 3/6 人隊，也會被誤算進來，一樣是誤導性資訊。
    'byTeamSize',CASE WHEN pr.linked_plan_id IS NULL THEN '[]'::jsonb ELSE
      COALESCE((SELECT jsonb_agg(jsonb_build_object('label',b.label,'count',b.cnt,
      'graded',b.graded,'avgTotal',b.avg_total)ORDER BY b.sort)FROM(
      SELECT bl.label,bl.sort,COUNT(*)FILTER(WHERE bl.member)cnt,
        COUNT(*)FILTER(WHERE bl.member AND a.status='graded')graded,
        ROUND(AVG(a.total_score)FILTER(WHERE bl.member AND a.status='graded')::numeric,1)avg_total
      FROM public.exam_attempts a CROSS JOIN LATERAL(VALUES
        ('3 人團隊'::text,1,EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division=3 AND m.global_plan_id=pr.linked_plan_id)),
        ('6 人團隊'::text,2,EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division=6 AND m.global_plan_id=pr.linked_plan_id)),
        ('未組隊'::text,3,NOT EXISTS(SELECT 1 FROM public.reading_team_members m WHERE m.user_id=a.user_id AND m.division IN(3,6) AND m.global_plan_id=pr.linked_plan_id))
      )bl(label,sort,member)WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')
      GROUP BY bl.label,bl.sort)b WHERE b.cnt>0),'[]'::jsonb)
    END,
    'teamRanking',COALESCE((
      WITH RECURSIVE team_root(id,anchor)AS(
        SELECT rt.id,rt.id FROM public.reading_teams rt
        WHERE rt.carried_from_team_id IS NULL
           OR NOT EXISTS(SELECT 1 FROM public.reading_teams p WHERE p.id=rt.carried_from_team_id)
        UNION ALL
        SELECT rt.id,r.anchor FROM public.reading_teams rt
        JOIN team_root r ON rt.carried_from_team_id=r.id
      ),
      -- 排行榜只跟著試卷自己綁定的 pr.linked_plan_id 走，沒有其他判斷/猜測：
      -- 沒綁定就直接 WHERE FALSE，candidate 集合是空的，teamRanking 自然是
      -- []（不用團隊排名）；有綁定但那個計畫底下根本沒登記任何 3/6 人隊，
      -- candidate 集合一樣是空的，同樣自然變成 []（計畫本身沒有團隊資訊也
      -- 不用團隊排名）——兩種情況都不用另外判斷，讓 SQL 本身自然產生空結果。
      -- 有隊的話，每條隊伍鏈只留「屬於這個計畫」的那一節：已經升到下一階段
      -- 的隊伍鏈，找不到符合的一節就整支從候選中消失，同一條鏈也不重複認列。
      latest_team AS(
        SELECT DISTINCT ON(tr.anchor,rt.division)
          rt.id team_id,rt.name,rt.division,rt.global_plan_id,rt.captain_id
        FROM public.reading_teams rt
        JOIN team_root tr ON tr.id=rt.id
        WHERE rt.division IN(3,6)
          AND pr.linked_plan_id IS NOT NULL
          AND rt.global_plan_id=pr.linked_plan_id
        ORDER BY tr.anchor,rt.division,rt.created_at DESC,rt.id DESC
      )
      -- 分數只算「有作答（且開關開時＝有讀完）」的成員（scoped_stats），分母固定 division。
      -- 缺口再拆三類讓管理員看得出原因：
      --   notRead    ＝有考試、但沒讀完該書卷（開關開時不計分；開關關時恆 0）
      --   notTested  ＝隊員本人完全沒有這份測驗的 submitted/graded 作答
      --   emptySlots ＝隊伍沒滿 division 人
      SELECT jsonb_agg(jsonb_build_object('teamId',t.team_id,'name',t.name,
        'division',t.division,'rank',t.rnk,'completed',t.completed,'submitted',t.submitted_cnt,
        'notRead',t.not_read_cnt,'notTested',t.not_tested_cnt,'emptySlots',t.empty_slots,
        'greatRegion',t.captain_region,'pastoralZone',t.captain_zone,
        'teamTotal',t.team_total,'avgTotal',t.avg_total,
        'pr',CASE WHEN pr_visible AND t.submitted_cnt>0
          THEN public._exam_pr(t.avg_total,CASE t.division WHEN 3 THEN team3_avgs WHEN 6 THEN team6_avgs END)
          ELSE NULL END)
        ORDER BY t.division,t.rnk,t.name)
      FROM(
        SELECT ranked.team_id,ranked.name,ranked.division,ranked.completed,ranked.submitted_cnt,
          ranked.not_read_cnt,ranked.not_tested_cnt,ranked.empty_slots,
          ranked.team_total,ranked.avg_total,ranked.captain_region,ranked.captain_zone,
          RANK()OVER(PARTITION BY ranked.division ORDER BY ranked.avg_total DESC)rnk
        FROM(
          SELECT lt.team_id,lt.name,lt.division,cap.great_region captain_region,cap.pastoral_zone captain_zone,
            COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status='graded')completed,
            COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded'))submitted_cnt,
            GREATEST(0,COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded'))
              -COUNT(a.id)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status IN('submitted','graded')))not_read_cnt,
            GREATEST(0,COUNT(DISTINCT m.user_id)
              -COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded')))not_tested_cnt,
            GREATEST(0,lt.division-COUNT(DISTINCT m.user_id))empty_slots,
            COALESCE(SUM(a.total_score)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status='graded'),0)team_total,
            ROUND(COALESCE(SUM(a.total_score)FILTER(WHERE a.id=ANY(scoped_stats)AND a.status='graded'),0)::numeric/lt.division,1)avg_total
          FROM latest_team lt
          LEFT JOIN public.profiles cap ON cap.id=lt.captain_id
          JOIN public.reading_team_members m ON m.team_id=lt.team_id
          LEFT JOIN public.exam_attempts a
            ON a.user_id=m.user_id AND a.paper_id=pr.id AND a.attempt_kind='official' AND a.id=ANY(scoped)
          GROUP BY lt.team_id,lt.name,lt.division,lt.global_plan_id,cap.great_region,cap.pastoral_zone
          -- lt 已經是「屬於 linked_plan_id 的隊」（latest_team 的 WHERE 保證），
          -- 這裡只差要不要對 admin 顯示 0 分墊底的隊；範圍主管一律只看有人作答的隊。
          HAVING scope_all OR COUNT(a.id)FILTER(WHERE a.status IN('submitted','graded'))>0
        )ranked
      )t
    ),'[]'::jsonb),
    'byQuestion',COALESCE((SELECT jsonb_agg(x ORDER BY x."sectionRank",x.position)FROM(
      SELECT q.section,q.position,public._exam_section_rank(q.section)"sectionRank",COUNT(ea.*)answered,
        COUNT(ea.*)FILTER(WHERE ea.auto_correct)correct,
        ROUND((COUNT(ea.*)FILTER(WHERE ea.auto_correct))::numeric/NULLIF(COUNT(ea.*),0),3)"correctRate"
      FROM public.exam_questions q JOIN public.exam_answers ea ON ea.question_id=q.id
      JOIN public.exam_attempts a ON a.id=ea.attempt_id AND a.status IN('submitted','graded')AND a.id=ANY(scoped_stats)
      WHERE q.paper_id=pr.id AND q.section<>'shortanswer' GROUP BY q.id,q.section,q.position)x),'[]'::jsonb),
    'roster',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'name',p.name,
      'greatRegion',p.great_region,'pastoralZone',p.pastoral_zone,'smallGroup',p.small_group,
      'teamLabel',(SELECT CASE WHEN bool_or(m.division=3)AND bool_or(m.division=6)THEN'3+6 人團隊'
        WHEN bool_or(m.division=3)THEN'3 人團隊' WHEN bool_or(m.division=6)THEN'6 人團隊' ELSE'個人'END
        FROM public.reading_team_members m WHERE m.user_id=a.user_id),
      'status',a.status,'autoScore',a.auto_score,'manualScore',a.manual_score,'totalScore',a.total_score,
      'submittedAt',a.submitted_at,
      'timeSeconds',CASE WHEN a.submitted_at IS NOT NULL AND a.started_at IS NOT NULL
        THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(a.submitted_at-a.started_at)))::INT) ELSE NULL END,
      'firstRoundDone',CASE WHEN v_book IS NULL THEN NULL ELSE public._user_read_book_once(a.user_id,v_book,p_book_chapters)END,
      'prChurch',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
        THEN public._exam_pr(a.total_score,church_scores)ELSE NULL END,
      'prZone',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
        THEN public._exam_pr(a.total_score,
        ARRAY(SELECT a2.total_score FROM public.exam_attempts a2 JOIN public.profiles p2 ON p2.id=a2.user_id
          WHERE a2.paper_id=pr.id AND a2.attempt_kind='official' AND a2.status='graded' AND a2.total_score IS NOT NULL
            AND(NOT v_filter OR public._user_read_book_once(a2.user_id,v_book,p_book_chapters))
            AND COALESCE(NULLIF(p2.pastoral_zone,''),'（未分牧區）')=COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）')))
        ELSE NULL END,
      'prGroup',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR public._user_read_book_once(a.user_id,v_book,p_book_chapters))
        THEN public._exam_pr(a.total_score,
        ARRAY(SELECT a2.total_score FROM public.exam_attempts a2 JOIN public.profiles p2 ON p2.id=a2.user_id
          WHERE a2.paper_id=pr.id AND a2.attempt_kind='official' AND a2.status='graded' AND a2.total_score IS NOT NULL
            AND(NOT v_filter OR public._user_read_book_once(a2.user_id,v_book,p_book_chapters))
            AND COALESCE(NULLIF(p2.small_group,''),'（未分組）')=COALESCE(NULLIF(p.small_group,''),'（未分組）')))
        ELSE NULL END)
      ORDER BY a.total_score DESC NULLS LAST,a.submitted_at ASC)
      FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.id=ANY(scoped)AND a.status IN('submitted','graded')),'[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_get_stats"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_require_first_round" boolean, "p_reading_book" "text", "p_book_chapters" integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_get_stats"("p_paper_id" "uuid", "p_actor_id" "uuid", "p_require_first_round" boolean, "p_reading_book" "text", "p_book_chapters" integer) TO authenticated, service_role;

-- ── exam_home_banner ──
CREATE OR REPLACE FUNCTION "public"."exam_home_banner"("p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);is_staff BOOLEAN:=public._exam_actor_role(actor_id)IN('admin','pastor');
  paper_id UUID;
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam')THEN RETURN NULL; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT pr.id INTO paper_id FROM public.exam_papers pr
  WHERE (
      pr.announcement_published = TRUE
      OR (pr.pre_announcement_enabled = TRUE
          AND COALESCE(btrim(pr.pre_announcement->>'headline'), '') <> ''
          AND COALESCE(btrim(pr.pre_announcement->>'body'), '') <> '')
    )
  ORDER BY pr.announced_at DESC NULLS LAST,pr.created_at DESC LIMIT 1;
  IF paper_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._exam_member_paper_summary(paper_id,actor_id,is_staff);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_home_banner"("p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_home_banner"("p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_home_exams ──
CREATE OR REPLACE FUNCTION "public"."exam_home_exams"("p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
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
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.status = 'published' AND NOW() < pr.open_at) DESC,
        pr.open_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    WHERE (
      pr.announcement_published = TRUE
      OR (pr.pre_announcement_enabled = TRUE
          AND COALESCE(btrim(pr.pre_announcement->>'headline'), '') <> ''
          AND COALESCE(btrim(pr.pre_announcement->>'body'), '') <> '')
    )
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_home_exams"("p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_home_exams"("p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_my_papers ──
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
      ON oa.paper_id = pr.id AND oa.user_id = actor_id AND oa.attempt_kind = 'official'
    WHERE (oa.id IS NOT NULL OR pr.announcement_published = TRUE)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_my_papers"("p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_my_papers"("p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_publish ──
CREATE OR REPLACE FUNCTION "public"."exam_publish"("p_paper_id" "uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr public.exam_papers%ROWTYPE;
  sec TEXT; want INTEGER; got INTEGER;
  enabled_types TEXT[];
  cleared INTEGER;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status <> 'draft' THEN RAISE EXCEPTION 'exam_already_published'; END IF;
  IF NOT pr.announcement_published THEN RAISE EXCEPTION 'exam_not_announced'; END IF;
  IF pr.open_at IS NULL OR pr.close_at IS NULL OR pr.close_at <= pr.open_at OR pr.close_at <= NOW() THEN
    RAISE EXCEPTION 'exam_window_invalid';
  END IF;
  IF COALESCE(jsonb_array_length(pr.sections), 0) = 0 THEN RAISE EXCEPTION 'exam_no_sections'; END IF;
  SELECT array_agg(e ->> 'type') INTO enabled_types FROM jsonb_array_elements(pr.sections) e;
  FOR sec, want IN SELECT e ->> 'type', (e ->> 'count')::int FROM jsonb_array_elements(pr.sections) e LOOP
    SELECT COUNT(*) INTO got FROM public.exam_questions WHERE paper_id = pr.id AND section = sec;
    IF got <> want THEN RAISE EXCEPTION 'exam_section_count_mismatch: % expected % got %', sec, want, got; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.exam_questions WHERE paper_id = pr.id AND NOT (section = ANY (enabled_types))) THEN
    RAISE EXCEPTION 'exam_section_not_enabled';
  END IF;

  -- 草稿期間的演練作答（連帶答案、批改、通知）在發佈前清掉，會友看到的是乾淨的卷，
  -- 管理員發佈後也能再正式作答一次。
  DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;
  GET DIAGNOSTICS cleared = ROW_COUNT;

  UPDATE public.exam_papers SET status = 'published', published_at = NOW(), published_by = actor_id,
    closed_at = NULL, closed_by = NULL, close_reason = NULL
  WHERE id = pr.id;

  RETURN jsonb_build_object('paperId', pr.id, 'status', 'published',
    'answerKeysComplete', public._exam_keys_complete(pr.id),
    'clearedRehearsalAttempts', cleared);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_publish"("p_paper_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_publish"("p_paper_id" "uuid", "p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_reset_attempts ──
CREATE OR REPLACE FUNCTION "public"."exam_reset_attempts"("p_paper_id" "uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
  IF pr.status <> 'draft' THEN RAISE EXCEPTION 'exam_reset_live_forbidden'; END IF;
  IF pr.results_published_at IS NOT NULL THEN RAISE EXCEPTION 'exam_results_locked'; END IF;

  DELETE FROM public.exam_attempts WHERE paper_id = pr.id;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  RETURN jsonb_build_object('paperId', pr.id, 'deletedAttempts', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_reset_attempts"("p_paper_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_reset_attempts"("p_paper_id" "uuid", "p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_start_attempt ──
CREATE OR REPLACE FUNCTION "public"."exam_start_attempt"("p_paper_id" "uuid", "p_pledge_name" "text", "p_reading_team_id" "uuid" DEFAULT NULL::"uuid", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
  pr public.exam_papers%ROWTYPE;
  at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ := NOW();
  seed TEXT;
  deadline TIMESTAMPTZ;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;

  SELECT * INTO at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  IF FOUND THEN
    RETURN jsonb_build_object('attemptId', at.id, 'status', at.status, 'attemptKind', 'official', 'resumed', TRUE,
      'deadlineAt', at.deadline_at,
      'secondsRemaining', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int,
      'layout', at.layout, 'paperSnapshot', at.paper_snapshot);
  END IF;

  -- 管理員不受狀態與開放時段限制（草稿卷上即演練）。一般會友只能作答
  -- 已發佈、在開放時段內的卷。
  IF NOT is_staff THEN
    IF pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN
      RAISE EXCEPTION 'exam_not_open';
    END IF;
  END IF;

  IF COALESCE(TRIM(p_pledge_name), '') = '' THEN RAISE EXCEPTION 'exam_pledge_name_required'; END IF;
  seed := md5(pr.id::text || ':' || actor_id::text || ':official:' || COALESCE(pr.published_at, pr.created_at)::text);
  deadline := LEAST(now_ts + make_interval(mins => pr.duration_minutes),
                    COALESCE(pr.close_at, now_ts + make_interval(mins => pr.duration_minutes)));

  INSERT INTO public.exam_attempts(paper_id, user_id, reading_team_id, is_test, status, started_at, deadline_at,
    pledge_name, pledge_agreed_at, pledge_snapshot, layout, paper_snapshot, attempt_kind, attempt_no)
  VALUES (pr.id, actor_id, p_reading_team_id,
    -- 演練：草稿卷
    (pr.status = 'draft'),
    'in_progress', now_ts, deadline, TRIM(p_pledge_name), now_ts,
    pr.pledge, public._exam_build_layout(pr.id, seed), public._exam_paper_snapshot(pr.id), 'official', 1)
  ON CONFLICT DO NOTHING RETURNING * INTO at;

  IF at.id IS NULL THEN
    SELECT * INTO at FROM public.exam_attempts
    WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  END IF;

  RETURN jsonb_build_object('attemptId', at.id, 'status', at.status, 'attemptKind', 'official', 'resumed', FALSE,
    'deadlineAt', at.deadline_at,
    'secondsRemaining', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int,
    'layout', at.layout, 'paperSnapshot', at.paper_snapshot);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_start_attempt"("p_paper_id" "uuid", "p_pledge_name" "text", "p_reading_team_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_start_attempt"("p_paper_id" "uuid", "p_pledge_name" "text", "p_reading_team_id" "uuid", "p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_start_practice ──
CREATE OR REPLACE FUNCTION "public"."exam_start_practice"("p_paper_id" "uuid", "p_acknowledged" boolean DEFAULT false, "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);pr public.exam_papers%ROWTYPE;
  official_at public.exam_attempts%ROWTYPE;at public.exam_attempts%ROWTYPE;now_ts TIMESTAMPTZ:=NOW();
  practice_end TIMESTAMPTZ;seed TEXT;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  practice_end:=public._exam_practice_close_at(pr.id);
  SELECT * INTO at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=actor_id AND attempt_kind='practice';
  IF FOUND THEN RETURN jsonb_build_object('attemptId',at.id,'status',at.status,'attemptKind','practice',
    'resumed',TRUE,'layout',at.layout,'paperSnapshot',at.paper_snapshot,'practiceCloseAt',practice_end); END IF;
  IF NOT COALESCE(p_acknowledged,FALSE) THEN RAISE EXCEPTION 'exam_practice_ack_required'; END IF;
  IF NOT pr.practice_retake_enabled OR pr.status NOT IN('published','closed') OR now_ts>=practice_end THEN
    RAISE EXCEPTION 'exam_practice_not_open'; END IF;
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=actor_id AND attempt_kind='official';
  IF NOT FOUND OR official_at.status='in_progress' THEN RAISE EXCEPTION 'exam_practice_requires_official_submission'; END IF;
  seed:=md5(pr.id::text||':'||actor_id::text||':practice:'||COALESCE(pr.published_at,pr.created_at)::text);
  INSERT INTO public.exam_attempts(paper_id,user_id,reading_team_id,is_test,status,started_at,deadline_at,
    pledge_name,pledge_agreed_at,pledge_snapshot,layout,paper_snapshot,attempt_kind,attempt_no,
    official_attempt_id,practice_acknowledged_at)
  VALUES(pr.id,actor_id,official_at.reading_team_id,FALSE,'in_progress',now_ts,practice_end,
    official_at.pledge_name,now_ts,official_at.pledge_snapshot,public._exam_build_layout(pr.id,seed),
    public._exam_paper_snapshot(pr.id),'practice',1,official_at.id,now_ts)
  ON CONFLICT DO NOTHING RETURNING * INTO at;
  IF at.id IS NULL THEN SELECT * INTO at FROM public.exam_attempts
    WHERE paper_id=pr.id AND user_id=actor_id AND attempt_kind='practice'; END IF;
  RETURN jsonb_build_object('attemptId',at.id,'status',at.status,'attemptKind','practice','resumed',FALSE,
    'layout',at.layout,'paperSnapshot',at.paper_snapshot,'practiceCloseAt',practice_end);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_start_practice"("p_paper_id" "uuid", "p_acknowledged" boolean, "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_start_practice"("p_paper_id" "uuid", "p_acknowledged" boolean, "p_actor_id" "uuid") TO authenticated, service_role;

-- ── exam_upsert_paper ──
CREATE OR REPLACE FUNCTION "public"."exam_upsert_paper"("p_payload" "jsonb", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_paper_id UUID := NULLIF(p_payload ->> 'id', '')::uuid;
  v_sections JSONB := p_payload -> 'sections';
  v_has_plan BOOLEAN := p_payload ? 'linked_plan_id';
  v_plan_id  UUID := NULLIF(p_payload ->> 'linked_plan_id', '')::uuid;
  row_out    public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  IF v_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.global_plans WHERE id = v_plan_id) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  IF v_paper_id IS NULL THEN
    IF v_sections IS NULL THEN
      v_sections := jsonb_build_array(
        jsonb_build_object('type','truefalse','count',20,'pointsPer',1),
        jsonb_build_object('type','single','count',20,'pointsPer',1),
        jsonb_build_object('type','multiple','count',10,'pointsPer',1),
        jsonb_build_object('type','matching','count',10,'pointsPer',1),
        jsonb_build_object('type','ordering','count',10,'pointsPer',1),
        jsonb_build_object('type','shortanswer','count',3,'pointsPer',10));
    END IF;
    INSERT INTO public.exam_papers (title, description, open_at, close_at,
        duration_minutes, total_points, pledge, sections, section_targets, linked_plan_id, created_by)
    VALUES (
      COALESCE(NULLIF(p_payload ->> 'title', ''), '速讀測驗'),
      COALESCE(p_payload ->> 'description', ''),
      NULLIF(p_payload ->> 'open_at', '')::timestamptz,
      NULLIF(p_payload ->> 'close_at', '')::timestamptz,
      COALESCE((p_payload ->> 'duration_minutes')::smallint, 75),
      GREATEST(public._exam_sections_total(v_sections)::smallint, 1),
      COALESCE(p_payload -> 'pledge', jsonb_build_object('openText','', 'rules','[]'::jsonb, 'consentTemplate','')),
      v_sections,
      public._exam_sections_targets(v_sections),
      v_plan_id,
      actor_id)
    RETURNING * INTO row_out;
  ELSE
    UPDATE public.exam_papers SET
      title = COALESCE(NULLIF(p_payload ->> 'title', ''), title),
      description = COALESCE(p_payload ->> 'description', description),
      open_at = COALESCE(NULLIF(p_payload ->> 'open_at', '')::timestamptz, open_at),
      close_at = COALESCE(NULLIF(p_payload ->> 'close_at', '')::timestamptz, close_at),
      duration_minutes = COALESCE((p_payload ->> 'duration_minutes')::smallint, duration_minutes),
      pledge = COALESCE(p_payload -> 'pledge', pledge),
      sections = COALESCE(v_sections, sections),
      section_targets = CASE WHEN v_sections IS NOT NULL
                             THEN public._exam_sections_targets(v_sections) ELSE section_targets END,
      total_points = CASE WHEN v_sections IS NOT NULL
                          THEN GREATEST(public._exam_sections_total(v_sections)::smallint, 1)
                          ELSE COALESCE((p_payload ->> 'total_points')::smallint, total_points) END,
      linked_plan_id = CASE WHEN v_has_plan THEN v_plan_id ELSE linked_plan_id END
    WHERE id = v_paper_id AND status = 'draft'
    RETURNING * INTO row_out;
    IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;
  END IF;

  RETURN to_jsonb(row_out);
END;
$$;
REVOKE ALL ON FUNCTION "public"."exam_upsert_paper"("p_payload" "jsonb", "p_actor_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."exam_upsert_paper"("p_payload" "jsonb", "p_actor_id" "uuid") TO authenticated, service_role;

-- ── 刪除舊函式、試考名單、兩個欄位 ──
DROP FUNCTION IF EXISTS public.exam_push_to_live(uuid, uuid);
DROP FUNCTION IF EXISTS public.exam_set_mode(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.exam_add_tester(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.exam_remove_tester(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.exam_get_paper_testers(uuid, uuid);
DROP FUNCTION IF EXISTS public._exam_can_access_test(uuid, uuid);
DROP TABLE IF EXISTS public.exam_paper_testers;
ALTER TABLE public.exam_papers DROP COLUMN IF EXISTS pushed_from_id;
ALTER TABLE public.exam_papers DROP COLUMN IF EXISTS mode;

-- ── 檢查：public 裡不能再有函式引用這兩個欄位或試考名單 ──
DO $verify$
DECLARE offenders TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ~ 'pr\.mode\b|\mmode\s*=\s*''(test|live)''|pushed_from_id|exam_paper_testers|_exam_can_access_test');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'functions still reference removed exam columns: %', offenders;
  END IF;
END $verify$;
