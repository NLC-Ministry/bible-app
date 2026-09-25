-- ============================================================================
-- 快問快答：每題各自發布、開始後鎖定、修改另存新活動、會友「我的測驗」
-- ============================================================================
-- 取代全站「測試模式」開關（0205）與內容版本號（0209）：
--
--   * 每個活動有自己的狀態 status：
--       draft     測試中，會友看不到。管理員在後台「預覽測試」，預覽不寫入任何
--                 作答紀錄，所以草稿永遠沒有作答資料。
--       published 已發布，依日期與時段在首頁顯示。
--       archived  已下架，首頁與會友的「我的測驗」都不顯示，後台統計保留。
--   * 同一天最多一個已發布的活動（partial unique index）。發布時若同一天已經有
--     已發布的活動，舊的自動下架（前端會先跳確認）。
--   * 鎖定：非草稿，且「時段已經開始」或「已經有人作答」，兩者任一成立就鎖定題目
--     與時間。時段開始就鎖，是為了避免會友已經載入題目、還沒按開始時題目被改，
--     結果用新正解去判舊題目。
--   * 鎖定後還是要修改 → admin_upsert_lightning_quiz_question 不改原活動，而是
--     另存成一個新的草稿（source_question_id 指回原活動），原活動與統計不動。
--     因為作答後題目不會再被改，一題的內容永遠等於大家作答時看到的內容，不再
--     需要版本號。
--   * 會友「我的測驗」：get_my_lightning_quiz_history 只回已發布且時段已結束的
--     活動，才會附上正解——時段內絕不回傳正解。
-- ============================================================================

-- ── 1. 新欄位 ─────────────────────────────────────────────────────────────

ALTER TABLE public.lightning_quiz_questions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_question_id UUID
    REFERENCES public.lightning_quiz_questions(id) ON DELETE SET NULL;

ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT IF EXISTS lightning_quiz_questions_status_check;
ALTER TABLE public.lightning_quiz_questions
  ADD CONSTRAINT lightning_quiz_questions_status_check
  CHECK (status IN ('draft', 'published', 'archived'));

-- ── 2. 既有資料對應到新狀態 ───────────────────────────────────────────────
-- 舊版本（0209）的作答對應的題目內容已經被覆蓋、無法再顯示，先清掉。
DELETE FROM public.lightning_quiz_attempts a
USING public.lightning_quiz_questions q
WHERE q.id = a.question_id AND a.question_version <> q.content_version;

-- 有非管理員作答過的活動，代表當時實際對會友開放過：依原本的 is_active
-- 轉成已發布／已下架。其餘（只有管理員測試過、或沒人答過）一律轉成草稿，
-- 由管理員逐題決定要不要發布。
UPDATE public.lightning_quiz_questions q
SET status = CASE WHEN q.is_active THEN 'published' ELSE 'archived' END,
    published_at = (SELECT MIN(a.started_at) FROM public.lightning_quiz_attempts a WHERE a.question_id = q.id)
WHERE EXISTS (
  SELECT 1
  FROM public.lightning_quiz_attempts a
  JOIN public.profiles p ON p.id = a.user_id
  WHERE a.question_id = q.id AND public.role_code(p.role_id) IS DISTINCT FROM 'admin'
);

-- 草稿不應該有作答紀錄（剩下的都是測試模式下管理員自己的作答）。
DELETE FROM public.lightning_quiz_attempts a
USING public.lightning_quiz_questions q
WHERE q.id = a.question_id AND q.status = 'draft';

-- ── 3. 拿掉版本號、is_active、測試模式 ────────────────────────────────────

ALTER TABLE public.lightning_quiz_attempts
  DROP CONSTRAINT IF EXISTS lightning_quiz_attempts_question_version_user_key;
DROP INDEX IF EXISTS public.idx_lightning_quiz_attempts_question_version;
ALTER TABLE public.lightning_quiz_attempts DROP COLUMN IF EXISTS question_version;
ALTER TABLE public.lightning_quiz_attempts
  DROP CONSTRAINT IF EXISTS lightning_quiz_attempts_question_id_user_id_key;
ALTER TABLE public.lightning_quiz_attempts
  ADD CONSTRAINT lightning_quiz_attempts_question_id_user_id_key UNIQUE (question_id, user_id);

ALTER TABLE public.lightning_quiz_questions DROP COLUMN IF EXISTS content_version;
ALTER TABLE public.lightning_quiz_questions DROP COLUMN IF EXISTS is_active;

-- 同一天可以有草稿、已下架的舊活動並存，但最多一個已發布。
ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT IF EXISTS lightning_quiz_questions_rise_date_key;
DROP INDEX IF EXISTS public.lightning_quiz_questions_active_rise_date_idx;
CREATE UNIQUE INDEX IF NOT EXISTS lightning_quiz_questions_published_rise_date_idx
  ON public.lightning_quiz_questions (rise_date)
  WHERE status = 'published';

