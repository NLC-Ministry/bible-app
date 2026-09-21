-- 0194_exam_my_result_zone_pr.sql
--
-- 會友自己的大測驗結果加上「牧區」這一欄的 PR 值與平均分數，跟現有的
-- prChurch（全教會）、teams[].pr/avg（隊伍）算法一致：population 用同一份
-- _exam_pr()（母體 < 5 一律回 NULL），只是母體改成「跟我同一個牧區、這份
-- 考卷正式卷已批改」的分數陣列。使用者自己沒有設定牧區時，prZone/zoneAvg
-- 一律回 NULL（沒有母體可比）。
--
-- 純 CREATE OR REPLACE，函式簽名不變（沿用 0122 就設好的
-- REVOKE ALL ... FROM PUBLIC，這裡不用重下）。
-- 部署：Supabase SQL editor 執行，或 supabase db push。

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
  RETURN jsonb_build_object(
    'state',CASE WHEN at.status='in_progress'THEN'in_progress' WHEN show_full THEN'graded' ELSE'submitted' END,
    'attemptId',at.id,'attemptKind',at.attempt_kind,'countsTowardScore',at.attempt_kind='official',
    'resultsPublished',published,'staffPreview',(show_full AND NOT published AND is_staff),
    'reviewVisibility',CASE WHEN show_full THEN'full_review' ELSE'responses_only' END,
    'autoScore',CASE WHEN show_full THEN at.auto_score ELSE NULL END,
    'manualScore',CASE WHEN show_full THEN at.manual_score ELSE NULL END,
    'totalScore',CASE WHEN show_full THEN at.total_score ELSE NULL END,
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

GRANT EXECUTE ON FUNCTION public.exam_get_my_result(UUID,UUID,UUID) TO authenticated;

COMMENT ON FUNCTION public.exam_get_my_result(UUID,UUID,UUID)
IS '回傳本人完整試卷結果；成績公布前只顯示本人作答，公布後才顯示正解與評分。簡答題的 referenceAnswer／rubric 一律不外流；所有題型的 answerExplanation 只有 show_answer_explanation 開著時才附上。PR（prChurch、prZone、teams[].pr）只有正式卷+已批改+已公布才計算，管理員預覽不給，且不含任何隊友分數；teams[] 帶隊長的大區/牧區；prZone/zoneAvg 是本人所屬牧區的 PR 與平均分數，本人沒設定牧區時一律 NULL。';
