-- ============================================================================
-- 快問快答：改成「編輯內容 = 切版本」，取代鎖定內容／換題／排除 admin 這三套
-- ============================================================================
-- 這次是架構簡化，不是疊加：拿掉 migration 0205（統計/排行榜/鎖定排除 admin
-- 角色）、0207（admin_reset_lightning_quiz_attempt）、0208（partial unique
-- index 換題機制）裡跟這個功能相關的邏輯，改成單一、一致的規則：
--
--   * 題目可以隨時直接編輯內容（題型/題目/選項/正解/日期），不鎖、不擋。
--   * 編輯到會影響「這題在問什麼」的欄位時，content_version 自動 +1。
--   * 每筆作答紀錄記住作答當下是第幾版（question_version）。「今天答過了
--     嗎」只看「呼叫者在題目*目前這個版本*有沒有已完成的作答」——版本被
--     編輯切過之後，舊版本的作答不算數，任何人（不分 admin／真會友）都可
--     以在新版本重新作答一次。這是明確跟使用者確認過的行為。
--   * 統計／排行榜依「題目＋版本」分組：編輯前的舊版本結果原封不動留著
--     自成一列，新版本另外重新累積，不會混在一起，也不需要特別排除
--     admin 的作答——誰答的都一視同仁計入對應版本。
--   * 「一天一題」恢復成最原始設計：rise_date 整張表唯一，不需要 0208 那套
--     「新增題目自動下架同一天舊題目」的換題機制——想換內容就直接編輯
--     現有那一列。
--   * 新增 admin_clear_lightning_quiz_attempts(question_id, question_version)：
--     後台統計表每一列可以整個清掉那個版本的作答紀錄，管理員自己決定何時
--     清除測試/舊資料，系統不自動幫忙清。取代 0207 的
--     admin_reset_lightning_quiz_attempt（只能刪自己一筆，已經不夠用）。
-- ============================================================================

-- ── 1. 欄位／約束變更 ────────────────────────────────────────────────────

ALTER TABLE public.lightning_quiz_questions
  ADD COLUMN IF NOT EXISTS content_version INT NOT NULL DEFAULT 1;

ALTER TABLE public.lightning_quiz_attempts
  ADD COLUMN IF NOT EXISTS question_version INT NOT NULL DEFAULT 1;

-- rise_date 恢復成整張表唯一（拿掉 0208 的 partial unique index）。
DROP INDEX IF EXISTS public.lightning_quiz_questions_active_rise_date_idx;
ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT IF EXISTS lightning_quiz_questions_rise_date_key;
ALTER TABLE public.lightning_quiz_questions
  ADD CONSTRAINT lightning_quiz_questions_rise_date_key UNIQUE (rise_date);

-- 作答紀錄的唯一鍵從 (question_id, user_id) 改成再多帶版本號：同一人在
-- 新版本可以重新作答一次。
ALTER TABLE public.lightning_quiz_attempts
  DROP CONSTRAINT IF EXISTS lightning_quiz_attempts_question_id_user_id_key;
ALTER TABLE public.lightning_quiz_attempts
  ADD CONSTRAINT lightning_quiz_attempts_question_version_user_key
  UNIQUE (question_id, question_version, user_id);

CREATE INDEX IF NOT EXISTS idx_lightning_quiz_attempts_question_version
  ON public.lightning_quiz_attempts (question_id, question_version);

-- ── 2. 會友端三支 RPC：比對版本號，不再檢查鎖定 ────────────────────────

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

  -- 只看「目前這個版本」的作答；題目被編輯過（版本號變了）之後，舊版本的
  -- 作答不再視為「已經答過」。
  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id AND question_version = q.content_version;

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
    RAISE EXCEPTION 'lightning_quiz_not_found';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions
  WHERE id = p_question_id AND rise_date = today_tw AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id AND question_version = q.content_version;

  IF FOUND THEN
    IF att.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'lightning_quiz_already_answered';
    END IF;
    RETURN jsonb_build_object('startedAt', att.started_at);
  END IF;

  IF now_time NOT BETWEEN q.rise_time_start AND q.rise_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_outside_window';
  END IF;

  INSERT INTO public.lightning_quiz_attempts (question_id, question_version, user_id, started_at)
  VALUES (q.id, q.content_version, actor_id, NOW())
  ON CONFLICT (question_id, question_version, user_id) DO NOTHING;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id AND question_version = q.content_version;

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
    RAISE EXCEPTION 'lightning_quiz_not_found';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND user_id = actor_id AND question_version = q.content_version;
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

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 3. 後台：題目 CRUD，拿掉鎖定判斷，改成版本遞增 ─────────────────────

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
    'contentVersion', q.content_version,
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

