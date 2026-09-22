-- 0197_exam_time_accuracy_participation.sql
--
-- 大測驗新增三項統計：
--   1. 作答時間（timeSeconds）——本人這次作答花了幾秒，submitted_at - started_at。
--      submitted 就能看到（不用等批改/公布），跟正確性無關，不算洩題。
--   2. 答對率（accuracyRate／accuracyCorrect／accuracyTotal）——本人在所有自動
--      計分題（排除簡答）中答對的比例。答對與否本來就是 show_full 才會揭露的
--      資訊（reviewVisibility='full_review' 才看得到每題 autoCorrect），這裡
--      沿用同一個 show_full 閘門，不提前曝光。
--   3. 參與率（eligibleCount／participationRate）——後台統計新增，沿用
--      exam_get_stats 既有的範圍權限（scope_label / mreg/mzon/mgrp）：
--      admin/pastor 看全教會，範圍主管只看自己管轄範圍。應考母體＝
--      is_active 會友；若這份卷有綁定計畫（linked_plan_id），母體只算
--      有登記那個計畫讀經進度的人（跟團隊排行一樣的「這個計畫底下」邏輯），
--      獨立測驗卷（沒綁定）母體就是範圍內全部 is_active 會友。
--
-- 純 CREATE OR REPLACE，兩個函式簽名都不變，沿用各自既有的
-- REVOKE ALL ... FROM PUBLIC（0122／0194 已下過，這裡不用重下）。
-- 部署：Supabase SQL editor 執行，或 supabase db push。

