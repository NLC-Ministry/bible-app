-- ============================================================================
-- 20261019033742_daily_quiz_answer_correction.sql  —  #590
--
-- 小測驗發佈後可以更正某一題的正解（和解說），所有作答自動重算：
--   1. set_daily_quiz_answer_key（只給系統管理員）：找出這一天發佈出去的那份題目，
--      只改指定那一題的正解／解說，題目與選項文字不能改。同一個交易裡把每個小組的
--      作答逐題重新判對錯，已送出的重算分數。統計、排名、PR 都是即時讀分數，會跟著變。
--      題目記上 answerCorrected（更正時間、原本的正解）：後台隱藏 AI 舉證（舉證是證明
--      舊答案的），會友回顧時標「此題答案已更正」。不發通知。
--   2. lock_approved_daily_quiz_content：已核准的題目原本一律不能改，現在只放行
--      set_daily_quiz_answer_key 在同一個交易裡設的旗標，而且只能改 questions。
--   3. quiz_questions_for_member：附答案時多帶 answerCorrected。
--
-- 只支援是非／單選／多選（含沒有 type 的 AI 題目）；配對、排序不在範圍內。
-- 部署：先推這支 migration，再部署 nlc-data（allowlist 加了這支 RPC）。
-- ============================================================================

-- ── 2. 鎖定 trigger：只放行更正答案 ──
CREATE OR REPLACE FUNCTION public.lock_approved_daily_quiz_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $lock_approved_daily_quiz_content$
BEGIN
  IF OLD.review_status = 'approved' AND (
    NEW.review_status IS DISTINCT FROM OLD.review_status
    OR NEW.chapter_refs IS DISTINCT FROM OLD.chapter_refs
    OR NEW.generation_status IS DISTINCT FROM OLD.generation_status
    OR NEW.generation_model IS DISTINCT FROM OLD.generation_model
    -- #590：set_daily_quiz_answer_key 在交易內設 app.quiz_answer_correction，只有它能改 questions
    OR (NEW.questions IS DISTINCT FROM OLD.questions
        AND COALESCE(current_setting('app.quiz_answer_correction', TRUE), '') <> 'on')
  ) THEN
    RAISE EXCEPTION 'quiz_approval_locked';
  END IF;
  RETURN NEW;
END;
$lock_approved_daily_quiz_content$;
REVOKE ALL ON FUNCTION public.lock_approved_daily_quiz_content() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_approved_daily_quiz_content() TO service_role;

-- ── 3. 會友端題目：附答案時帶 answerCorrected ──
CREATE OR REPLACE FUNCTION public.quiz_questions_for_member(
  p_questions JSONB,
  p_include_answers BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $quiz_questions_for_member$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN question ? 'type' THEN
      jsonb_build_object(
        'id', question->>'id',
        'type', question->>'type',
        'payload', question->'payload',
        'verseRef', question->>'verseRef'
      ) || CASE WHEN p_include_answers THEN jsonb_build_object(
        'answerKey', question->'answerKey',
        'explanation', question->>'explanation',
        'answerCorrected', question ? 'answerCorrected'
      ) ELSE '{}'::JSONB END
    ELSE
      jsonb_build_object(
        'id', question->>'id',
        'question', question->>'question',
        'options', question->'options',
        'verseRef', question->>'verseRef'
      ) || CASE WHEN p_include_answers THEN jsonb_build_object(
        'correctIndex', (question->>'correctIndex')::INTEGER,
        'explanation', question->>'explanation',
        'answerCorrected', question ? 'answerCorrected'
      ) ELSE '{}'::JSONB END
    END
    ORDER BY ordinal
  ), '[]'::JSONB)
  FROM jsonb_array_elements(COALESCE(p_questions, '[]'::JSONB)) WITH ORDINALITY AS item(question, ordinal);