-- 內容隨時可以直接改；題型/題目/選項/正解/日期只要有一項變了，content_version
-- 自動 +1，不擋、不用先清資料。純排程欄位（時段／是否啟用）不算內容，改
-- 這兩個不會動到版本號。
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
  actor_id        UUID := public.resolve_quiz_actor(p_actor_id);
  existing        public.lightning_quiz_questions%ROWTYPE;
  content_changed BOOLEAN;
  new_id          UUID;
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

    content_changed := (
      existing.rise_date IS DISTINCT FROM p_rise_date OR
      existing.question_type IS DISTINCT FROM p_question_type OR
      existing.payload IS DISTINCT FROM p_payload OR
      existing.answer_key IS DISTINCT FROM p_answer_key
    );

    UPDATE public.lightning_quiz_questions SET
      rise_date = p_rise_date,
      rise_time_start = p_rise_time_start,
      rise_time_end = p_rise_time_end,
      question_type = p_question_type,
      payload = p_payload,
      answer_key = p_answer_key,
      is_active = p_is_active,
      content_version = CASE WHEN content_changed THEN content_version + 1 ELSE content_version END
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

-- 刪除整個題目列還是要先清空作答紀錄（所有版本）——避免不小心連同歷史
-- 統計一起刪掉；真的要清資料，用下面的 admin_clear_lightning_quiz_attempts
-- 依版本清除即可，不用整列刪掉。
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
REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) TO authenticated, service_role;

-- ── 4. 統計／排行榜：依「題目＋版本」分組，只列有作答的版本 ────────────
-- 「只要有人作答就產生一個結果列」——沒有人答過的版本／題目不需要在統計表
-- 佔一列，不用另外查詢「目前有哪些題目」再補 0 進去，直接從作答紀錄出發
-- 最單純。

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

  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'riseDate', (x ->> 'questionVersion')::int), '[]'::jsonb) INTO rows_j
  FROM (
    SELECT jsonb_build_object(
      'questionId', q.id,
      'questionVersion', a.question_version,
      'isCurrentVersion', (a.question_version = q.content_version),
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
    FROM public.lightning_quiz_attempts a
    JOIN public.lightning_quiz_questions q ON q.id = a.question_id
    WHERE (p_from IS NULL OR q.rise_date >= p_from)
      AND (p_to IS NULL OR q.rise_date <= p_to)
    GROUP BY q.id, a.question_version, q.rise_date, q.content_version
  ) sub;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'days', rows_j);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_lightning_quiz_leaderboard(uuid, int, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_leaderboard(
  p_question_id UUID,
  p_question_version INT DEFAULT NULL,
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
    WHERE a.question_id = p_question_id
      AND (p_question_version IS NULL OR a.question_version = p_question_version)
      AND a.is_correct = TRUE AND a.completed_at IS NOT NULL
    ORDER BY a.elapsed_ms ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  ) sub;

  RETURN rows_j;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, int, int, uuid) TO authenticated, service_role;

-- ── 5. 新增：管理員自己清除某一版本的全部作答紀錄 ──────────────────────
-- 取代 0207 的 admin_reset_lightning_quiz_attempt（只能刪呼叫者自己一筆）。
-- 這支清的是「這一版的全部作答」，不分是誰答的——管理員自己決定何時清除
-- 測試或不要的舊資料，系統不自動處理。

CREATE OR REPLACE FUNCTION public.admin_clear_lightning_quiz_attempts(
  p_question_id UUID,
  p_question_version INT,
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

  DELETE FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND question_version = p_question_version;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('deletedCount', deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, int, uuid) TO authenticated, service_role;

-- ── 6. 拿掉不再使用的 0207 RPC ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_reset_lightning_quiz_attempt(uuid, uuid);
