-- ============================================================================
-- 20261027024057_lightning_quiz_answer_correction.sql  —  #616 雲柱測驗更正正解
--
-- 題目開始後整題鎖定（_lightning_quiz_is_locked），正解設錯也改不了。這裡照小測驗
-- #590（set_daily_quiz_answer_key）的做法，開一個只改正解與詳解的口：
--   1. admin_set_lightning_quiz_answer_key：只給系統管理員、只用在已排程（published）的
--      題目（草稿照原本的編輯）。題型、題目、選項、時間照樣鎖定。新正解先依題型與 payload
--      檢查形狀（_lightning_quiz_normalize_answer_key），同一個交易把已送出的作答重新判
--      對錯；作答秒數不動，還沒送出的之後送出時自然用新正解。只改詳解不重判。
--      題目記下更正時間、更正者、最早的原始正解（連續更正兩次仍保留最初那個）。
--      回傳這題所在的週前三名是否公布過：已公布的名單（entries）與兌換券是固定紀錄，
--      這裡不動，由管理員決定要不要重新公布（維護者 2026-10-27）。不發通知。
--   2. submit_lightning_quiz_attempt：讀題目改成 FOR SHARE，跟更正同時發生時等更正
--      交易結束、讀到新正解，不會用舊正解判分又躲過重判。其餘照 0211 原樣。
--   3. get_my_lightning_quiz_history 多回 answerCorrected（只給 true/false，不給原始正解）；
--      admin_list_lightning_quiz_questions 多回 answerCorrectedAt、originalAnswerKey。
--
-- 部署：先推這支 migration，再部署 nlc-data（白名單與稽核清單加了新 RPC）。
-- 全部是新增或多回欄位，舊版前端不受影響，不需要 forceUpdateBuiltBefore。
-- ============================================================================

-- ── 1. 更正紀錄欄位 ──────────────────────────────────────────────────────────
ALTER TABLE public.lightning_quiz_questions
  ADD COLUMN IF NOT EXISTS answer_corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answer_corrected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_answer_key JSONB;

