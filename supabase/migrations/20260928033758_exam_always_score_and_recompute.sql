-- ============================================================================
-- 20260928033758_exam_always_score_and_recompute.sql  —  #299（大測驗 R2，屬於 #297）
--
-- 1. 拿掉「自動評分」開關：收卷一律自動計分（_exam_close_paper、_exam_sweep_expired
--    不再讀 auto_score_enabled）。還沒填正解的題目該題先算 0 分，之後補上正解會自動重算。
-- 2. ④ 批改中（status='closed' 且成績還沒公布）修正正解 → exam_set_answer_key 在同一個
--    交易裡把這份卷所有已送出的作答重新計分，不用再按「重新計分」。
-- 3. 公布成績前檢查，還差什麼就直接說：
--      exam_answer_keys_incomplete: 是非題第 3 題、單選題第 5 題
--      exam_grading_incomplete: 還有 N 份作答的簡答題沒批改完
--    （原本的 exam_results_incomplete 保留，擋作答中／其他未結算的作答）
--
-- auto_score_enabled 欄位、exam_set_auto_score 函式留到 #303 才刪；exam_set_auto_score
-- 從 nlc-data allowlist 拿掉（上線時要重新部署 nlc-data）。exam_recompute_scores 保留。
-- ============================================================================

-- ── 1. 收卷一律計分 ──
CREATE OR REPLACE FUNCTION public._exam_close_paper(p_paper_id uuid, p_reason text, p_closed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  pr public.exam_papers%ROWTYPE;
  a RECORD;
  keys_ok BOOLEAN;
  n_finalized INTEGER := 0;
  n_scored INTEGER := 0;
BEGIN
  IF p_reason NOT IN ('manual', 'scheduled') THEN RAISE EXCEPTION 'exam_close_reason_invalid'; END IF;
  UPDATE public.exam_papers SET
    status='closed', closed_at=COALESCE(closed_at,NOW()),
    closed_by=CASE WHEN p_reason='manual' THEN p_closed_by ELSE NULL END,
    close_reason=COALESCE(close_reason,p_reason)
  WHERE id=p_paper_id AND status='published' RETURNING * INTO pr;
  IF NOT FOUND THEN
    SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
    RETURN jsonb_build_object('paperId',pr.id,'status',pr.status,'alreadyClosed',pr.status='closed',
      'finalized',0,'scored',0,'practiceCloseAt',public._exam_practice_close_at(pr.id));
  END IF;

  -- 只收正式作答；重作練習維持 in_progress，直到獨立期限屆滿。
  FOR a IN SELECT id FROM public.exam_attempts
    WHERE paper_id=pr.id AND attempt_kind='official' AND status='in_progress'
    FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO public.exam_answers(attempt_id,question_id,section,response,auto_correct,awarded_points)
    SELECT a.id,q.id,q.section,NULL,NULL,NULL FROM public.exam_questions q WHERE q.paper_id=pr.id
    ON CONFLICT(attempt_id,question_id) DO NOTHING;
    UPDATE public.exam_attempts SET status='submitted',submitted_at=COALESCE(submitted_at,NOW()),
      submit_reason='auto_close',auto_score=NULL,manual_score=NULL,total_score=NULL
    WHERE id=a.id AND status='in_progress';
    n_finalized:=n_finalized+1;
  END LOOP;

  -- 一律計分（#299）：還沒填正解的題目先算 0 分，補上正解時 exam_set_answer_key 會自動重算。
  keys_ok:=public._exam_keys_complete(pr.id);
  FOR a IN SELECT id FROM public.exam_attempts
    WHERE paper_id=pr.id AND attempt_kind='official' AND status IN('submitted','graded') LOOP
    PERFORM public._exam_score_attempt(a.id);
    n_scored:=n_scored+1;
  END LOOP;
  RETURN jsonb_build_object('paperId',pr.id,'status','closed','alreadyClosed',FALSE,
    'finalized',n_finalized,'scored',n_scored,'autoScoreEnabled',TRUE,
    'answerKeysComplete',keys_ok,'practiceCloseAt',public._exam_practice_close_at(pr.id));
END;
$$;
REVOKE ALL ON FUNCTION public._exam_close_paper(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_close_paper(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._exam_sweep_expired(p_paper_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  has_short BOOLEAN;
  a         RECORD;
  q         RECORD;
  resp      JSONB;
  ok        BOOLEAN;
  pts       NUMERIC;
  auto_sum  NUMERIC;
  n_done    INTEGER := 0;
BEGIN
  IF p_paper_id IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_papers WHERE id = p_paper_id) THEN RETURN 0; END IF;

  SELECT EXISTS (SELECT 1 FROM public.exam_questions
                 WHERE paper_id = p_paper_id AND section = 'shortanswer')
    INTO has_short;

  FOR a IN
    SELECT id FROM public.exam_attempts
    WHERE paper_id = p_paper_id
      AND status = 'in_progress'
      AND NOW() > deadline_at + INTERVAL '120 seconds'
    FOR UPDATE SKIP LOCKED
  LOOP
    auto_sum := 0;

    FOR q IN SELECT id, section, points, answer_key FROM public.exam_questions
             WHERE paper_id = p_paper_id LOOP
      resp := (SELECT response FROM public.exam_answers
               WHERE attempt_id = a.id AND question_id = q.id);

      IF q.section = 'shortanswer' THEN
        INSERT INTO public.exam_answers (attempt_id, question_id, section, response, auto_correct, awarded_points)
        VALUES (a.id, q.id, q.section, resp, NULL, NULL)
        ON CONFLICT (attempt_id, question_id)
          DO UPDATE SET response = EXCLUDED.response, updated_at = NOW();
      ELSE
        -- 一律計分（#299）
        ok  := public._exam_answer_is_correct(q.section, q.answer_key, resp);
        pts := CASE WHEN ok THEN q.points ELSE 0 END;
        auto_sum := auto_sum + pts;
        INSERT INTO public.exam_answers (attempt_id, question_id, section, response, auto_correct, awarded_points)
        VALUES (a.id, q.id, q.section, resp, ok, pts)
        ON CONFLICT (attempt_id, question_id)
          DO UPDATE SET response = EXCLUDED.response, auto_correct = EXCLUDED.auto_correct,
                        awarded_points = EXCLUDED.awarded_points, updated_at = NOW();
      END IF;
    END LOOP;

    UPDATE public.exam_attempts SET
      status       = CASE WHEN NOT has_short THEN 'graded' ELSE 'submitted' END,
      submitted_at = COALESCE(submitted_at, NOW()),
      submit_reason = 'auto_close',
      auto_score   = auto_sum,
      manual_score = CASE WHEN NOT has_short THEN 0 ELSE NULL END,
      total_score  = CASE WHEN NOT has_short THEN auto_sum ELSE NULL END
    WHERE id = a.id AND status = 'in_progress';

    n_done := n_done + 1;
  END LOOP;

  RETURN n_done;
END;
$$;
REVOKE ALL ON FUNCTION public._exam_sweep_expired(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_sweep_expired(uuid) TO service_role;

-- ── 2. 批改中修正正解 → 自動重新計分 ──
CREATE OR REPLACE FUNCTION public.exam_set_answer_key(p_question_id uuid, p_answer_key jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  q        public.exam_questions%ROWTYPE;
  pr       public.exam_papers%ROWTYPE;
  a        RECORD;
  n        INTEGER := 0;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO q FROM public.exam_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_question_not_found'; END IF;
  IF q.section = 'shortanswer' THEN RAISE EXCEPTION 'exam_answer_not_gradable'; END IF;
  -- 鎖住試卷列：公布成績跟改正解不會同時發生
  SELECT * INTO pr FROM public.exam_papers WHERE id = q.paper_id FOR UPDATE;
  IF pr.results_published_at IS NOT NULL THEN RAISE EXCEPTION 'exam_results_locked'; END IF;

  UPDATE public.exam_questions SET answer_key = p_answer_key, updated_at = NOW() WHERE id = p_question_id;

  -- 批改中：這份卷所有已送出的作答（正式＋複習）依新正解重算。作答中還沒收卷，收卷時才計分。
  IF pr.status = 'closed' THEN
    FOR a IN SELECT id FROM public.exam_attempts
             WHERE paper_id = pr.id AND status IN ('submitted', 'graded') LOOP
      PERFORM public._exam_score_attempt(a.id);
      n := n + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('questionId', p_question_id, 'section', q.section, 'recomputed', n);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_set_answer_key(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_set_answer_key(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 3. 公布成績前檢查：正解完整、簡答批改完 ──
CREATE OR REPLACE FUNCTION public.exam_publish_results(p_paper_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id); pr public.exam_papers%ROWTYPE;
  n_unfinished INTEGER;n_notified INTEGER;missing_keys TEXT;n_ungraded INTEGER;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN('admin','pastor') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status<>'closed' THEN RAISE EXCEPTION 'exam_results_before_close'; END IF;
  IF pr.results_published_at IS NOT NULL THEN RETURN jsonb_build_object('paperId',pr.id,
    'resultsPublishedAt',pr.results_published_at,'alreadyPublished',TRUE); END IF;

  -- 還沒填正解的題目（簡答題除外），直接列出是哪幾題
  SELECT string_agg(
      CASE q.section WHEN 'truefalse' THEN '是非題' WHEN 'single' THEN '單選題' WHEN 'multiple' THEN '複選題'
                     WHEN 'matching' THEN '連連看' WHEN 'ordering' THEN '事件排序題' ELSE q.section END
      || '第 ' || q.position || ' 題', '、'
      ORDER BY array_position(ARRAY['truefalse','single','multiple','matching','ordering'], q.section), q.position)
    INTO missing_keys
  FROM public.exam_questions q
  WHERE q.paper_id=pr.id AND q.section<>'shortanswer' AND q.answer_key IS NULL;
  IF missing_keys IS NOT NULL THEN RAISE EXCEPTION 'exam_answer_keys_incomplete: %', missing_keys; END IF;

  -- 收卷時已一律計分，所以還停在「已送出」的正式作答＝簡答題還沒批改完
  SELECT COUNT(*) INTO n_ungraded FROM public.exam_attempts a
  WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='submitted'
    AND EXISTS (SELECT 1 FROM public.exam_questions q WHERE q.paper_id=pr.id AND q.section='shortanswer');
  IF n_ungraded>0 THEN RAISE EXCEPTION 'exam_grading_incomplete: 還有 % 份作答的簡答題沒批改完', n_ungraded; END IF;

  SELECT COUNT(*) INTO n_unfinished FROM public.exam_attempts
  WHERE paper_id=pr.id AND attempt_kind='official' AND status<>'graded';
  IF n_unfinished>0 THEN RAISE EXCEPTION 'exam_results_incomplete: % 筆正式作答尚未結算',n_unfinished; END IF;

  UPDATE public.exam_papers SET results_published_at=NOW() WHERE id=pr.id;
  INSERT INTO public.exam_notifications(attempt_id,recipient_id,kind)
  SELECT a.id,a.user_id,'graded' FROM public.exam_attempts a
  WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND a.status='graded'
  ON CONFLICT(attempt_id,recipient_id,kind) DO NOTHING;
  GET DIAGNOSTICS n_notified=ROW_COUNT;
  RETURN jsonb_build_object('paperId',pr.id,'resultsPublishedAt',NOW(),'notified',n_notified);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_publish_results(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_publish_results(uuid, uuid) TO authenticated, service_role;

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
