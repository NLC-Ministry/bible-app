-- ============================================================================
-- 快問快答（Lightning Quiz）— 拿掉「功能開放設定」總開關，改用「測試模式」
-- ============================================================================
-- 原本 migration 0202 用 app_feature_settings.lightning_quiz 當作全站總開關，
-- 需要在後台「功能開放設定」頁面另外管理。使用者回饋：這個功能只有系統管理
-- 員會操作，不需要放在那個共用頁面；改成「測試模式」的概念更符合實際流程：
--   測試模式關閉（預設）：時段內的題目所有人都看得到，跟一般功能一樣運作。
--   測試模式開啟：時段內即使有題目，只有 admin 看得到／答得到，其他人一律
--                 視為「今天沒有題目」；讓 admin 可以先用自己的帳號預覽完整
--                 流程，確認沒問題再關閉測試模式讓全教會看到。
-- 「只有 admin 看得到」的 admin 判斷收斂成單一角色 'admin'（不含 pastor），
-- 跟後台導覽本來就只開放系統管理員操作（js/modules/admin.js ADMIN_SECTIONS
-- 的 lightning-quiz 項目是 panel:'system'）保持一致。
--
-- 額外處理一個必要的邊界情況：admin 在測試模式下自己作答一次，會在
-- lightning_quiz_attempts 留下一筆紀錄——如果這筆紀錄照樣被當成「已有人
-- 作答」，會把題目內容鎖死（無法再編輯）且污染參與率／排行榜統計，等於
-- 「測試」這個動作本身就破壞了測試的目的。所以本次一併把
-- admin_list/upsert/delete_lightning_quiz_question 的鎖定判斷、以及
-- admin_get_lightning_quiz_trend／admin_get_lightning_quiz_leaderboard 的統計
-- 聚合，都改成排除 role_code = 'admin' 的作答紀錄。
-- ============================================================================

-- 舊的全站總開關不再使用，改用 lightning_quiz_test_mode；清掉這筆，避免後台
-- 資料庫裡留一個沒有任何程式碼會讀的 key，造成日後排查混淆。
DELETE FROM public.app_feature_settings WHERE key = 'lightning_quiz';

-- 預設開啟：新建立的題目在還沒被 admin 明確關閉測試模式之前，不會被整個
-- 教會看到——避免像這次一樣「部署完才發現全部人都看得到」的情況倒過來變成
-- 「部署完才發現忘記關測試模式，全部人都看不到」。
INSERT INTO public.app_feature_settings (key, enabled, description)
VALUES (
  'lightning_quiz_test_mode',
  TRUE,
  '開啟時，快問快答的題目只有系統管理員看得到／答得到，用於發佈前預覽測試；關閉後全教會依時段正常顯示。'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 1. 「誰能管理／預覽」收斂成單一角色 admin（不再包含 pastor）
-- ============================================================================
CREATE OR REPLACE FUNCTION public._lightning_quiz_actor_is_admin(p_actor_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.role_code((SELECT role_id FROM public.profiles WHERE id = p_actor_id)) = 'admin';
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. 會友端三支 RPC：拿掉舊的 is_feature_enabled('lightning_quiz') 檢查，
--    改成「測試模式開啟 且 呼叫者不是 admin」就當作沒有題目／不能作答。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  is_admin  BOOLEAN := public._lightning_quiz_actor_is_admin(actor_id);
  test_mode BOOLEAN := public.is_feature_enabled('lightning_quiz_test_mode');
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time  TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q         public.lightning_quiz_questions%ROWTYPE;
  att       public.lightning_quiz_attempts%ROWTYPE;
  in_window BOOLEAN;
BEGIN
  IF test_mode AND NOT is_admin THEN
    RETURN jsonb_build_object('status', 'no_question');
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
  IF public.is_feature_enabled('lightning_quiz_test_mode')
     AND NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_test_mode_restricted';
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
  IF public.is_feature_enabled('lightning_quiz_test_mode')
     AND NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_test_mode_restricted';
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

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. admin 自己在測試模式下的作答，不算「已有人作答」，也不進統計／排行榜
--    ——不然「測試」這個動作本身會鎖死題目內容、污染參與率數字。
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
  ) ORDER BY q.rise_date DESC), '[]'::jsonb)
  INTO rows_j
  FROM public.lightning_quiz_questions q
  WHERE (p_from IS NULL OR q.rise_date >= p_from)
    AND (p_to IS NULL OR q.rise_date <= p_to);

  RETURN rows_j;
END;
$$;

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
  IF EXISTS (
    SELECT 1 FROM public.lightning_quiz_attempts a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.question_id = p_id AND public.role_code(p.role_id) <> 'admin'
  ) THEN
    RAISE EXCEPTION 'lightning_quiz_locked_has_attempts';
  END IF;
  DELETE FROM public.lightning_quiz_questions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;
  RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

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
    -- admin 自己測試用的作答不算數：LEFT JOIN 時就把 role='admin' 的作答排除，
    -- 這樣參與率／答對人數／平均耗時都只反映真正的會友資料。
    LEFT JOIN public.lightning_quiz_attempts a ON a.question_id = q.id
      AND public.role_code((SELECT role_id FROM public.profiles WHERE id = a.user_id)) <> 'admin'
    WHERE (p_from IS NULL OR q.rise_date >= p_from)
      AND (p_to IS NULL OR q.rise_date <= p_to)
    GROUP BY q.id, q.rise_date
  ) sub;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'days', rows_j);
END;
$$;

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
      AND public.role_code(p.role_id) <> 'admin'
    ORDER BY a.elapsed_ms ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  ) sub;

  RETURN rows_j;
END;
$$;

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
