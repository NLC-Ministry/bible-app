-- ============================================================================
-- 20260927121803_lightning_quiz_schedule_states.sql  —  #309 快問快答狀態簡化
--
-- 畫面上的狀態只剩：準備中 → 已排程 → 作答中 → 已結束。
--   * 資料庫只存兩種：draft（準備中）、published（已排程）。作答中／已結束由
--     日期與時段推算，不另外存。會友端的函式（get_todays / start / submit /
--     history）本來就只看 published，完全不用改。
--   * 拿掉「下架／重新上架」（archived）：正式與 staging 都是 0 筆，這裡先確認。
--   * 拿掉「取消發布」以外的回頭路：只有開始前（時段還沒開始、也沒人作答）可以
--     取消排程回到準備中。
--   * 開始後鎖定，不再自動另存新題（0211 的 fork）；要沿用就在後台按
--     「複製成新題」（前端把內容帶進新增表單，存成新的準備中題目）。
--   * 同一天只能有一題已排程：原本會把舊的自動下架，現在直接擋下並說明。
--   * 刪除「清除作答」（admin_clear_lightning_quiz_attempts）：會刪掉會友的
--     正式作答，測試改在 staging 做。0207 的 admin_reset_lightning_quiz_attempt
--     早已不用，一併確認刪除。
--
-- 舊版後台：按「下架」會收到「目前的狀態不能這樣切換」、按「清除作答」會失敗，
-- 只影響管理員，重新整理就是新版，不需要 forceUpdateBuiltBefore。
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lightning_quiz_questions WHERE status = 'archived') THEN
    RAISE EXCEPTION 'lightning_quiz_questions still has archived rows; decide what to do with them first';
  END IF;
END $guard$;

ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT IF EXISTS lightning_quiz_questions_status_check;
ALTER TABLE public.lightning_quiz_questions
  ADD CONSTRAINT lightning_quiz_questions_status_check
  CHECK (status IN ('draft', 'published'));

-- ── 新增／編輯：開始後拒絕修改，不再另存 ──────────────────────────────────
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

  SELECT * INTO existing FROM public.lightning_quiz_questions WHERE id = p_id FOR UPDATE;
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
    updated_at = NOW()
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid) TO authenticated, service_role;

-- ── 排程／取消排程 ────────────────────────────────────────────────────────
--   draft     → published  排程：時段還沒結束，而且那一天沒有其他已排程的題目
--   published → draft      取消排程：只有還沒開始、也沒人作答時可以
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
    IF EXISTS (SELECT 1 FROM public.lightning_quiz_questions
               WHERE rise_date = q.rise_date AND status = 'published' AND id <> q.id) THEN
      RAISE EXCEPTION 'lightning_quiz_date_taken';
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

-- ── 清除作答：從正式環境拿掉 ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_clear_lightning_quiz_attempts(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_reset_lightning_quiz_attempt(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_reset_lightning_quiz_attempt(uuid, uuid);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('admin_clear_lightning_quiz_attempts', 'admin_reset_lightning_quiz_attempt')) THEN
    RAISE EXCEPTION 'lightning quiz attempt-clearing functions still exist';
  END IF;
END $verify$;
