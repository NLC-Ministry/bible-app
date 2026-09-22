-- ============================================================================
-- 快問快答（Lightning Quiz）— 首頁單題限時搶答功能
-- 完全獨立於既有 daily_quiz（每日測驗，migration 0084+）與 speed_reading_exam
-- （大測驗，migration 0096+）。題型沿用大測驗「題型一～五」（是非/單選/多選/
-- 連連看/排序，皆自動判分），資料庫層以獨立判分函式實作，不跨表依賴。
--
-- 設計要點（對應與使用者確認過的流程）：
--   * 一天最多一題，rise_date 為 UNIQUE。
--   * 每題各自可設定當天的顯示時段 rise_time_start ~ rise_time_end。
--   * 時段外（尚未開始 / 已結束）一律隱藏，不做預告、不留「已錯過」提示。
--   * 已開始但未送出可以續答：碼表以伺服器 started_at 為準；只要仍在時段內
--     即可送出，超過 rise_time_end 就不能再送出。
--   * 一旦有人作答過，題目內容（題型/內容/正解/日期）鎖定不可再編輯，只能
--     調整時段或下架（is_active）。
--   * 沿用 daily_quiz（migration 0084）的存取模式：RLS 開啟但不寫 policy，
--     全部透過 SECURITY DEFINER RPC 存取，避免會友直接查表看到 answer_key。
-- ============================================================================

INSERT INTO public.app_feature_settings (key, enabled, description)
VALUES (
  'lightning_quiz',
  FALSE,
  '控制首頁「快問快答」雲柱動畫、限時作答與後台題目管理／統計是否啟用。'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 1. 資料表
-- ============================================================================

CREATE TABLE public.lightning_quiz_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rise_date DATE NOT NULL UNIQUE,
  rise_time_start TIME NOT NULL,
  rise_time_end TIME NOT NULL,
  question_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  answer_key JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT lightning_quiz_questions_type_check
    CHECK (question_type IN ('truefalse', 'single', 'multiple', 'matching', 'ordering')),
  CONSTRAINT lightning_quiz_questions_window_check
    CHECK (rise_time_start < rise_time_end)
);

CREATE INDEX idx_lightning_quiz_questions_rise_date ON public.lightning_quiz_questions(rise_date);

CREATE TABLE public.lightning_quiz_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID NOT NULL REFERENCES public.lightning_quiz_questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  elapsed_ms BIGINT,
  response JSONB,
  is_correct BOOLEAN,
  UNIQUE (question_id, user_id)
);

CREATE INDEX idx_lightning_quiz_attempts_question ON public.lightning_quiz_attempts(question_id);
CREATE INDEX idx_lightning_quiz_attempts_user ON public.lightning_quiz_attempts(user_id);
-- 後台「最快答對」排行榜專用索引：只索引已完成且答對的列。
CREATE INDEX idx_lightning_quiz_attempts_leaderboard
  ON public.lightning_quiz_attempts(question_id, elapsed_ms)
  WHERE is_correct = TRUE AND completed_at IS NOT NULL;

ALTER TABLE public.lightning_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lightning_quiz_attempts ENABLE ROW LEVEL SECURITY;
-- 刻意不寫任何 CREATE POLICY：比照 daily_quiz（migration 0084）的模式，兩表
-- 完全透過下方 SECURITY DEFINER RPC 存取，避免會友直接查表看到 answer_key，
-- 也避免直接寫入繞過時段/鎖定檢查。

CREATE TRIGGER trg_lightning_quiz_questions_updated_at
  BEFORE UPDATE ON public.lightning_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. 內部輔助函式（REVOKE ALL FROM PUBLIC，僅供下方 RPC 內部呼叫）
-- ============================================================================

-- 誰能管理快問快答內容（admin / pastor），比照 devotional plan（migration 0145）
-- 的 _devotion_actor_can_manage 寫法。
CREATE OR REPLACE FUNCTION public._lightning_quiz_actor_is_admin(p_actor_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.role_code((SELECT role_id FROM public.profiles WHERE id = p_actor_id))
         IN ('admin', 'pastor');
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) TO authenticated, service_role;

-- 判分：題型一～五皆自動判分。truefalse/single/matching/ordering 為 jsonb 完全
-- 相等；multiple 為集合相等（忽略順序）。邏輯對應大測驗 _exam_answer_is_correct
-- （migration 0096），但獨立實作一份，避免兩個各自演進的功能互相耦合。
CREATE OR REPLACE FUNCTION public._lightning_quiz_answer_is_correct(
  p_question_type TEXT,
  p_answer_key    JSONB,
  p_response      JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_answer_key IS NULL OR p_response IS NULL THEN RETURN FALSE; END IF;

  IF p_question_type IN ('truefalse', 'single', 'matching', 'ordering') THEN
    RETURN p_answer_key = p_response;
  ELSIF p_question_type = 'multiple' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(e ORDER BY e::text), '[]'::jsonb)
      FROM jsonb_array_elements(p_answer_key) e
    ) = (
      SELECT COALESCE(jsonb_agg(e ORDER BY e::text), '[]'::jsonb)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_response) = 'array' THEN p_response ELSE '[]'::jsonb END
      ) e
    );
  END IF;
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_answer_is_correct(text, jsonb, jsonb) FROM PUBLIC;

-- ============================================================================
-- 3. 會友端 RPC
-- ============================================================================