-- ── exam_get_my_result：加 timeSeconds + accuracyRate/accuracyCorrect/accuracyTotal ──
CREATE OR REPLACE FUNCTION public.exam_get_my_result(
  p_paper_id UUID,p_actor_id UUID DEFAULT NULL,p_attempt_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN:=public._exam_actor_role(actor_id)IN('admin','pastor');
  at public.exam_attempts%ROWTYPE;pr public.exam_papers%ROWTYPE;published BOOLEAN;show_full BOOLEAN;
  show_pr BOOLEAN;church_scores NUMERIC[];actor_zone TEXT;zone_scores NUMERIC[];
  accuracy_correct INTEGER;accuracy_total INTEGER;
BEGIN
  PERFORM public._exam_close_expired_papers();
  IF p_attempt_id IS NOT NULL THEN
    SELECT * INTO at FROM public.exam_attempts WHERE id=p_attempt_id AND paper_id=p_paper_id
      AND(user_id=actor_id OR is_staff);
  ELSE
    SELECT * INTO at FROM public.exam_attempts WHERE paper_id=p_paper_id AND user_id=actor_id AND attempt_kind='official';
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','no_attempt'); END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id=at.paper_id;
  published:=pr.results_published_at IS NOT NULL;
  show_full:=(at.status='graded')AND(published OR is_staff);
  -- PR：只有「正式卷 + 已批改 + 已公布」才計算。管理員預覽（published=false）也不給。
  show_pr:=(at.attempt_kind='official')AND(at.status='graded')AND published;
  IF show_pr THEN
    church_scores:=ARRAY(SELECT x.total_score FROM public.exam_attempts x
      WHERE x.paper_id=at.paper_id AND x.attempt_kind='official' AND x.status='graded'
        AND x.total_score IS NOT NULL);
    actor_zone:=NULLIF(BTRIM((SELECT p.pastoral_zone FROM public.profiles p WHERE p.id=actor_id)),'');
    IF actor_zone IS NOT NULL THEN
      zone_scores:=ARRAY(SELECT x.total_score FROM public.exam_attempts x
        JOIN public.profiles p ON p.id=x.user_id
        WHERE x.paper_id=at.paper_id AND x.attempt_kind='official' AND x.status='graded'
          AND x.total_score IS NOT NULL AND NULLIF(BTRIM(p.pastoral_zone),'')=actor_zone);
    END IF;
  END IF;
  -- 答對率：跟 answers[].autoCorrect 用同一個 show_full 閘門，不比揭曉時間早。
  -- 分母＝這份卷所有非簡答題（不管有沒有作答，沒作答視為答錯，跟總分算法一致）。
  IF show_full THEN
    SELECT COUNT(*)FILTER(WHERE ea.auto_correct),COUNT(*)
      INTO accuracy_correct,accuracy_total
      FROM public.exam_questions q
      LEFT JOIN public.exam_answers ea ON ea.question_id=q.id AND ea.attempt_id=at.id
      WHERE q.paper_id=at.paper_id AND q.section<>'shortanswer';
  END IF;
  RETURN jsonb_build_object(
    'state',CASE WHEN at.status='in_progress'THEN'in_progress' WHEN show_full THEN'graded' ELSE'submitted' END,
    'attemptId',at.id,'attemptKind',at.attempt_kind,'countsTowardScore',at.attempt_kind='official',
    'resultsPublished',published,'staffPreview',(show_full AND NOT published AND is_staff),
    'reviewVisibility',CASE WHEN show_full THEN'full_review' ELSE'responses_only' END,
    'autoScore',CASE WHEN show_full THEN at.auto_score ELSE NULL END,
    'manualScore',CASE WHEN show_full THEN at.manual_score ELSE NULL END,
    'totalScore',CASE WHEN show_full THEN at.total_score ELSE NULL END,
    -- ── 作答時間：跟正確性無關，送出了就能看，不用等批改／公布 ──
    'timeSeconds',CASE WHEN at.status IN('submitted','graded')AND at.submitted_at IS NOT NULL AND at.started_at IS NOT NULL
      THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(at.submitted_at-at.started_at)))::INT) ELSE NULL END,
    -- ── 答對率：自動計分題（排除簡答）答對比例，show_full 才給 ──
    'accuracyRate',CASE WHEN show_full AND COALESCE(accuracy_total,0)>0
      THEN ROUND(accuracy_correct::numeric/accuracy_total,3) ELSE NULL END,
    'accuracyCorrect',CASE WHEN show_full THEN accuracy_correct ELSE NULL END,
    'accuracyTotal',CASE WHEN show_full THEN accuracy_total ELSE NULL END,
    -- ── PR（公布後才有；不含任何隊友分數，只有隊伍平均與 PR）──
    'prPublished',show_pr,
    'prChurch',CASE WHEN show_pr THEN public._exam_pr(at.total_score,church_scores) ELSE NULL END,
    'myPastoralZone',CASE WHEN show_pr THEN actor_zone ELSE NULL END,
    'prZone',CASE WHEN show_pr THEN public._exam_pr(at.total_score,zone_scores) ELSE NULL END,
    'zoneAvg',CASE WHEN show_pr AND COALESCE(array_length(zone_scores,1),0)>0
      THEN ROUND((SELECT AVG(x) FROM unnest(zone_scores) x)::numeric,1) ELSE NULL END,
    'teams',CASE WHEN show_pr THEN COALESCE((
      WITH RECURSIVE team_root(id,anchor)AS(
        SELECT rt.id,rt.id FROM public.reading_teams rt
        WHERE rt.carried_from_team_id IS NULL
           OR NOT EXISTS(SELECT 1 FROM public.reading_teams p WHERE p.id=rt.carried_from_team_id)
        UNION ALL
        SELECT rt.id,r.anchor FROM public.reading_teams rt JOIN team_root r ON rt.carried_from_team_id=r.id
      ),
      latest_team AS(
        SELECT DISTINCT ON(tr.anchor,rt.division)rt.id team_id,rt.name,rt.division,rt.captain_id
        FROM public.reading_teams rt JOIN team_root tr ON tr.id=rt.id
        WHERE rt.division IN(3,6)
        ORDER BY tr.anchor,rt.division,rt.created_at DESC,rt.id DESC
      )
      SELECT jsonb_agg(jsonb_build_object('division',td.division,'name',td.name,
        'greatRegion',td.captain_region,'pastoralZone',td.captain_zone,
        'avg',td.avg_total,
        'pr',public._exam_pr(td.avg_total,public._exam_team_avg_pop(at.paper_id,td.division)))
        ORDER BY td.division)
      FROM(
        SELECT lt.team_id,lt.name,lt.division,cap.great_region captain_region,cap.pastoral_zone captain_zone,
          ROUND(COALESCE(SUM(a.total_score)FILTER(WHERE a.status='graded'),0)::numeric/lt.division,1)avg_total
        FROM latest_team lt
        LEFT JOIN public.profiles cap ON cap.id=lt.captain_id
        JOIN public.reading_team_members mm ON mm.team_id=lt.team_id
        LEFT JOIN public.exam_attempts a
          ON a.user_id=mm.user_id AND a.paper_id=at.paper_id
         AND a.attempt_kind='official' AND a.status IN('submitted','graded')
        WHERE EXISTS(SELECT 1 FROM public.reading_team_members me
          WHERE me.team_id=lt.team_id AND me.user_id=actor_id)
        GROUP BY lt.team_id,lt.name,lt.division,cap.great_region,cap.pastoral_zone
      )td
    ),'[]'::jsonb) ELSE NULL END,
    'answers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'questionId',q.id,'section',q.section,'position',q.position,'points',q.points,
      'sectionRank',public._exam_section_rank(q.section),'response',ea.response,
      'autoCorrect',CASE WHEN show_full THEN ea.auto_correct ELSE NULL END,
      'awardedPoints',CASE WHEN show_full THEN ea.awarded_points ELSE NULL END,
      'graderComment',CASE WHEN show_full AND at.attempt_kind='official' THEN ea.grader_comment ELSE NULL END,
      'payload',CASE WHEN show_full
        THEN public._exam_member_answer_payload(q.section,q.payload,pr.show_answer_explanation)
        ELSE public._exam_public_payload(q.section,q.payload,q.points)END,
      'answerKey',CASE WHEN show_full AND q.section<>'shortanswer'THEN q.answer_key ELSE NULL END)
      ORDER BY public._exam_section_rank(q.section),q.position)
      FROM public.exam_questions q LEFT JOIN public.exam_answers ea
        ON ea.question_id=q.id AND ea.attempt_id=at.id
      WHERE q.paper_id=at.paper_id),'[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.exam_get_my_result(UUID,UUID,UUID)