DELETE FROM public.app_feature_settings WHERE key = 'lightning_quiz_test_mode';

-- ── 4. 內部輔助函式（REVOKE ALL FROM PUBLIC，只給下方 RPC 內部呼叫）────────

CREATE OR REPLACE FUNCTION public._lightning_quiz_window_started(p_rise_date DATE, p_time_start TIME)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT p_rise_date < (NOW() AT TIME ZONE 'Asia/Taipei')::DATE
      OR (p_rise_date = (NOW() AT TIME ZONE 'Asia/Taipei')::DATE
          AND (NOW() AT TIME ZONE 'Asia/Taipei')::TIME >= p_time_start);
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_window_started(date, time) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._lightning_quiz_window_ended(p_rise_date DATE, p_time_end TIME)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT p_rise_date < (NOW() AT TIME ZONE 'Asia/Taipei')::DATE
      OR (p_rise_date = (NOW() AT TIME ZONE 'Asia/Taipei')::DATE
          AND (NOW() AT TIME ZONE 'Asia/Taipei')::TIME > p_time_end);
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_window_ended(date, time) FROM PUBLIC;

-- 鎖定：非草稿，且時段已經開始或已經有人作答。
CREATE OR REPLACE FUNCTION public._lightning_quiz_is_locked(p_question_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT q.status <> 'draft'
     AND (public._lightning_quiz_window_started(q.rise_date, q.rise_time_start)
          OR EXISTS (SELECT 1 FROM public.lightning_quiz_attempts a WHERE a.question_id = q.id))
  FROM public.lightning_quiz_questions q
  WHERE q.id = p_question_id;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_is_locked(uuid) FROM PUBLIC;

-- ── 5. 會友端 RPC：只看已發布的活動 ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q        public.lightning_quiz_questions%ROWTYPE;
  att      public.lightning_quiz_attempts%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE rise_date = today_tw AND status = 'published';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_question');
  END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  IF FOUND AND att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'answered',
      'questionId', q.id,
      'isCorrect', att.is_correct,
      'elapsedMs', att.elapsed_ms
    );
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'questionId', q.id,
      'questionType', q.question_type,
      'payload', q.payload,
      'startedAt', att.started_at,
      'canSubmit', (now_time <= q.rise_time_end)
    );
  END IF;

  IF now_time NOT BETWEEN q.rise_time_start AND q.rise_time_end THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;

  RETURN jsonb_build_object(
    'status', 'available',
    'questionId', q.id,
    'questionType', q.question_type,
    'payload', q.payload,
    'riseTimeEnd', q.rise_time_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_lightning_quiz_attempt(
  p_question_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q        public.lightning_quiz_questions%ROWTYPE;
  att      public.lightning_quiz_attempts%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND rise_date = today_tw AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  IF FOUND THEN
    IF att.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'lightning_quiz_already_answered';
    END IF;
    RETURN jsonb_build_object('startedAt', att.started_at);
  END IF;

  IF now_time NOT BETWEEN q.rise_time_start AND q.rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_outside_window';
  END IF;

  INSERT INTO public.lightning_quiz_attempts (question_id, user_id, started_at)
  VALUES (q.id, actor_id, NOW())
  ON CONFLICT (question_id, user_id) DO NOTHING;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  RETURN jsonb_build_object('startedAt', att.started_at);
END;
$$;

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
  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND status = 'published';
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

-- 會友「我的測驗」：只回已發布且時段已結束的活動（這時候才附正解），加上
-- 呼叫者自己的作答。沒有作答紀錄＝未參與；有開始沒送出＝未完成。
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

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) TO authenticated, service_role;

-- ── 6. 後台：活動清單、編輯（鎖定時另存新活動）、發布／下架、刪除 ────────

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

-- 新增一律是草稿。編輯時：內容完全沒變 → 不動作；活動已鎖定 → 另存成新草稿
-- （原活動與統計不動）；其他情況直接更新原活動，狀態不變。
DROP FUNCTION IF EXISTS public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid);