-- 取得「今天」的快問快答狀態。status 可能是：
--   disabled     功能旗標關閉
--   no_question  今天沒有題目
--   hidden       今天有題目，但現在不在顯示時段內，也還沒開始作答
--   available    在時段內、尚未開始作答（回傳題目，不含正解）
--   in_progress  已開始但尚未送出（可續答；canSubmit 表示是否仍可送出）
--   answered     已完成作答（回傳當時對錯與花費時間）
CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time  TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q         public.lightning_quiz_questions%ROWTYPE;
  att       public.lightning_quiz_attempts%ROWTYPE;
  in_window BOOLEAN;
BEGIN
  IF NOT public.is_feature_enabled('lightning_quiz') THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE rise_date = today_tw AND is_active = TRUE;
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

  in_window := now_time BETWEEN q.rise_time_start AND q.rise_time_end;

  IF FOUND AND att.completed_at IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'questionId', q.id,
      'questionType', q.question_type,
      'payload', q.payload,
      'startedAt', att.started_at,
      'canSubmit', (now_time <= q.rise_time_end)
    );
  END IF;

  IF NOT in_window THEN
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

-- 按下「開始作答」：伺服器記錄 started_at（計時以此為準，避免前端竄改）。
-- 同一使用者對同一題重複呼叫視為續答，直接回傳原本的 started_at（處理多裝置
-- 同時按下開始，以及離開重回的續答情境）。
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
  IF NOT public.is_feature_enabled('lightning_quiz') THEN
    RAISE EXCEPTION 'lightning_quiz_feature_disabled';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND rise_date = today_tw AND is_active = TRUE;
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

-- 送出答案：伺服器判分 + 以 started_at 算 elapsed_ms。已送出過則直接回傳原本
-- 的結果（冪等，避免重複點擊送出造成錯誤）。超過 rise_time_end 拒絕送出。
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
  IF NOT public.is_feature_enabled('lightning_quiz') THEN
    RAISE EXCEPTION 'lightning_quiz_feature_disabled';
  END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND user_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_started'; END IF;

  IF att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('isCorrect', att.is_correct, 'elapsedMs', att.elapsed_ms);
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

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

-- ============================================================================
-- 4. 後台管理 RPC（admin / pastor）
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
    'hasAttempts', EXISTS(SELECT 1 FROM public.lightning_quiz_attempts a WHERE a.question_id = q.id),
    'createdAt', q.created_at,
    'updatedAt', q.updated_at
  ) ORDER BY q.rise_date DESC), '[]'::jsonb)
  INTO rows_j
  FROM public.lightning_quiz_questions q
  WHERE (p_from IS NULL OR q.rise_date >= p_from)
    AND (p_to IS NULL OR q.rise_date <= p_to);

  RETURN rows_j;
END;
$$;

-- 新增或編輯題目。已有作答紀錄的題目（hasAttempts）鎖定 rise_date / question_type
-- / payload / answer_key 不可變更，只能調整時段或 is_active，對應與使用者確認
-- 過的「已作答後鎖定題目內容」規則。
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
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  existing public.lightning_quiz_questions%ROWTYPE;
  locked   BOOLEAN;
  new_id   UUID;
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

    locked := EXISTS (SELECT 1 FROM public.lightning_quiz_attempts WHERE question_id = p_id);
    IF locked AND (
      existing.rise_date IS DISTINCT FROM p_rise_date OR
      existing.question_type IS DISTINCT FROM p_question_type OR
      existing.payload IS DISTINCT FROM p_payload OR
      existing.answer_key IS DISTINCT FROM p_answer_key
    ) THEN
      RAISE EXCEPTION 'lightning_quiz_locked_has_attempts';
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
    INSERT INTO public.lightning_quiz_questions (
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key, is_active, created_by
    ) VALUES (
      p_rise_date, p_rise_time_start, p_rise_time_end, p_question_type, p_payload, p_answer_key, p_is_active, actor_id
    ) RETURNING id INTO new_id;
  END IF;

  RETURN jsonb_build_object('id', new_id);
END;
$$;

-- 刪除題目：已有作答紀錄的題目禁止刪除（避免刪掉排行榜/統計依賴的資料），
-- 請改用 is_active = FALSE 下架。
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
    RAISE EXCEPTION 'lightning_quiz_locked_has_attempts';
  END IF;
  DELETE FROM public.lightning_quiz_questions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;
  RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

-- 參與率／成長趨勢：以「is_active = TRUE 的會友總數」作為每日應答分母
-- （totalEligible），逐日回傳作答人數、完成人數、答對人數、參與率、平均耗時，
-- 交給前端 Chart.js 畫趨勢線並自行算週對週/月對月成長率。
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

  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'riseDate'), '[]'::jsonb) INTO rows_j
  FROM (
    SELECT jsonb_build_object(
      'questionId', q.id,
      'riseDate', q.rise_date::TEXT,
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
    WHERE (p_from IS NULL OR q.rise_date >= p_from)
      AND (p_to IS NULL OR q.rise_date <= p_to)
    GROUP BY q.id, q.rise_date
  ) sub;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'days', rows_j);
END;
$$;

-- 單題「最快答對」排行榜（僅計入答對且已完成者，依 elapsed_ms 由小到大）。
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

-- ============================================================================
-- 5. Grants — 每個新函式都明確 REVOKE ALL FROM PUBLIC 後才 GRANT。
-- ============================================================================

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, uuid) TO authenticated, service_role;