IS '回傳本人完整試卷結果；成績公布前只顯示本人作答，公布後才顯示正解與評分。簡答題的 referenceAnswer／rubric 一律不外流；所有題型的 answerExplanation 只有 show_answer_explanation 開著時才附上。timeSeconds 送出後即可見，不受批改/公布影響。accuracyRate/accuracyCorrect/accuracyTotal（自動計分題答對比例）跟 answers[].autoCorrect 用同一個 show_full 閘門。PR（prChurch、prZone、teams[].pr）只有正式卷+已批改+已公布才計算，管理員預覽不給，且不含任何隊友分數；teams[] 帶隊長的大區/牧區；prZone/zoneAvg 是本人所屬牧區的 PR 與平均分數，本人沒設定牧區時一律 NULL。';

-- ── exam_get_stats：overall 加 eligibleCount + participationRate ──
CREATE OR REPLACE FUNCTION public.exam_get_stats(
  p_paper_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_require_first_round BOOLEAN DEFAULT FALSE,
  p_reading_book TEXT DEFAULT NULL,
  p_book_chapters INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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
    'paper',jsonb_build_object('id',pr.id,'title',pr.title,'status',pr.status,'mode',pr.mode,'totalPoints',pr.total_points,'linkedPlanId',pr.linked_plan_id),
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

COMMENT ON FUNCTION public.exam_get_stats(UUID,UUID,BOOLEAN,TEXT,INTEGER)
IS '大測驗後台統計：整體／各大區／各牧區／各小組／逐題正確率／團隊排行／作答名單。overall.eligibleCount／participationRate 是新增的參與率（應考人數＝範圍內 is_active 會友，有綁定計畫的卷只算有登記該計畫的人）。roster[].timeSeconds 是每個人的作答花費秒數，跟批改/公布無關一律顯示。範圍主管（great_zone_leader／zone_leader／group_leader）只看得到自己管轄範圍內的資料，PR 值在成績公布前也不給（admin/pastor 例外）。';