CREATE OR REPLACE FUNCTION public.admin_upsert_lightning_quiz_question(
  p_id UUID DEFAULT NULL,
  p_rise_date DATE DEFAULT NULL,
  p_rise_time_start TIME DEFAULT NULL,
  p_rise_time_end TIME DEFAULT NULL,
  p_question_type TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT NULL,
  p_answer_key JSONB DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  existing public.lightning_quiz_questions%ROWTYPE;
  new_id   UUID;
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
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, status, created_by
    ) VALUES (
      p_rise_date, p_rise_time_start, p_rise_time_end, p_question_type, p_payload, p_answer_key, 'draft', actor_id
    ) RETURNING id INTO new_id;
    RETURN jsonb_build_object('id', new_id);
  END IF;

  SELECT * INTO existing FROM public.lightning_quiz_questions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  IF existing.rise_date = p_rise_date
     AND existing.rise_time_start = p_rise_time_start
     AND existing.rise_time_end = p_rise_time_end
     AND existing.question_type = p_question_type
     AND existing.payload = p_payload
     AND existing.answer_key = p_answer_key THEN
    RETURN jsonb_build_object('id', p_id, 'unchanged', TRUE);
  END IF;

  IF public._lightning_quiz_is_locked(p_id) THEN
    INSERT INTO public.lightning_quiz_questions (
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key,
      status, source_question_id, created_by
    ) VALUES (
      p_rise_date, p_rise_time_start, p_rise_time_end, p_question_type, p_payload, p_answer_key,
      'draft', p_id, actor_id
    ) RETURNING id INTO new_id;
    RETURN jsonb_build_object('id', new_id, 'forked', TRUE, 'sourceQuestionId', p_id);
  END IF;

  UPDATE public.lightning_quiz_questions SET
    rise_date = p_rise_date,
    rise_time_start = p_rise_time_start,
    rise_time_end = p_rise_time_end,
    question_type = p_question_type,
    payload = p_payload,
    answer_key = p_answer_key
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id);
END;
$$;

-- 狀態切換：
--   draft     → published  發布；同一天原本已發布的活動自動下架
--   archived  → published  重新上架；同上
--   published → draft      取消發布，只有還沒鎖定時可以
--   published → archived   下架，隨時可以
CREATE OR REPLACE FUNCTION public.admin_set_lightning_quiz_status(
  p_id UUID,
  p_status TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id    UUID := public.resolve_quiz_actor(p_actor_id);
  q           public.lightning_quiz_questions%ROWTYPE;
  archived_id UUID;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  IF p_status = 'published' AND q.status IN ('draft', 'archived') THEN
    UPDATE public.lightning_quiz_questions
    SET status = 'archived'
    WHERE rise_date = q.rise_date AND status = 'published' AND id <> q.id
    RETURNING id INTO archived_id;

    UPDATE public.lightning_quiz_questions
    SET status = 'published', published_at = COALESCE(published_at, NOW())
    WHERE id = q.id;
  ELSIF p_status = 'draft' AND q.status = 'published' THEN
    IF public._lightning_quiz_is_locked(q.id) THEN
      RAISE EXCEPTION 'lightning_quiz_locked';
    END IF;
    UPDATE public.lightning_quiz_questions
    SET status = 'draft', published_at = NULL
    WHERE id = q.id;
  ELSIF p_status = 'archived' AND q.status = 'published' THEN
    UPDATE public.lightning_quiz_questions SET status = 'archived' WHERE id = q.id;
  ELSE
    RAISE EXCEPTION 'lightning_quiz_invalid_status_transition';
  END IF;

  RETURN jsonb_build_object('id', q.id, 'status', p_status, 'archivedQuestionId', archived_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_lightning_quiz_question(
  p_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lightning_quiz_attempts WHERE question_id = p_id) THEN
    RAISE EXCEPTION 'lightning_quiz_has_attempts';
  END IF;
  DELETE FROM public.lightning_quiz_questions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;
  RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) TO authenticated, service_role;

-- ── 7. 後台統計：一個活動一列，不再依版本分組 ────────────────────────────

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

  -- 只要有人作答就有一列；同一天可能有已下架的原活動與另存後發布的新活動。
  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'riseDate', x ->> 'publishedAt' NULLS FIRST), '[]'::jsonb) INTO rows_j
  FROM (
    SELECT jsonb_build_object(
      'questionId', q.id,
      'riseDate', q.rise_date::TEXT,
      'status', q.status,
      'publishedAt', q.published_at,
      'attemptedCount', COUNT(a.id),
      'completedCount', COUNT(a.id) FILTER (WHERE a.completed_at IS NOT NULL),
      'correctCount', COUNT(a.id) FILTER (WHERE a.is_correct),
      'totalEligible', total_eligible,
      'participationRate', CASE WHEN total_eligible > 0
        THEN ROUND(COUNT(a.id) FILTER (WHERE a.completed_at IS NOT NULL)::NUMERIC / total_eligible, 4)
        ELSE 0 END,
      'avgElapsedMs', ROUND(AVG(a.elapsed_ms) FILTER (WHERE a.completed_at IS NOT NULL))
    ) AS x
    FROM public.lightning_quiz_attempts a
    JOIN public.lightning_quiz_questions q ON q.id = a.question_id
    WHERE (p_from IS NULL OR q.rise_date >= p_from)
      AND (p_to IS NULL OR q.rise_date <= p_to)
    GROUP BY q.id
  ) sub;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'days', rows_j);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_lightning_quiz_leaderboard(uuid, int, int, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_leaderboard(
  p_question_id UUID,
  p_limit INT DEFAULT 10,
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
    'userId', sub.user_id,
    'name', sub.name,
    'elapsedMs', sub.elapsed_ms,
    'completedAt', sub.completed_at
  ) ORDER BY sub.elapsed_ms ASC), '[]'::jsonb)
  INTO rows_j
  FROM (
    SELECT a.user_id, p.name, a.elapsed_ms, a.completed_at
    FROM public.lightning_quiz_attempts a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.question_id = p_question_id AND a.is_correct = TRUE AND a.completed_at IS NOT NULL
    ORDER BY a.elapsed_ms ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  ) sub;

  RETURN rows_j;
