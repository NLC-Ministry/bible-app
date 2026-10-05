-- ============================================================================
-- 20261005124326_lightning_quiz_image_explanation.sql  —  #449 雲柱測驗詳解
--
-- 雲柱測驗加「詳解」欄位 explanation：
--   * 不放進 payload：payload 在作答時段內就會傳給會友（get_todays_lightning_quiz），
--     排序題的步驟名稱照順序列出就等於答案。
--   * 會友只能從 get_my_lightning_quiz_history 拿到——它本來就只回「已發布且時段
--     已結束」的題目，跟正解同時出現。
--   * 後台：admin_list 回傳、admin_upsert 多一個 p_explanation（NULL＝不動原本的
--     詳解，舊版後台存檔不會把詳解洗掉）。題目開始後鎖定，詳解也一起鎖。
--
-- 題目附圖（payload.image）不需要改資料庫：payload 原樣儲存、原樣回傳。
--
-- 舊版前端：get_my_lightning_quiz_history／admin_list 只是多一個欄位；admin_upsert
-- 換簽名但參數都有預設值、呼叫一律用具名參數，舊版後台照常可用。
-- 不需要 forceUpdateBuiltBefore。
-- ============================================================================

ALTER TABLE public.lightning_quiz_questions
  ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';

-- ── 會友「我的測驗」：多回傳 explanation ──────────────────────────────────
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

-- ── 後台清單：多回傳 explanation ──────────────────────────────────────────
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

-- ── 新增／編輯：多一個 p_explanation ──────────────────────────────────────
-- 邏輯同 20260927121803（開始後拒絕修改），只多了詳解：NULL＝沿用原本的詳解。
DROP FUNCTION IF EXISTS public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.admin_upsert_lightning_quiz_question(
  p_id UUID DEFAULT NULL,
  p_rise_date DATE DEFAULT NULL,
  p_rise_time_start TIME DEFAULT NULL,
  p_rise_time_end TIME DEFAULT NULL,
  p_question_type TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT NULL,
  p_answer_key JSONB DEFAULT NULL,
  p_explanation TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id      UUID := public.resolve_quiz_actor(p_actor_id);
  existing      public.lightning_quiz_questions%ROWTYPE;
  new_id        UUID;
  v_explanation TEXT;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_rise_time_start IS NULL OR p_rise_time_end IS NULL OR p_rise_time_start >= p_rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_invalid_time_window';
  END IF;
  IF p_rise_date IS NULL OR p_question_type IS NULL OR p_payload IS NULL OR p_answer_key IS NULL THEN
    RAISE EXCEPTION 'lightning_quiz_missing_fields';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.lightning_quiz_questions (
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, explanation, status, created_by
    ) VALUES (
      p_rise_date, p_rise_time_start, p_rise_time_end, p_question_type, p_payload, p_answer_key,
      BTRIM(COALESCE(p_explanation, '')), 'draft', actor_id
    ) RETURNING id INTO new_id;
    RETURN jsonb_build_object('id', new_id);
  END IF;

  SELECT * INTO existing FROM public.lightning_quiz_questions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  v_explanation := COALESCE(BTRIM(p_explanation), existing.explanation);

  IF existing.rise_date = p_rise_date
     AND existing.rise_time_start = p_rise_time_start
     AND existing.rise_time_end = p_rise_time_end
     AND existing.question_type = p_question_type
     AND existing.payload = p_payload
     AND existing.answer_key = p_answer_key
     AND existing.explanation = v_explanation THEN
    RETURN jsonb_build_object('id', p_id, 'unchanged', TRUE);
  END IF;

  IF public._lightning_quiz_is_locked(p_id) THEN
    RAISE EXCEPTION 'lightning_quiz_locked';
  END IF;

  IF existing.status = 'published' THEN
    -- 已排程的題目改時間：不能改到已經開始的時段，也不能撞到另一題已排程的日期
    IF public._lightning_quiz_window_started(p_rise_date, p_rise_time_start) THEN
      RAISE EXCEPTION 'lightning_quiz_window_passed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.lightning_quiz_questions
               WHERE rise_date = p_rise_date AND status = 'published' AND id <> p_id) THEN
      RAISE EXCEPTION 'lightning_quiz_date_taken';
    END IF;
  END IF;

  UPDATE public.lightning_quiz_questions SET
    rise_date = p_rise_date,
    rise_time_start = p_rise_time_start,
    rise_time_end = p_rise_time_end,
    question_type = p_question_type,
    payload = p_payload,
    answer_key = p_answer_key,
    explanation = v_explanation,
    updated_at = NOW()
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, text, uuid) TO authenticated, service_role;
