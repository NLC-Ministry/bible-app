-- ============================================================================
-- #675 測驗函式改成集合式寫法（這支只改函式內部做法，分數、狀態、回傳內容都不變）
--
--   _exam_score_attempt：每題一次 SELECT＋一次 UPDATE → 一條 UPDATE … FROM。
--     _exam_close_paper、exam_recompute_scores 逐份作答呼叫它，成本從「作答數 × 題數 × 2」降到「作答數 × 1」。
--   exam_submit_attempt：每題一次子查詢＋一次 INSERT → 一條 INSERT … SELECT … ON CONFLICT。
--   exam_save_progress：每題一次 EXISTS＋一次 INSERT → 一條 INSERT … SELECT … ON CONFLICT。
--     key 先正規化：非 UUID 的 key 照舊整筆失敗、大寫 UUID 照舊對得到題目、同一題大小寫都送時照舊以後面那筆為準。
--   exam_get_stats：「讀完一遍」每份作答要判斷約 12 次 → 一人判斷一次（仍呼叫 _user_read_book_once，
--     判定規則只有一份）；牧區、小組 PR 母體不再每個名單列各掃一次全卷作答。
--
-- 行為由 scripts/db-behavior.test.mjs 的「#675 特徵」測試鎖住（改寫前的函式跑過同一批測試）。
-- 沒有改簽章、沒有新增 RPC，nlc-data 白名單不用動；舊版前端不受影響，不需要 forceUpdateBuiltBefore。
-- 刻意不動 _exam_team_avg_pop：issue 建議先篩 linked_plan，但現在的母體不分計畫，篩了 PR 值會變。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._exam_score_attempt(p_attempt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  at public.exam_attempts%ROWTYPE;
  v_auto_sum NUMERIC;
  v_has_short BOOLEAN;
  v_short_total INTEGER := 0;
  v_short_graded INTEGER := 0;
  v_short_sum NUMERIC := 0;
BEGIN
  SELECT * INTO at FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR at.status = 'in_progress' THEN RETURN; END IF;

  v_has_short := EXISTS (SELECT 1 FROM public.exam_questions q
                         WHERE q.paper_id = at.paper_id AND q.section = 'shortanswer');

  -- 從題目出發：沒有作答列的題目 response 是 NULL、算 0 分，也不會補列。
  WITH scored AS (
    SELECT q.id AS question_id, r.is_correct,
           CASE WHEN r.is_correct THEN q.points ELSE 0 END AS points
    FROM public.exam_questions q
    LEFT JOIN public.exam_answers ea ON ea.attempt_id = at.id AND ea.question_id = q.id
    CROSS JOIN LATERAL (
      SELECT public._exam_answer_is_correct(q.section, q.answer_key, ea.response) AS is_correct
    ) r
    WHERE q.paper_id = at.paper_id AND q.section <> 'shortanswer'
  ), updated AS (
    UPDATE public.exam_answers ea
    SET auto_correct = s.is_correct, awarded_points = s.points, updated_at = NOW()
    FROM scored s
    WHERE ea.attempt_id = at.id AND ea.question_id = s.question_id
  )
  SELECT COALESCE(SUM(s.points), 0) INTO v_auto_sum FROM scored s;

  IF at.attempt_kind = 'practice' THEN
    UPDATE public.exam_attempts SET
      status = 'graded', auto_score = v_auto_sum, manual_score = NULL, total_score = v_auto_sum
    WHERE id = at.id;
  ELSE
    SELECT COUNT(*),COUNT(*)FILTER(WHERE ea.awarded_points IS NOT NULL),
      COALESCE(SUM(ea.awarded_points),0) INTO v_short_total,v_short_graded,v_short_sum
    FROM public.exam_answers ea WHERE ea.attempt_id=at.id AND ea.section='shortanswer';
    UPDATE public.exam_attempts SET
      status = CASE WHEN v_has_short AND v_short_graded<v_short_total THEN 'submitted' ELSE 'graded' END,
      auto_score = v_auto_sum,
      manual_score = CASE WHEN v_has_short AND v_short_graded=v_short_total THEN v_short_sum
                          WHEN v_has_short THEN NULL ELSE 0 END,
      total_score = CASE WHEN v_has_short AND v_short_graded=v_short_total THEN v_auto_sum+v_short_sum
                         WHEN v_has_short THEN NULL ELSE v_auto_sum END
    WHERE id = at.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._exam_score_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_score_attempt(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_submit_attempt(p_attempt_id uuid, p_answers jsonb, p_reason text DEFAULT 'manual'::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id); at public.exam_attempts%ROWTYPE;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO at FROM public.exam_attempts WHERE id=p_attempt_id AND user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_attempt_not_found'; END IF;
  IF at.attempt_kind<>'official' THEN RAISE EXCEPTION 'exam_practice_no_submit'; END IF;
  IF at.status<>'in_progress' THEN RETURN jsonb_build_object('attemptId',at.id,'status',at.status,
    'attemptKind','official','alreadySubmitted',TRUE); END IF;
  -- 每題一列：有送用送的（JSON null 也算有送），沒送留暫存。
  INSERT INTO public.exam_answers(attempt_id,question_id,section,response,auto_correct,awarded_points)
  SELECT at.id,q.id,q.section,COALESCE(p_answers->q.id::text,ea.response),NULL,NULL
  FROM public.exam_questions q
  LEFT JOIN public.exam_answers ea ON ea.attempt_id=at.id AND ea.question_id=q.id
  WHERE q.paper_id=at.paper_id
  ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=EXCLUDED.response,
    auto_correct=NULL,awarded_points=NULL,updated_at=NOW();
  UPDATE public.exam_attempts SET status='submitted',submitted_at=NOW(),
    submit_reason=CASE WHEN p_reason IN('manual','timeout','auto_close') THEN p_reason ELSE 'manual' END,
    auto_score=NULL,manual_score=NULL,total_score=NULL WHERE id=at.id;
  -- 試作（#302）：送出就計分，管理員馬上看得到分數與對錯；正式作答仍等收卷才計分。
  IF at.is_test THEN PERFORM public._exam_score_attempt(at.id); END IF;
  RETURN jsonb_build_object('attemptId',at.id,'status','submitted','attemptKind','official',
    'autoScore',NULL,'totalScore',NULL,'alreadySubmitted',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_submit_attempt(uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_submit_attempt(uuid, jsonb, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_save_progress(p_attempt_id uuid, p_answers jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);at public.exam_attempts%ROWTYPE;
  pr public.exam_papers%ROWTYPE;practice_end TIMESTAMPTZ;v_answers JSONB;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO at FROM public.exam_attempts WHERE id=p_attempt_id AND user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_attempt_not_found'; END IF;
  IF at.status<>'in_progress' THEN RAISE EXCEPTION 'exam_attempt_locked'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id=at.paper_id;
  IF at.attempt_kind='practice' THEN
    practice_end:=public._exam_practice_close_at(pr.id);
    IF pr.status NOT IN('published','closed') OR NOW()>=practice_end THEN RAISE EXCEPTION 'exam_practice_locked'; END IF;
  ELSIF pr.status<>'published' OR NOW()>at.deadline_at+INTERVAL '120 seconds' THEN
    RAISE EXCEPTION 'exam_time_up';
  END IF;
  -- key 先轉成標準 UUID 字串：非 UUID 整筆失敗、大寫對得到題目、同一題送兩種寫法以後面那筆為準。
  v_answers:=COALESCE((
    SELECT jsonb_object_agg(e.key::uuid::text,e.value ORDER BY e.ord)
    FROM jsonb_each(COALESCE(p_answers,'{}'::jsonb)) WITH ORDINALITY e(key,value,ord)
  ),'{}'::jsonb);
  INSERT INTO public.exam_answers(attempt_id,question_id,section,response)
  SELECT at.id,q.id,q.section,v_answers->q.id::text
  FROM public.exam_questions q
  WHERE q.paper_id=at.paper_id AND v_answers ? q.id::text
  ON CONFLICT(attempt_id,question_id)DO UPDATE SET response=EXCLUDED.response,
    auto_correct=NULL,awarded_points=NULL,updated_at=NOW();
  RETURN jsonb_build_object('attemptId',at.id,'saved',TRUE,'attemptKind',at.attempt_kind,
    'practiceCloseAt',CASE WHEN at.attempt_kind='practice' THEN practice_end ELSE NULL END,
    'secondsRemaining',CASE WHEN at.attempt_kind='practice' THEN NULL ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(at.deadline_at-NOW()))))::int END);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_save_progress(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_save_progress(uuid, jsonb, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_get_stats(p_paper_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_require_first_round boolean DEFAULT false, p_reading_book text DEFAULT NULL::text, p_book_chapters integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID:=public.resolve_quiz_actor(p_actor_id);actor public.profiles%ROWTYPE;role_c TEXT;
  pr public.exam_papers%ROWTYPE;mreg TEXT[];mzon TEXT[];mgrp TEXT[];scoped UUID[];scoped_stats UUID[];scope_label TEXT;
  scope_all BOOLEAN;v_book TEXT;v_filter BOOLEAN;
  pr_visible BOOLEAN;results_pub BOOLEAN;church_scores NUMERIC[];region_avgs NUMERIC[];zone_avgs NUMERIC[];
  group_avgs NUMERIC[];team3_avgs NUMERIC[];team6_avgs NUMERIC[];
  eligible_count INTEGER;
  v_read_users UUID[];
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

  -- #675：「讀完一遍」一人只判斷一次，後面全部查這份名單。v_book 是 NULL 時所有用到的地方都有
  -- 先擋（NOT v_filter、v_book IS NOT NULL、CASE WHEN v_book IS NULL），所以不用算。
  IF v_book IS NOT NULL THEN
    v_read_users:=ARRAY(
      SELECT u.user_id
      FROM(SELECT DISTINCT a.user_id FROM public.exam_attempts a
           WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test)u
      WHERE public._user_read_book_once(u.user_id,v_book,p_book_chapters));
  END IF;

  SELECT COALESCE(array_agg(a.id),'{}')INTO scoped
  FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
  WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND(
    role_c IN('admin','pastor')OR(role_c='great_zone_leader' AND p.great_region=ANY(mreg))
    OR(role_c='zone_leader' AND p.pastoral_zone=ANY(mzon))
    OR(role_c='group_leader' AND p.small_group=ANY(mgrp)));

  -- 只統計已讀完該書卷一遍的人（toggle 開啟時）
  IF v_filter THEN
    SELECT COALESCE(array_agg(a.id),'{}')INTO scoped_stats
    FROM public.exam_attempts a
    WHERE a.id=ANY(scoped) AND a.user_id=ANY(v_read_users);
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
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.status='graded' AND a.total_score IS NOT NULL
        AND(NOT v_filter OR a.user_id=ANY(v_read_users)));
    region_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
      GROUP BY COALESCE(NULLIF(p.great_region,''),'（未分區）'));
    zone_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
      GROUP BY COALESCE(NULLIF(p.great_region,''),'（未分區）'),COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）'));
    group_avgs:=ARRAY(SELECT ROUND(AVG(a.total_score)::numeric,1)FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
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
        AND v_book IS NOT NULL AND NOT a2.user_id=ANY(v_read_users)))
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
            ON a.user_id=m.user_id AND a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND a.id=ANY(scoped)
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
    'roster',COALESCE((
      WITH pop AS MATERIALIZED(
        SELECT a2.total_score,
          COALESCE(NULLIF(p2.pastoral_zone,''),'（未分牧區）')zone_key,
          COALESCE(NULLIF(p2.small_group,''),'（未分組）')group_key
        FROM public.exam_attempts a2 JOIN public.profiles p2 ON p2.id=a2.user_id
        WHERE a2.paper_id=pr.id AND a2.attempt_kind='official' AND NOT a2.is_test AND a2.status='graded' AND a2.total_score IS NOT NULL
          AND(NOT v_filter OR a2.user_id=ANY(v_read_users))
      ),
      zone_pop AS(SELECT pop.zone_key,array_agg(pop.total_score)scores FROM pop GROUP BY pop.zone_key),
      group_pop AS(SELECT pop.group_key,array_agg(pop.total_score)scores FROM pop GROUP BY pop.group_key)
      SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'name',p.name,
      'greatRegion',p.great_region,'pastoralZone',p.pastoral_zone,'smallGroup',p.small_group,
      'teamLabel',(SELECT CASE WHEN bool_or(m.division=3)AND bool_or(m.division=6)THEN'3+6 人團隊'
        WHEN bool_or(m.division=3)THEN'3 人團隊' WHEN bool_or(m.division=6)THEN'6 人團隊' ELSE'個人'END
        FROM public.reading_team_members m WHERE m.user_id=a.user_id),
      'status',a.status,'autoScore',a.auto_score,'manualScore',a.manual_score,'totalScore',a.total_score,
      'submittedAt',a.submitted_at,
      'timeSeconds',CASE WHEN a.submitted_at IS NOT NULL AND a.started_at IS NOT NULL
        THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(a.submitted_at-a.started_at)))::INT) ELSE NULL END,
      'firstRoundDone',CASE WHEN v_book IS NULL THEN NULL ELSE a.user_id=ANY(v_read_users)END,
      'prChurch',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
        THEN public._exam_pr(a.total_score,church_scores)ELSE NULL END,
      'prZone',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
        THEN public._exam_pr(a.total_score,
        (SELECT z.scores FROM zone_pop z WHERE z.zone_key=COALESCE(NULLIF(p.pastoral_zone,''),'（未分牧區）')))
        ELSE NULL END,
      'prGroup',CASE WHEN pr_visible AND a.status='graded'
        AND(NOT v_filter OR a.user_id=ANY(v_read_users))
        THEN public._exam_pr(a.total_score,
        (SELECT g.scores FROM group_pop g WHERE g.group_key=COALESCE(NULLIF(p.small_group,''),'（未分組）')))
        ELSE NULL END)
      ORDER BY a.total_score DESC NULLS LAST,a.submitted_at ASC)
      FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id
      WHERE a.id=ANY(scoped)AND a.status IN('submitted','graded')),'[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.exam_get_stats(uuid, uuid, boolean, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_get_stats(uuid, uuid, boolean, text, integer) TO authenticated, service_role;