END;
$$;

-- 作答明細（0210）改成一個活動一份，不再帶版本號。
DROP FUNCTION IF EXISTS public.admin_get_lightning_quiz_results(uuid, int, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_results(
  p_question_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id    UUID := public.resolve_quiz_actor(p_actor_id);
  q           public.lightning_quiz_questions%ROWTYPE;
  attempts_j  JSONB;
  eligible_j  JSONB;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  WITH member_org AS (
    SELECT
      p.id,
      p.name,
      p.is_active,
      COALESCE(NULLIF(r.name, ''), NULLIF(pr.name, ''), NULLIF(btrim(p.great_region), ''), '') AS great_region,
      COALESCE(r.sort_order, pr.sort_order) AS region_sort,
      COALESCE(NULLIF(z.name, ''), NULLIF(btrim(p.pastoral_zone), ''), '') AS pastoral_zone,
      z.sort_order AS zone_sort,
      COALESCE(NULLIF(g.name, ''), NULLIF(btrim(p.small_group), ''), '') AS small_group
    FROM public.profiles p
    LEFT JOIN public.small_groups g ON g.id = p.small_group_id
    LEFT JOIN public.pastoral_zones z ON z.id = COALESCE(p.pastoral_zone_id, g.pastoral_zone_id)
    LEFT JOIN public.great_regions r ON r.id = z.great_region_id
    LEFT JOIN public.great_regions pr ON pr.id = p.great_region_id
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', a.user_id,
        'name', m.name,
        'greatRegion', m.great_region,
        'pastoralZone', m.pastoral_zone,
        'smallGroup', m.small_group,
        'regionSort', m.region_sort,
        'zoneSort', m.zone_sort,
        'status', CASE WHEN a.completed_at IS NULL THEN 'in_progress'
                       WHEN a.is_correct THEN 'correct'
                       ELSE 'wrong' END,
        'elapsedMs', a.elapsed_ms,
        'completedAt', a.completed_at
      ) ORDER BY a.completed_at IS NULL, a.is_correct IS NOT TRUE, a.elapsed_ms NULLS LAST, m.name)
      FROM public.lightning_quiz_attempts a
      JOIN member_org m ON m.id = a.user_id
      WHERE a.question_id = p_question_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'greatRegion', e.great_region,
        'pastoralZone', e.pastoral_zone,
        'regionSort', e.region_sort,
        'zoneSort', e.zone_sort,
        'count', e.cnt
      ))
      FROM (
        SELECT great_region, pastoral_zone, MIN(region_sort) AS region_sort, MIN(zone_sort) AS zone_sort, COUNT(*) AS cnt
        FROM member_org
        WHERE is_active = TRUE
        GROUP BY great_region, pastoral_zone
      ) e
    ), '[]'::jsonb)
  INTO attempts_j, eligible_j;

  RETURN jsonb_build_object(
    'questionId', q.id,
    'riseDate', q.rise_date::TEXT,
    'status', q.status,
    'attempts', attempts_j,
    'eligible', eligible_j
  );
END;
$$;

-- 清除一個活動的全部作答紀錄（不分是誰答的，無法復原）。不會解除鎖定：
-- 時段已經開始的活動，清完還是鎖定，不能拿清除來繞過鎖定去改題目或時間。
DROP FUNCTION IF EXISTS public.admin_clear_lightning_quiz_attempts(uuid, int, uuid);

CREATE OR REPLACE FUNCTION public.admin_clear_lightning_quiz_attempts(
  p_question_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id      UUID := public.resolve_quiz_actor(p_actor_id);
  deleted_count INT;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  DELETE FROM public.lightning_quiz_attempts WHERE question_id = p_question_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('deletedCount', deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_results(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_results(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, uuid) TO authenticated, service_role;