-- ── 2. 新正解的形狀檢查（不合就 lightning_quiz_invalid_answer_key）──────────────
-- 回傳存檔用的形狀：多選排序過、選單去掉數量 0 的項目，其餘原樣。
--   truefalse  boolean
--   single     選項索引
--   multiple   不重複的選項索引陣列（至少一個）
--   matching   { leftId: rightId }，每個左邊剛好一條；右邊比左邊少（多對一，#588）才可以重複連
--   ordering   item id 陣列，剛好是全部項目各一次
--   menu       { itemId: 0～20 的整數 }，至少一個數量 > 0（上限同 MENU_MAX_QUANTITY）
CREATE OR REPLACE FUNCTION public._lightning_quiz_normalize_answer_key(
  p_question_type TEXT,
  p_payload       JSONB,
  p_answer_key    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $$
DECLARE
  option_count INT;
  left_ids     TEXT[];
  right_ids    TEXT[];
  item_ids     TEXT[];
  normalized   JSONB;
BEGIN
  IF p_answer_key IS NULL OR p_payload IS NULL THEN
    RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
  END IF;

  IF p_question_type = 'truefalse' THEN
    IF jsonb_typeof(p_answer_key) <> 'boolean' THEN RAISE EXCEPTION 'lightning_quiz_invalid_answer_key'; END IF;
    RETURN p_answer_key;
  END IF;

  IF p_question_type IN ('single', 'multiple') THEN
    option_count := CASE WHEN jsonb_typeof(p_payload->'options') = 'array' THEN jsonb_array_length(p_payload->'options') ELSE 0 END;
    IF p_question_type = 'single' THEN
      IF jsonb_typeof(p_answer_key) <> 'number' OR p_answer_key::TEXT !~ '^\d+$'
         OR p_answer_key::TEXT::NUMERIC >= option_count THEN
        RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
      END IF;
      RETURN p_answer_key;
    END IF;
    IF jsonb_typeof(p_answer_key) <> 'array' OR jsonb_array_length(p_answer_key) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answer_key) e
                  WHERE jsonb_typeof(e) <> 'number' OR e::TEXT !~ '^\d+$' OR e::TEXT::NUMERIC >= option_count)
       OR (SELECT COUNT(DISTINCT e::TEXT) FROM jsonb_array_elements(p_answer_key) e) <> jsonb_array_length(p_answer_key) THEN
      RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
    END IF;
    SELECT jsonb_agg(e ORDER BY e::TEXT::NUMERIC) INTO normalized FROM jsonb_array_elements(p_answer_key) e;
    RETURN normalized;
  END IF;

  IF p_question_type = 'matching' THEN
    SELECT array_agg(i->>'id') INTO left_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'left') = 'array' THEN p_payload->'left' ELSE '[]'::jsonb END) i;
    SELECT array_agg(i->>'id') INTO right_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'right') = 'array' THEN p_payload->'right' ELSE '[]'::jsonb END) i;
    IF jsonb_typeof(p_answer_key) <> 'object' OR left_ids IS NULL OR right_ids IS NULL
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_answer_key) k)
          IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(left_ids) x)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_answer_key)
                  WHERE jsonb_typeof(value) <> 'string' OR NOT ((value #>> '{}') = ANY (right_ids)))
       OR (cardinality(right_ids) >= cardinality(left_ids)
           AND (SELECT COUNT(DISTINCT value #>> '{}') FROM jsonb_each(p_answer_key)) <> cardinality(left_ids)) THEN
      RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
    END IF;
    RETURN p_answer_key;
  END IF;

  IF p_question_type IN ('ordering', 'menu') THEN
    SELECT array_agg(i->>'id') INTO item_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'items') = 'array' THEN p_payload->'items' ELSE '[]'::jsonb END) i;
    IF item_ids IS NULL THEN RAISE EXCEPTION 'lightning_quiz_invalid_answer_key'; END IF;

    IF p_question_type = 'ordering' THEN
      IF jsonb_typeof(p_answer_key) <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answer_key) e WHERE jsonb_typeof(e) <> 'string')
         OR (SELECT array_agg(e #>> '{}' ORDER BY e #>> '{}') FROM jsonb_array_elements(p_answer_key) e)
            IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(item_ids) x) THEN
        RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
      END IF;
      RETURN p_answer_key;
    END IF;

    IF jsonb_typeof(p_answer_key) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_each(p_answer_key)
                  WHERE NOT (key = ANY (item_ids)) OR jsonb_typeof(value) <> 'number'
                     OR value::TEXT !~ '^\d+$' OR value::TEXT::NUMERIC > 20) THEN
      RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
    END IF;
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO normalized
    FROM jsonb_each(p_answer_key) WHERE value::TEXT::NUMERIC > 0;
    IF normalized = '{}'::jsonb THEN RAISE EXCEPTION 'lightning_quiz_invalid_answer_key'; END IF;
    RETURN normalized;
  END IF;

  RAISE EXCEPTION 'lightning_quiz_invalid_answer_key';
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_normalize_answer_key(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_normalize_answer_key(text, jsonb, jsonb) TO service_role;

-- ── 3. 更正正解／詳解＋重判 ──────────────────────────────────────────────────
-- p_explanation：NULL＝不動原本的詳解（同 admin_upsert_lightning_quiz_question）。
CREATE OR REPLACE FUNCTION public.admin_set_lightning_quiz_answer_key(
  p_question_id UUID,
  p_answer_key  JSONB,
  p_explanation TEXT DEFAULT NULL,
  p_actor_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id            UUID := public.resolve_quiz_actor(p_actor_id);
  q                   public.lightning_quiz_questions%ROWTYPE;
  new_key             JSONB;
  new_explanation     TEXT;
  key_changed         BOOLEAN;
  explanation_changed BOOLEAN;
  v_week              DATE;
  v_rescored          INT := 0;
  v_became_correct    INT := 0;
  v_became_wrong      INT := 0;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;
  IF q.status <> 'published' THEN RAISE EXCEPTION 'lightning_quiz_correction_not_published'; END IF;

  new_key := public._lightning_quiz_normalize_answer_key(q.question_type, q.payload, p_answer_key);
  key_changed := NOT public._lightning_quiz_answer_is_correct(q.question_type, q.answer_key, new_key);
  new_explanation := COALESCE(BTRIM(p_explanation), q.explanation);
  explanation_changed := new_explanation IS DISTINCT FROM q.explanation;
  v_week := date_trunc('week', q.rise_date)::DATE;

  IF key_changed OR explanation_changed THEN
    UPDATE public.lightning_quiz_questions SET
      answer_key = CASE WHEN key_changed THEN new_key ELSE answer_key END,
      explanation = new_explanation,
      original_answer_key = CASE WHEN key_changed THEN COALESCE(original_answer_key, q.answer_key) ELSE original_answer_key END,
      answer_corrected_at = CASE WHEN key_changed THEN NOW() ELSE answer_corrected_at END,
      answer_corrected_by = CASE WHEN key_changed THEN actor_id ELSE answer_corrected_by END,
      updated_at = NOW()
    WHERE id = q.id;
  END IF;

  IF key_changed THEN
    WITH before AS (
      SELECT id, COALESCE(is_correct, FALSE) AS was_correct
      FROM public.lightning_quiz_attempts
      WHERE question_id = q.id AND completed_at IS NOT NULL
      FOR UPDATE
    ), rescored AS (
      UPDATE public.lightning_quiz_attempts a
      SET is_correct = public._lightning_quiz_answer_is_correct(q.question_type, new_key, a.response)
      FROM before
      WHERE a.id = before.id
      RETURNING a.is_correct, before.was_correct
    )
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE is_correct AND NOT was_correct),
           COUNT(*) FILTER (WHERE NOT is_correct AND was_correct)
    INTO v_rescored, v_became_correct, v_became_wrong
    FROM rescored;
  END IF;

  RETURN jsonb_build_object(
    'questionId', q.id,
    'riseDate', q.rise_date::TEXT,
    'changed', key_changed OR explanation_changed,
    'answerChanged', key_changed,
    'explanationChanged', explanation_changed,
    'previousAnswer', q.answer_key,
    'answerKey', CASE WHEN key_changed THEN new_key ELSE q.answer_key END,
    'attemptsRescored', v_rescored,
    'becameCorrect', v_became_correct,
    'becameWrong', v_became_wrong,
    'weekStart', v_week::TEXT,
    -- 撤下過的也算：兌換券在公布時就發了，重新公布才會跟著新名單調整
    'weekRankingPublished', EXISTS (SELECT 1 FROM public.lightning_quiz_week_rankings WHERE week_start = v_week)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_answer_key(uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_answer_key(uuid, jsonb, text, uuid) TO service_role;

-- ── 4. 送出作答：讀題目改 FOR SHARE（其餘同 0211）────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_lightning_quiz_attempt(
  p_question_id UUID,
  p_response JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  now_time  TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q         public.lightning_quiz_questions%ROWTYPE;
  att       public.lightning_quiz_attempts%ROWTYPE;
  v_correct BOOLEAN;
  v_elapsed BIGINT;
BEGIN
  -- 作答中途被下架就不能再送出。
  -- FOR SHARE：正在更正正解（#616）時等它結束，才會用新正解判分。
  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND status = 'published'
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND user_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_started'; END IF;

  IF att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('isCorrect', att.is_correct, 'elapsedMs', att.elapsed_ms);
  END IF;

  IF now_time > q.rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_window_closed';
  END IF;

  v_correct := public._lightning_quiz_answer_is_correct(q.question_type, q.answer_key, p_response);
  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - att.started_at)) * 1000)::BIGINT;

  UPDATE public.lightning_quiz_attempts
  SET completed_at = NOW(), elapsed_ms = v_elapsed, response = p_response, is_correct = v_correct
  WHERE id = att.id;

  RETURN jsonb_build_object('isCorrect', v_correct, 'elapsedMs', v_elapsed);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 5. 會友「我的測驗」：多回 answerCorrected（其餘同 20261005124326）─────────────
CREATE OR REPLACE FUNCTION public.get_my_lightning_quiz_history(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  rows_j   JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'riseDate', q.rise_date::TEXT,
    'questionType', q.question_type,
    'payload', q.payload,
    'answerKey', q.answer_key,
    'explanation', q.explanation,
    'answerCorrected', q.answer_corrected_at IS NOT NULL,
    'result', CASE WHEN a.id IS NULL THEN 'not_participated'
                   WHEN a.completed_at IS NULL THEN 'incomplete'
                   WHEN a.is_correct THEN 'correct'
                   ELSE 'wrong' END,
    'response', a.response,
    'elapsedMs', a.elapsed_ms
  ) ORDER BY q.rise_date DESC), '[]'::jsonb)
  INTO rows_j
  FROM public.lightning_quiz_questions q
  LEFT JOIN public.lightning_quiz_attempts a ON a.question_id = q.id AND a.user_id = actor_id
  WHERE q.status = 'published'
    AND public._lightning_quiz_window_ended(q.rise_date, q.rise_time_end)
    AND (p_from IS NULL OR q.rise_date >= p_from)
    AND (p_to IS NULL OR q.rise_date <= p_to);

  RETURN rows_j;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) TO authenticated, service_role;

-- ── 6. 後台清單：多回更正紀錄（其餘同 20261005124326）────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_lightning_quiz_questions(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  rows_j   JSONB;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'riseDate', q.rise_date::TEXT,
    'riseTimeStart', q.rise_time_start::TEXT,
    'riseTimeEnd', q.rise_time_end::TEXT,
    'questionType', q.question_type,
    'payload', q.payload,
    'answerKey', q.answer_key,
    'explanation', q.explanation,
    'answerCorrectedAt', q.answer_corrected_at,
    'originalAnswerKey', q.original_answer_key,
    'status', q.status,
    'publishedAt', q.published_at,
    'sourceQuestionId', q.source_question_id,
    'locked', public._lightning_quiz_is_locked(q.id),
    'createdAt', q.created_at,
    'updatedAt', q.updated_at
  ) ORDER BY q.rise_date DESC, q.created_at DESC), '[]'::jsonb)
  INTO rows_j
  FROM public.lightning_quiz_questions q
  WHERE (p_from IS NULL OR q.rise_date >= p_from)
    AND (p_to IS NULL OR q.rise_date <= p_to);

  RETURN rows_j;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) TO authenticated, service_role;