$quiz_questions_for_member$;
REVOKE ALL ON FUNCTION public.quiz_questions_for_member(JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_questions_for_member(JSONB, BOOLEAN) TO authenticated, service_role;

-- ── 1. 更正答案＋重算 ──
CREATE OR REPLACE FUNCTION public.set_daily_quiz_answer_key(
  p_global_plan_id UUID,
  p_quiz_date DATE,
  p_question_id TEXT,
  p_answer_key JSONB,
  p_explanation TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $set_daily_quiz_answer_key$
DECLARE
  actor_id UUID := public._daily_quiz_require_admin(p_actor_id);
  quiz_ids UUID[];
  quiz_row public.daily_quizzes%ROWTYPE;
  question JSONB;
  question_pos INTEGER;
  question_type TEXT;
  legacy BOOLEAN;
  option_count INTEGER;
  old_key JSONB;
  new_question JSONB;
  key_changed BOOLEAN;
  explanation_changed BOOLEAN;
  attempts_updated INTEGER := 0;
  scores_changed INTEGER := 0;
BEGIN
  -- 這一天發出去的是哪一份題目（#306 之後一天只發一份；舊資料若有兩份就不猜）
  SELECT array_agg(DISTINCT pub.quiz_id) INTO quiz_ids
  FROM public.quiz_publications pub
  WHERE pub.global_plan_id = p_global_plan_id AND pub.quiz_date = p_quiz_date;
  IF quiz_ids IS NULL THEN RAISE EXCEPTION 'quiz_not_published'; END IF;
  IF array_length(quiz_ids, 1) > 1 THEN RAISE EXCEPTION 'quiz_multiple_versions'; END IF;

  SELECT * INTO quiz_row FROM public.daily_quizzes WHERE id = quiz_ids[1] FOR UPDATE;
  IF quiz_row.id IS NULL THEN RAISE EXCEPTION 'quiz_not_published'; END IF;

  SELECT q, (ordinal - 1)::INTEGER INTO question, question_pos
  FROM jsonb_array_elements(quiz_row.questions) WITH ORDINALITY AS item(q, ordinal)
  WHERE COALESCE(q->>'id', '') = p_question_id;
  IF question IS NULL THEN RAISE EXCEPTION 'quiz_question_not_found'; END IF;

  legacy := NOT (question ? 'type');
  question_type := COALESCE(question->>'type', 'single');
  option_count := jsonb_array_length(COALESCE(CASE WHEN legacy THEN question->'options' ELSE question->'payload'->'options' END, '[]'::JSONB));

  -- 新正解的形狀要對得上題型（跟作答 response 同一套：是非 boolean、單選索引、多選索引陣列）
  IF p_answer_key IS NULL THEN RAISE EXCEPTION 'invalid_quiz_answer_key'; END IF;
  IF question_type = 'truefalse' THEN
    IF jsonb_typeof(p_answer_key) <> 'boolean' THEN RAISE EXCEPTION 'invalid_quiz_answer_key'; END IF;
  ELSIF question_type = 'single' THEN
    IF jsonb_typeof(p_answer_key) <> 'number' OR p_answer_key::TEXT !~ '^\d+$'
       OR p_answer_key::TEXT::INTEGER >= option_count THEN
      RAISE EXCEPTION 'invalid_quiz_answer_key';
    END IF;
  ELSIF question_type = 'multiple' THEN
    IF jsonb_typeof(p_answer_key) <> 'array' OR jsonb_array_length(p_answer_key) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answer_key) e
                  WHERE jsonb_typeof(e) <> 'number' OR e::TEXT !~ '^\d+$' OR e::TEXT::INTEGER >= option_count)
       OR (SELECT COUNT(DISTINCT e::TEXT) FROM jsonb_array_elements(p_answer_key) e) <> jsonb_array_length(p_answer_key) THEN
      RAISE EXCEPTION 'invalid_quiz_answer_key';
    END IF;
    -- 存成排序過的陣列，比對時與順序無關
    SELECT jsonb_agg(e ORDER BY e::TEXT::INTEGER) INTO p_answer_key FROM jsonb_array_elements(p_answer_key) e;
  ELSE
    RAISE EXCEPTION 'quiz_answer_type_not_supported';
  END IF;

  old_key := CASE WHEN legacy THEN question->'correctIndex' ELSE question->'answerKey' END;
  key_changed := NOT public._quiz_answer_is_correct(question_type, old_key, p_answer_key);
  explanation_changed := p_explanation IS NOT NULL AND BTRIM(p_explanation) IS DISTINCT FROM COALESCE(question->>'explanation', '');
  IF NOT key_changed AND NOT explanation_changed THEN
    RETURN jsonb_build_object('quizDate', p_quiz_date, 'questionId', p_question_id, 'changed', FALSE,
                              'attemptsUpdated', 0, 'scoresChanged', 0);
  END IF;

  new_question := question;
  IF key_changed THEN
    new_question := new_question
      || CASE WHEN legacy THEN jsonb_build_object('correctIndex', p_answer_key)
              ELSE jsonb_build_object('answerKey', p_answer_key) END
      -- 保留最早的原始正解：連續更正兩次時，記錄仍看得出 AI 一開始給的是什麼
      || jsonb_build_object('answerCorrected', jsonb_build_object(
           'at', NOW(), 'by', actor_id,
           'originalAnswer', COALESCE(question->'answerCorrected'->'originalAnswer', old_key)));
  END IF;
  IF explanation_changed THEN
    new_question := new_question || jsonb_build_object('explanation', BTRIM(p_explanation));
  END IF;

  PERFORM set_config('app.quiz_answer_correction', 'on', TRUE);
  UPDATE public.daily_quizzes
  SET questions = jsonb_set(questions, ARRAY[question_pos::TEXT], new_question),
      updated_by = actor_id
  WHERE id = quiz_row.id;
  PERFORM set_config('app.quiz_answer_correction', 'off', TRUE);

  IF key_changed THEN
    -- 逐題送出的作答：[{questionId, response, correct, timeSpentSeconds}, …]，重判這一題
    WITH target AS (
      SELECT a.id, a.score AS old_score,
        (SELECT jsonb_agg(CASE WHEN entry->>'questionId' = p_question_id
                  THEN entry || jsonb_build_object('correct',
                         public._quiz_answer_is_correct(question_type, p_answer_key, entry->'response'))
                  ELSE entry END ORDER BY ord)
         FROM jsonb_array_elements(a.answers) WITH ORDINALITY AS x(entry, ord)) AS answers
      FROM public.quiz_attempts a
      JOIN public.quiz_publications pub ON pub.id = a.publication_id
      WHERE pub.quiz_id = quiz_row.id
        AND jsonb_typeof(a.answers) = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.answers) e
                    WHERE jsonb_typeof(e) = 'object' AND e->>'questionId' = p_question_id)
    ), rescored AS (
      UPDATE public.quiz_attempts a
      SET answers = target.answers,
          score = CASE WHEN a.status = 'submitted'
            THEN (SELECT COUNT(*) FROM jsonb_array_elements(target.answers) e WHERE (e->>'correct')::BOOLEAN IS TRUE)
            ELSE a.score END
      FROM target
      WHERE a.id = target.id
      RETURNING a.id, a.score, target.old_score
    )
    SELECT COUNT(*), COUNT(*) FILTER (WHERE score IS DISTINCT FROM old_score)
    INTO attempts_updated, scores_changed FROM rescored;

    -- 舊格式（submit_daily_quiz 一次送出）：answers 是對齊題目順序的選項索引，只會有 AI 單選題
    IF legacy THEN
      WITH target AS (
        SELECT a.id,
          CASE WHEN (a.answers->>question_pos) ~ '^\d+$' AND (a.answers->>question_pos)::INTEGER = p_answer_key::TEXT::INTEGER
            THEN 1 ELSE 0 END
          - CASE WHEN (a.answers->>question_pos) ~ '^\d+$' AND old_key IS NOT NULL
                      AND (a.answers->>question_pos)::INTEGER = old_key::TEXT::INTEGER
            THEN 1 ELSE 0 END AS delta
        FROM public.quiz_attempts a
        JOIN public.quiz_publications pub ON pub.id = a.publication_id
        WHERE pub.quiz_id = quiz_row.id
          AND a.status = 'submitted'
          AND jsonb_typeof(a.answers) = 'array'
          AND jsonb_typeof(a.answers->0) IN ('number', 'string')
      ), rescored AS (
        UPDATE public.quiz_attempts a
        SET score = a.score + target.delta
        FROM target
        WHERE a.id = target.id
        RETURNING target.delta
      )
      SELECT attempts_updated + COUNT(*), scores_changed + COUNT(*) FILTER (WHERE delta <> 0)
      INTO attempts_updated, scores_changed FROM rescored;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'quizDate', p_quiz_date,
    'questionId', p_question_id,
    'changed', TRUE,
    'previousAnswer', old_key,
    'answerKey', CASE WHEN key_changed THEN p_answer_key ELSE old_key END,
    'attemptsUpdated', attempts_updated,
    'scoresChanged', scores_changed
  );
END;
$set_daily_quiz_answer_key$;
REVOKE ALL ON FUNCTION public.set_daily_quiz_answer_key(UUID, DATE, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_quiz_answer_key(UUID, DATE, TEXT, JSONB, TEXT, UUID) TO authenticated, service_role;
