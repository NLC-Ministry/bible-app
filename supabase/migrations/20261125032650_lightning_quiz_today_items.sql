-- ============================================================================
-- 20261125032650_lightning_quiz_today_items.sql  —  #718 hotfix 2：首頁同時列出今天的每一題
--
-- 20261125030019 讓同一天可以排多題，但首頁一次只給一題，會友不知道還有第二題。
-- get_todays_lightning_quiz 原本的回傳（status／questionId／…）完全不變（舊版 App
-- 照舊用），另外多帶 items：今天每一題「已開始、還沒結束」的狀態，形狀跟單題回傳
-- 一樣（available／in_progress／answered），依開始時間、建立時間排序。新版首頁
-- items 有兩題以上就並列顯示。不需要改 nlc-data（同一支 RPC）。
--
-- _lightning_quiz_today_entry：單題的首頁狀態（從 20261125030019 的 get_todays
-- 抽出來），只給 get_todays_lightning_quiz 內部用，service_role 以外都不能執行。
-- ============================================================================

CREATE OR REPLACE FUNCTION public._lightning_quiz_today_entry(p_question_id UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public
AS $$
DECLARE
  now_time     TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q            public.lightning_quiz_questions%ROWTYPE;
  att          public.lightning_quiz_attempts%ROWTYPE;
  seconds_left INT;
BEGIN
  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND OR now_time > q.rise_time_end THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;
  seconds_left := CEIL(EXTRACT(EPOCH FROM (q.rise_time_end - now_time)))::INT;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = p_actor_id;

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
REVOKE ALL ON FUNCTION public._lightning_quiz_today_entry(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_today_entry(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_todays_lightning_quiz(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  now_time  TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  chosen_id UUID;
  result    JSONB;
  items     JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lightning_quiz_questions
                 WHERE rise_date = today_tw AND status = 'published') THEN
    RETURN jsonb_build_object('status', 'no_question');
  END IF;

  -- 舊版首頁只看這一題：作答中 → 開放中還沒答 → 已答完 → 還沒開始（20261125030019）
  SELECT q0.id INTO chosen_id
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
  IF chosen_id IS NULL THEN
    RETURN jsonb_build_object('status', 'hidden');
  END IF;

  result := public._lightning_quiz_today_entry(chosen_id, actor_id);
  IF result->>'status' = 'hidden' THEN
    RETURN result;
  END IF;

  -- 新版首頁：今天每一題（已開始、還沒結束）並列
  SELECT COALESCE(jsonb_agg(e.entry ORDER BY e.rise_time_start, e.created_at), '[]'::jsonb) INTO items
  FROM (
    SELECT public._lightning_quiz_today_entry(q1.id, actor_id) AS entry, q1.rise_time_start, q1.created_at
    FROM public.lightning_quiz_questions q1
    WHERE q1.rise_date = today_tw AND q1.status = 'published'
  ) e
  WHERE e.entry->>'status' IN ('available', 'in_progress', 'answered');

  RETURN result || jsonb_build_object('items', items);
END;
$$;
REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;
