-- ============================================================================
-- 20261125030019_lightning_quiz_multiple_per_day.sql  —  #718 hotfix：雲柱同一天可以排好幾題
--
-- 起因：週一忘了出題，週三要在同一個時段（11:00–14:00）連出兩題，但「同一天只能
-- 有一題已排程」擋住了。這支只改資料庫、不動前端（不需要等前端部署，也不需要
-- forceUpdateBuiltBefore）：
--
--   * 拿掉 0211 的 partial unique index（同一天最多一題 published），新增／改時間
--     （admin_upsert_lightning_quiz_question）與排程（admin_set_lightning_quiz_status）
--     不再擋同一天的其他題，時段可以重疊。
--   * 首頁卡片一次只顯示一題，所以 get_todays_lightning_quiz 在今天還沒結束的題目裡
--     依序挑：①作答中 ②時段已開始、還沒答 ③已答完 ④還沒開始；同順位再比開始時間、
--     建立時間。會友答完第一題，下次首頁重新整理（回到首頁、重開 App）就換成下一題。
--     舊版 App 呼叫的是同一支函式，所以舊版也看得到第二題。
--
-- 這支沒處理、留給 #718 本體：
--   * 首頁同時列出多題（目前是答完一題才換下一題）。
--   * 文字匯入（admin_import_lightning_quiz_questions）仍是一天一題。
--   * 後台排程日曆一天一格只顯示一題（另一題在「題目」分頁看得到）。
--   * 每週前三名的排除名單與兌換券仍以「日期」為單位：同一天兩題各自有前三名，
--     但同一人同一天兩題都上榜只會有一張券（_lightning_quiz_sync_week_vouchers
--     第二次遇到同日同人走 UPDATE，不會出錯）。
-- ============================================================================

DROP INDEX IF EXISTS public.lightning_quiz_questions_published_rise_date_idx;

-- ── 新增／編輯：已排程的題目改時間，不再擋同一天的其他題 ──────────────────
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
    -- 已排程的題目改時間：不能改到已經開始的時段（同一天可以有別題，#718）
    IF public._lightning_quiz_window_started(p_rise_date, p_rise_time_start) THEN
      RAISE EXCEPTION 'lightning_quiz_window_passed';
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

-- ── 排程：同一天可以有多題已排程 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_lightning_quiz_status(
  p_id UUID,
  p_status TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  q        public.lightning_quiz_questions%ROWTYPE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_not_found'; END IF;

  IF p_status = 'published' AND q.status = 'draft' THEN
    IF public._lightning_quiz_window_ended(q.rise_date, q.rise_time_end) THEN
      RAISE EXCEPTION 'lightning_quiz_window_passed';
    END IF;
    UPDATE public.lightning_quiz_questions
    SET status = 'published', published_at = NOW()
    WHERE id = q.id;
  ELSIF p_status = 'draft' AND q.status = 'published' THEN
    IF public._lightning_quiz_is_locked(q.id) THEN
      RAISE EXCEPTION 'lightning_quiz_locked';
    END IF;
    UPDATE public.lightning_quiz_questions
    SET status = 'draft', published_at = NULL
    WHERE id = q.id;
  ELSE
    RAISE EXCEPTION 'lightning_quiz_invalid_status_transition';
  END IF;

  RETURN jsonb_build_object('id', q.id, 'status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) TO authenticated, service_role;

-- ── 首頁：今天有多題時，先給作答中／還沒答的那一題（其餘照 0213）──────────
CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id     UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw     DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time     TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q            public.lightning_quiz_questions%ROWTYPE;
  att          public.lightning_quiz_attempts%ROWTYPE;
  seconds_left INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lightning_quiz_questions
                 WHERE rise_date = today_tw AND status = 'published') THEN
    RETURN jsonb_build_object('status', 'no_question');
  END IF;

  SELECT q0.* INTO q
  FROM public.lightning_quiz_questions q0
  LEFT JOIN public.lightning_quiz_attempts a0
    ON a0.question_id = q0.id AND a0.user_id = actor_id
  WHERE q0.rise_date = today_tw AND q0.status = 'published' AND q0.rise_time_end >= now_time
  ORDER BY CASE
             WHEN a0.id IS NOT NULL AND a0.completed_at IS NULL THEN 0   -- 作答中
             WHEN a0.id IS NULL AND q0.rise_time_start <= now_time THEN 1 -- 開放中、還沒答
             WHEN a0.id IS NOT NULL THEN 2                               -- 已答完
             ELSE 3                                                      -- 還沒開始
           END,
           q0.rise_time_start, q0.created_at
  LIMIT 1;

  -- 今天的題目都結束了：首頁一律撤掉，結果到「我的測驗」看。
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;
  seconds_left := CEIL(EXTRACT(EPOCH FROM (q.rise_time_end - now_time)))::INT;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = actor_id;

  IF FOUND AND att.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'answered',
      'questionId', q.id,
      'isCorrect', att.is_correct,
      'elapsedMs', att.elapsed_ms,
      'secondsUntilEnd', seconds_left
    );
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'questionId', q.id,
      'questionType', q.question_type,
      'payload', q.payload,
      'startedAt', att.started_at,
      'secondsUntilEnd', seconds_left
    );
  END IF;

  IF now_time < q.rise_time_start THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;

  RETURN jsonb_build_object(
    'status', 'available',
    'questionId', q.id,
    'questionType', q.question_type,
    'payload', q.payload,
    'secondsUntilEnd', seconds_left
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;
