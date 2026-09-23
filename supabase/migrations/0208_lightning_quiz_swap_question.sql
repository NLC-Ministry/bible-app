-- ============================================================================
-- 快問快答：支援「同一天換題目」——舊題目下架、結果保留，新題目重新累積
-- ============================================================================
-- 原本 rise_date 是整張表 UNIQUE，一個日期永久只能對應一列題目：一旦有真人
-- 作答過，那一列的內容被鎖死也不能刪除（保護統計資料），副作用是連「今天
-- 這題想換掉」都被一起鎖死——下架後那個日期就再也不能用了。
--
-- 改成「同一天最多一個『啟用中』的題目」（partial unique index，只管
-- is_active = TRUE 的列），同一天可以有多列歷史紀錄，但永遠只有一列在生效：
--   * 舊題目下架（is_active = FALSE）後，內容與已收到的作答結果原封不動、
--     永久保留，可以在後台統計裡回頭查。
--   * 新增一題設為啟用中時，若同一天原本已經有一題在生效，自動把那一題
--     下架（不需要管理員先手動關掉舊題目再回來新增，一步到位）。
--   * 新題目是全新的 question_id，自己重新累積自己的作答結果，不會跟舊
--     題目的結果混在一起。
-- ============================================================================

ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT IF EXISTS lightning_quiz_questions_rise_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS lightning_quiz_questions_active_rise_date_idx
  ON public.lightning_quiz_questions (rise_date)
  WHERE is_active = TRUE;

-- ============================================================================
-- admin_upsert_lightning_quiz_question：存成啟用中時，自動下架同一天原本
-- 生效的另一列（如果有的話），並在回傳值帶出 swappedQuestionId 讓前端可以
-- 提示管理員「已經幫你把舊題目下架了」。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_upsert_lightning_quiz_question(
  p_id UUID DEFAULT NULL,
  p_rise_date DATE DEFAULT NULL,
  p_rise_time_start TIME DEFAULT NULL,
  p_rise_time_end TIME DEFAULT NULL,
  p_question_type TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT NULL,
  p_answer_key JSONB DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  existing   public.lightning_quiz_questions%ROWTYPE;
  locked     BOOLEAN;
  new_id     UUID;
  swapped_id UUID;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_rise_time_start IS NULL OR p_rise_time_end IS NULL OR p_rise_time_start >= p_rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_invalid_time_window';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.lightning_quiz_questions WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

    locked := EXISTS (
      SELECT 1 FROM public.lightning_quiz_attempts a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE a.question_id = p_id AND public.role_code(p.role_id) <> 'admin'
    );
    IF locked AND (
      existing.rise_date IS DISTINCT FROM p_rise_date OR
      existing.question_type IS DISTINCT FROM p_question_type OR
      existing.payload IS DISTINCT FROM p_payload OR
      existing.answer_key IS DISTINCT FROM p_answer_key
    ) THEN
      RAISE EXCEPTION 'lightning_quiz_locked_has_attempts';
    END IF;

    IF p_is_active THEN
      UPDATE public.lightning_quiz_questions
      SET is_active = FALSE
      WHERE rise_date = p_rise_date AND is_active = TRUE AND id <> p_id
      RETURNING id INTO swapped_id;
    END IF;

    UPDATE public.lightning_quiz_questions SET
      rise_date = p_rise_date,
      rise_time_start = p_rise_time_start,
      rise_time_end = p_rise_time_end,
      question_type = p_question_type,
      payload = p_payload,
      answer_key = p_answer_key,
      is_active = p_is_active
    WHERE id = p_id;
    new_id := p_id;
  ELSE
    IF p_rise_date IS NULL OR p_question_type IS NULL OR p_payload IS NULL OR p_answer_key IS NULL THEN
      RAISE EXCEPTION 'lightning_quiz_missing_fields';
    END IF;

    IF p_is_active THEN
      UPDATE public.lightning_quiz_questions
      SET is_active = FALSE
      WHERE rise_date = p_rise_date AND is_active = TRUE
      RETURNING id INTO swapped_id;
    END IF;

    INSERT INTO public.lightning_quiz_questions (
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, is_active, created_by
    ) VALUES (
      p_rise_date, p_rise_time_start, p_rise_time_end, p_question_type, p_payload, p_answer_key, p_is_active, actor_id
    ) RETURNING id INTO new_id;
  END IF;

  RETURN jsonb_build_object('id', new_id, 'swappedQuestionId', swapped_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) TO authenticated, service_role;

-- ============================================================================
-- admin_list_lightning_quiz_questions：同一天可能有多列了，加上 created_at
-- 排序讓同一天的版本有穩定、好懂的先後順序（新版在前）。
-- ============================================================================

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
    'isActive', q.is_active,
    'hasAttempts', EXISTS(
      SELECT 1 FROM public.lightning_quiz_attempts a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE a.question_id = q.id AND public.role_code(p.role_id) <> 'admin'
    ),
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

REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) TO authenticated, service_role;

-- ============================================================================
-- admin_get_lightning_quiz_trend：同一天可能有多列（舊版下架＋新版生效），
-- 每列帶上 isActive／createdAt，讓前端分得清楚是哪個版本，排序也加
-- created_at 當第二排序鍵，同一天內新版排在後面。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_trend(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id       UUID := public.resolve_quiz_actor(p_actor_id);
  total_eligible BIGINT;
  rows_j         JSONB;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT COUNT(*) INTO total_eligible FROM public.profiles WHERE is_active = TRUE;

  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'riseDate', x ->> 'createdAt'), '[]'::jsonb) INTO rows_j
  FROM (
    SELECT jsonb_build_object(
      'questionId', q.id,
      'riseDate', q.rise_date::TEXT,
      'isActive', q.is_active,
      'createdAt', q.created_at,
      'attemptedCount', COUNT(a.id),
      'completedCount', COUNT(a.id) FILTER (WHERE a.completed_at IS NOT NULL),
      'correctCount', COUNT(a.id) FILTER (WHERE a.is_correct),
      'totalEligible', total_eligible,
      'participationRate', CASE WHEN total_eligible > 0
        THEN ROUND(COUNT(a.id) FILTER (WHERE a.completed_at IS NOT NULL)::NUMERIC / total_eligible, 4)
        ELSE 0 END,
      'avgElapsedMs', ROUND(AVG(a.elapsed_ms) FILTER (WHERE a.completed_at IS NOT NULL))
    ) AS x
    FROM public.lightning_quiz_questions q
    LEFT JOIN public.lightning_quiz_attempts a ON a.question_id = q.id
      AND public.role_code((SELECT role_id FROM public.profiles WHERE id = a.user_id)) <> 'admin'
    WHERE (p_from IS NULL OR q.rise_date >= p_from)
      AND (p_to IS NULL OR q.rise_date <= p_to)
    GROUP BY q.id, q.rise_date, q.is_active, q.created_at
  ) sub;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'days', rows_j);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) TO authenticated, service_role;
