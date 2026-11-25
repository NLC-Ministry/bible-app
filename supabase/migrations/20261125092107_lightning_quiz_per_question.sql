-- ============================================================================
-- 20261125092107_lightning_quiz_per_question.sql  —  #718 雲柱一天多題（本體）
--
-- hotfix（20261125030019、20261125032650）已經讓同一天可以排多題、首頁並列已開始的
-- 題目。這支補完剩下以「日期」為單位的地方，改成以「題目」為單位：
--
-- 1. 一天最多 5 題（準備中＋已排程都算）：新增、改日期（admin_upsert_lightning_quiz_question）
--    與文字匯入（admin_import_lightning_quiz_questions）超過就擋下，錯誤碼
--    lightning_quiz_day_full（匯入帶日期：lightning_quiz_day_full:YYYY-MM-DD）。
--    匯入不再擋「同一批兩題同一天」，也不再擋「那天已經有題目」。
-- 2. 首頁 items：今天每一題都列（原本只列已開始、還沒結束的），多兩種狀態：
--    upcoming（只給時段與距離開始的秒數，不給題目）、ended（只給自己的結果）。
--    每一項都帶 riseTimeStart／riseTimeEnd。get_todays_lightning_quiz 頂層回傳不變，
--    舊版 App 只看頂層、舊版首頁會濾掉不認得的狀態，所以不需要 forceUpdateBuiltBefore。
-- 3. 每週前三名：候選名單同一天依開始時間、建立順序排列，帶 questionNumber／
--    questionCount（那天第幾題／共幾題）。排除名單改以題目 id 為 key；舊版後台送來以
--    日期為 key 的名單照樣接受（套用到那天每一題）。存進 excluded 的一律是題目 id。
--    首頁英雄榜每題一個區塊（帶 questionId／questionNumber／questionCount），保持公布時的順序。
-- 4. 兌換券：多 question_id 欄（依已公布的名單回填），唯一鍵從（週、日期、會友）改成
--    （週、題目、會友），每題前三名都發券，同一人同一天可以拿到多張。券的 JSON 多帶
--    questionId／questionNumber／questionCount。
--
-- 週統計（admin_get_lightning_quiz_week／weeks）本來就以題目計算，不用改。
-- 不需要改 nlc-data（沒有新增或改名的 RPC）。
-- ============================================================================

-- ── 共用：某題是那天（已排程的題目裡）第幾題、共幾題 ─────────────────────────
-- 排序規則全站一致：開始時間 → 建立時間 → id。題目不是已排程就回 NULL。
CREATE OR REPLACE FUNCTION public._lightning_quiz_day_slot(p_question_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object('number', x.n, 'count', x.c)
  FROM (
    SELECT q.id,
           ROW_NUMBER() OVER (ORDER BY q.rise_time_start, q.created_at, q.id) AS n,
           COUNT(*) OVER () AS c
    FROM public.lightning_quiz_questions q
    JOIN public.lightning_quiz_questions me ON me.id = p_question_id AND me.rise_date = q.rise_date
    WHERE q.status = 'published'
  ) x
  WHERE x.id = p_question_id;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_day_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_day_slot(uuid) TO service_role;

-- ── 共用：一天最多 5 題 ─────────────────────────────────────────────────────
-- p_exclude_id：正在改的那一題自己不算。同一天同時新增用 advisory lock 排隊，避免兩邊都以為還有空位。
CREATE OR REPLACE FUNCTION public._lightning_quiz_assert_day_capacity(p_date DATE, p_exclude_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lightning_quiz_day:' || p_date::TEXT));
  IF (SELECT COUNT(*) FROM public.lightning_quiz_questions
      WHERE rise_date = p_date AND (p_exclude_id IS NULL OR id <> p_exclude_id)) >= 5 THEN
    RAISE EXCEPTION 'lightning_quiz_day_full:%', p_date;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_assert_day_capacity(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_assert_day_capacity(date, uuid) TO service_role;

-- ── 1a. 新增／編輯：新增或改到別天時檢查上限（其餘照 20261125030019）──────────
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
    PERFORM public._lightning_quiz_assert_day_capacity(p_rise_date, NULL);
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

  IF existing.rise_date <> p_rise_date THEN
    PERFORM public._lightning_quiz_assert_day_capacity(p_rise_date, p_id);
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

-- ── 1b. 文字匯入：同一天可以多題，超過 5 題擋下（其餘照 20261021095130）─────────
CREATE OR REPLACE FUNCTION public.admin_import_lightning_quiz_questions(
  p_items JSONB,
  p_schedule BOOLEAN DEFAULT FALSE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  item     JSONB;
  n        INT := 0;
  d        DATE;
  t_start  TIME;
  t_end    TIME;
  q_type   TEXT;
  ids      UUID[] := ARRAY[]::UUID[];
  new_id   UUID;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'lightning_quiz_import_empty';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'lightning_quiz_import_too_many';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n := n + 1;
    BEGIN
      d := (item ->> 'riseDate')::DATE;
      t_start := (item ->> 'riseTimeStart')::TIME;
      t_end := (item ->> 'riseTimeEnd')::TIME;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'lightning_quiz_import_invalid_item:%', n;
    END;
    q_type := item ->> 'questionType';
    IF d IS NULL OR t_start IS NULL OR t_end IS NULL OR t_start >= t_end
       OR q_type NOT IN ('truefalse', 'single', 'multiple', 'matching', 'ordering', 'menu')
       OR jsonb_typeof(item -> 'payload') <> 'object'
       OR COALESCE(btrim(item -> 'payload' ->> 'stem'), '') = ''
       OR item -> 'answerKey' IS NULL OR jsonb_typeof(item -> 'answerKey') = 'null' THEN
      RAISE EXCEPTION 'lightning_quiz_import_invalid_item:%', n;
    END IF;
    IF p_schedule AND public._lightning_quiz_window_started(d, t_start) THEN
      RAISE EXCEPTION 'lightning_quiz_window_passed:%', d;
    END IF;
    -- 同一批前面已經寫入的題目也算在內
    PERFORM public._lightning_quiz_assert_day_capacity(d, NULL);

    INSERT INTO public.lightning_quiz_questions (
      rise_date, rise_time_start, rise_time_end, question_type, payload, answer_key,
      status, published_at, created_by
    ) VALUES (
      d, t_start, t_end, q_type, item -> 'payload', item -> 'answerKey',
      CASE WHEN p_schedule THEN 'published' ELSE 'draft' END,
      CASE WHEN p_schedule THEN NOW() END,
      actor_id
    ) RETURNING id INTO new_id;
    ids := ids || new_id;
  END LOOP;

  RETURN jsonb_build_object('imported', n, 'scheduled', p_schedule, 'ids', to_jsonb(ids));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_import_lightning_quiz_questions(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_import_lightning_quiz_questions(jsonb, boolean, uuid) TO authenticated, service_role;

-- ── 2. 首頁 items：每一題都列，還沒開始／已結束也列 ─────────────────────────
-- 已開始、還沒結束的照 _lightning_quiz_today_entry（available／in_progress／answered）；
-- 還沒開始＝upcoming，只給時段與秒數；已結束＝ended，只給自己的結果。都不給答案。
CREATE OR REPLACE FUNCTION public._lightning_quiz_today_item(p_question_id UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public
AS $$
DECLARE
  now_time TIME := (NOW() AT TIME ZONE 'Asia/Taipei')::TIME;
  q        public.lightning_quiz_questions%ROWTYPE;
  att      public.lightning_quiz_attempts%ROWTYPE;
  entry    JSONB;
  times    JSONB;
BEGIN
  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  times := jsonb_build_object(
    'riseTimeStart', to_char(q.rise_time_start, 'HH24:MI'),
    'riseTimeEnd', to_char(q.rise_time_end, 'HH24:MI')
  );

  entry := public._lightning_quiz_today_entry(q.id, p_actor_id);
  IF entry->>'status' <> 'hidden' THEN
    RETURN entry || times;
  END IF;

  IF now_time < q.rise_time_start THEN
    RETURN jsonb_build_object(
      'status', 'upcoming',
      'questionId', q.id,
      'secondsUntilStart', CEIL(EXTRACT(EPOCH FROM (q.rise_time_start - now_time)))::INT
    ) || times;
  END IF;

  SELECT * INTO att FROM public.lightning_quiz_attempts
  WHERE question_id = q.id AND user_id = p_actor_id;
  RETURN jsonb_build_object(
    'status', 'ended',
    'questionId', q.id,
    'result', CASE WHEN NOT FOUND THEN 'not_participated'
                   WHEN att.completed_at IS NULL THEN 'incomplete'
                   WHEN att.is_correct THEN 'correct'
                   ELSE 'wrong' END,
    'elapsedMs', CASE WHEN FOUND AND att.completed_at IS NOT NULL THEN att.elapsed_ms END
  ) || times;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_today_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_today_item(uuid, uuid) TO service_role;

-- 頂層回傳與「何時整張卡收起」都照 20261125032650，只有 items 改成每一題都列。
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

  -- 新版首頁：今天每一題並列（含還沒開始、已結束），依開始時間、建立順序排列
  SELECT COALESCE(jsonb_agg(public._lightning_quiz_today_item(q1.id, actor_id)
                            ORDER BY q1.rise_time_start, q1.created_at, q1.id), '[]'::jsonb)
  INTO items
  FROM public.lightning_quiz_questions q1
  WHERE q1.rise_date = today_tw AND q1.status = 'published';

  RETURN result || jsonb_build_object('items', items);
END;
$$;
REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;

-- ── 3a. 候選名單：同一天依開始時間排，帶第幾題（其餘照 20261004015336）─────────
CREATE OR REPLACE FUNCTION public._lightning_quiz_week_candidates(p_week_start DATE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'riseDate', q.rise_date::TEXT,
    'riseTimeStart', to_char(q.rise_time_start, 'HH24:MI'),
    'riseTimeEnd', to_char(q.rise_time_end, 'HH24:MI'),
    'questionNumber', q.day_number,
    'questionCount', q.day_count,
    'ended', public._lightning_quiz_window_ended(q.rise_date, q.rise_time_end),
    'candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', a.user_id,
        'name', COALESCE(p.name, ''),
        'pastoralZone', COALESCE(NULLIF(z.name, ''), NULLIF(btrim(p.pastoral_zone), ''), ''),
        'elapsedMs', a.elapsed_ms
      ) ORDER BY a.elapsed_ms, a.completed_at, a.user_id)
      FROM public.lightning_quiz_attempts a
      JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN public.small_groups g ON g.id = p.small_group_id
      LEFT JOIN public.pastoral_zones z ON z.id = COALESCE(p.pastoral_zone_id, g.pastoral_zone_id)
      WHERE a.question_id = q.id
        AND a.completed_at IS NOT NULL
        AND a.is_correct
    ), '[]'::jsonb)
  ) ORDER BY q.rise_date, q.rise_time_start, q.created_at, q.id), '[]'::jsonb)
  FROM (
    SELECT q0.*,
           ROW_NUMBER() OVER (PARTITION BY q0.rise_date ORDER BY q0.rise_time_start, q0.created_at, q0.id) AS day_number,
           COUNT(*) OVER (PARTITION BY q0.rise_date) AS day_count
    FROM public.lightning_quiz_questions q0
    WHERE q0.status = 'published'
      AND q0.rise_date BETWEEN p_week_start AND p_week_start + 6
  ) q;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_week_candidates(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_week_candidates(date) TO service_role;

-- ── 3b. 公布：排除名單以題目為單位（其餘照 20261004015336）─────────────────────
-- p_excluded：{ "<question id>": ["<user id>", …] }；舊版後台送 { "YYYY-MM-DD": [...] }，
-- 那一題沒有自己的 key 時改用日期的 key（套用到那天每一題）。存進 excluded 的一律是題目 id。
CREATE OR REPLACE FUNCTION public.admin_publish_lightning_quiz_week_ranking(
  p_week_start DATE,
  p_excluded JSONB,
  p_display_days INT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id     UUID := public.resolve_quiz_actor(p_actor_id);
  v_week       DATE;
  today_tw     DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  days_j       JSONB;
  day_j        JSONB;
  question_key TEXT;
  day_key      TEXT;
  source_j     JSONB;
  day_excluded TEXT[];
  winners_j    JSONB;
  entries_j    JSONB := '[]'::jsonb;
  excluded_j   JSONB := '{}'::jsonb;
  until_date   DATE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'lightning_quiz_week_required'; END IF;
  IF p_display_days IS NULL OR p_display_days < 1 OR p_display_days > 7 THEN
    RAISE EXCEPTION 'lightning_quiz_ranking_invalid_days';
  END IF;
  IF p_excluded IS NOT NULL AND jsonb_typeof(p_excluded) <> 'object' THEN
    RAISE EXCEPTION 'lightning_quiz_ranking_invalid_excluded';
  END IF;

  v_week := date_trunc('week', p_week_start)::DATE;
  days_j := public._lightning_quiz_week_candidates(v_week);
  IF jsonb_array_length(days_j) = 0 THEN
    RAISE EXCEPTION 'lightning_quiz_ranking_no_questions';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(days_j) d WHERE NOT (d->>'ended')::BOOLEAN) THEN
    RAISE EXCEPTION 'lightning_quiz_ranking_week_not_ended';
  END IF;

  FOR day_j IN SELECT value FROM jsonb_array_elements(days_j) LOOP
    question_key := day_j->>'questionId';
    day_key := day_j->>'riseDate';
    source_j := NULL;
    IF p_excluded IS NOT NULL THEN
      source_j := CASE
        WHEN jsonb_typeof(p_excluded->question_key) = 'array' THEN p_excluded->question_key
        WHEN jsonb_typeof(p_excluded->day_key) = 'array' THEN p_excluded->day_key
      END;
    END IF;
    day_excluded := ARRAY[]::TEXT[];
    IF source_j IS NOT NULL THEN
      SELECT COALESCE(array_agg(DISTINCT v), ARRAY[]::TEXT[]) INTO day_excluded
      FROM jsonb_array_elements_text(source_j) AS t(v);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rank', s.rank,
      'userId', s.c->>'userId',
      'name', s.c->>'name',
      'pastoralZone', s.c->>'pastoralZone',
      'elapsedMs', (s.c->>'elapsedMs')::BIGINT
    ) ORDER BY s.rank), '[]'::jsonb)
    INTO winners_j
    FROM (
      SELECT c, ROW_NUMBER() OVER (ORDER BY ord) AS rank
      FROM jsonb_array_elements(day_j->'candidates') WITH ORDINALITY AS t(c, ord)
      WHERE NOT ((c->>'userId') = ANY(day_excluded))
    ) s
    WHERE s.rank <= 3;

    entries_j := entries_j || jsonb_build_array(jsonb_build_object(
      'questionId', question_key,
      'riseDate', day_key,
      'winners', winners_j
    ));
    -- 只留真的有答對紀錄的人，避免存進跟這週無關的 id。
    excluded_j := excluded_j || jsonb_build_object(question_key, COALESCE((
      SELECT jsonb_agg(c->>'userId' ORDER BY ord)
      FROM jsonb_array_elements(day_j->'candidates') WITH ORDINALITY AS t(c, ord)
      WHERE (c->>'userId') = ANY(day_excluded)
    ), '[]'::jsonb));
  END LOOP;

  until_date := today_tw + p_display_days - 1;

  INSERT INTO public.lightning_quiz_week_rankings AS r
    (week_start, entries, excluded, display_days, display_until, published_at, published_by, revoked_at, revoked_by)
  VALUES (v_week, entries_j, excluded_j, p_display_days, until_date, NOW(), actor_id, NULL, NULL)
  ON CONFLICT (week_start) DO UPDATE SET
    entries = EXCLUDED.entries,
    excluded = EXCLUDED.excluded,
    display_days = EXCLUDED.display_days,
    display_until = EXCLUDED.display_until,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    revoked_at = NULL,
    revoked_by = NULL;

  RETURN jsonb_build_object(
    'weekStart', v_week::TEXT,
    'entries', entries_j,
    'excluded', excluded_j,
    'displayDays', p_display_days,
    'displayUntil', until_date::TEXT
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publish_lightning_quiz_week_ranking(date, jsonb, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_lightning_quiz_week_ranking(date, jsonb, int, uuid) TO authenticated, service_role;

-- ── 3c. 首頁英雄榜：每題一個區塊，保持公布時的順序（其餘照 20261004015336）──────
CREATE OR REPLACE FUNCTION public.get_lightning_quiz_week_ranking(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  r        public.lightning_quiz_week_rankings%ROWTYPE;
  days_j   JSONB;
BEGIN
  SELECT * INTO r FROM public.lightning_quiz_week_rankings
  WHERE revoked_at IS NULL AND display_until >= today_tw
  ORDER BY week_start DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'questionId', NULLIF(e->>'questionId', ''),
    'riseDate', e->>'riseDate',
    'questionNumber', (slot.s->>'number')::INT,
    'questionCount', (slot.s->>'count')::INT,
    'winners', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rank', (w->>'rank')::INT,
        'name', w->>'name',
        'pastoralZone', w->>'pastoralZone',
        'elapsedMs', (w->>'elapsedMs')::BIGINT
      ) ORDER BY (w->>'rank')::INT)
      FROM jsonb_array_elements(e->'winners') w
    ), '[]'::jsonb),
    'mine', (
      SELECT jsonb_build_object(
        'result', CASE WHEN a.id IS NULL THEN 'not_participated'
                       WHEN a.completed_at IS NULL THEN 'incomplete'
                       WHEN a.is_correct THEN 'correct'
                       ELSE 'wrong' END,
        'elapsedMs', CASE WHEN a.completed_at IS NULL THEN NULL ELSE a.elapsed_ms END
      )
      FROM (SELECT 1) one
      LEFT JOIN public.lightning_quiz_attempts a
        ON a.question_id = NULLIF(e->>'questionId', '')::UUID AND a.user_id = actor_id
    )
  ) ORDER BY e->>'riseDate', ord), '[]'::jsonb)
  INTO days_j
  FROM jsonb_array_elements(r.entries) WITH ORDINALITY AS t(e, ord)
  LEFT JOIN LATERAL (
    SELECT public._lightning_quiz_day_slot(NULLIF(e->>'questionId', '')::UUID) AS s
  ) slot ON TRUE;

  RETURN jsonb_build_object(
    'status', 'published',
    'weekStart', r.week_start::TEXT,
    'weekEnd', (r.week_start + 6)::TEXT,
    'displayUntil', r.display_until::TEXT,
    'secondsUntilHide', GREATEST(0, CEIL(EXTRACT(EPOCH FROM
      (((r.display_until + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei') - NOW())))::INT),
    'days', days_j
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_lightning_quiz_week_ranking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lightning_quiz_week_ranking(uuid) TO authenticated, service_role;

-- ── 4a. 兌換券多 question_id，唯一鍵改成（週、題目、會友）────────────────────
ALTER TABLE public.lightning_quiz_vouchers
  ADD COLUMN IF NOT EXISTS question_id UUID REFERENCES public.lightning_quiz_questions(id) ON DELETE SET NULL;

-- 回填：先照公布名單（同週、同日期、名單上有這個人的那一題），被作廢、已不在名單上的
-- 再退回那天第一題（這支以前一天只有一題已排程，所以兩種方式結果一樣）。
UPDATE public.lightning_quiz_vouchers v
SET question_id = (e->>'questionId')::UUID
FROM public.lightning_quiz_week_rankings rk
CROSS JOIN LATERAL jsonb_array_elements(rk.entries) e
WHERE v.question_id IS NULL
  AND rk.week_start = v.week_start
  AND NULLIF(e->>'questionId', '') IS NOT NULL
  AND (e->>'riseDate')::DATE = v.rise_date
  AND EXISTS (SELECT 1 FROM public.lightning_quiz_questions q WHERE q.id = (e->>'questionId')::UUID)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(e->'winners', '[]'::jsonb)) x
    WHERE (x->>'userId')::UUID = v.user_id
  );

UPDATE public.lightning_quiz_vouchers v
SET question_id = (
  SELECT q.id FROM public.lightning_quiz_questions q
  WHERE q.rise_date = v.rise_date AND q.status = 'published'
  ORDER BY q.rise_time_start, q.created_at, q.id
  LIMIT 1
)
WHERE v.question_id IS NULL;

DO $$
DECLARE
  con TEXT;
BEGIN
  SELECT c.conname INTO con
  FROM pg_constraint c
  WHERE c.conrelid = 'public.lightning_quiz_vouchers'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) = 'UNIQUE (week_start, rise_date, user_id)';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.lightning_quiz_vouchers DROP CONSTRAINT %I', con);
  END IF;
END;
$$;

-- 回填不到題目的舊券（question_id 為 NULL）不受這個唯一鍵限制，同步時改用日期比對。
CREATE UNIQUE INDEX IF NOT EXISTS lightning_quiz_vouchers_week_question_user_idx
  ON public.lightning_quiz_vouchers (week_start, question_id, user_id)
  WHERE question_id IS NOT NULL;

-- ── 4b. 依公布名單發券／作廢：以題目為單位（其餘照 20261005110447）──────────────
-- 名單上的一項沒有 questionId（很舊的公布紀錄）時，退回用日期比對 question_id 為 NULL 的券。
CREATE OR REPLACE FUNCTION public._lightning_quiz_sync_week_vouchers(p_week_start DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  rk        public.lightning_quiz_week_rankings%ROWTYPE;
  w         RECORD;
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  tries     INT;
BEGIN
  SELECT * INTO rk FROM public.lightning_quiz_week_rankings WHERE week_start = p_week_start;
  IF NOT FOUND THEN RETURN; END IF;

  -- 不在名單上、還沒兌換的券作廢（已兌換的保留）。
  UPDATE public.lightning_quiz_vouchers v
  SET voided_at = NOW()
  WHERE v.week_start = p_week_start
    AND v.redeemed_at IS NULL
    AND v.voided_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(rk.entries) e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e->'winners', '[]'::jsonb)) x
      WHERE (x->>'userId')::UUID = v.user_id
        AND (
          (v.question_id IS NOT NULL AND NULLIF(e->>'questionId', '')::UUID = v.question_id)
          OR (v.question_id IS NULL AND NULLIF(e->>'questionId', '') IS NULL AND (e->>'riseDate')::DATE = v.rise_date)
        )
    );

  FOR w IN
    SELECT NULLIF(e->>'questionId', '')::UUID AS question_id,
           (e->>'riseDate')::DATE AS rise_date,
           (x->>'userId')::UUID AS user_id,
           (x->>'rank')::SMALLINT AS rank,
           COALESCE(x->>'name', '') AS name,
           COALESCE(x->>'pastoralZone', '') AS pastoral_zone,
           (x->>'elapsedMs')::BIGINT AS elapsed_ms
    FROM jsonb_array_elements(rk.entries) e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e->'winners', '[]'::jsonb)) x
    WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (x->>'userId')::UUID)
  LOOP
    -- 已經有券：更新名次與固定紀錄；之前被作廢、又回到名單的恢復（期限不變）。
    UPDATE public.lightning_quiz_vouchers
    SET rank = w.rank,
        name = w.name,
        pastoral_zone = w.pastoral_zone,
        elapsed_ms = w.elapsed_ms,
        voided_at = NULL
    WHERE week_start = p_week_start
      AND user_id = w.user_id
      AND (
        (w.question_id IS NOT NULL AND question_id = w.question_id)
        OR (w.question_id IS NULL AND question_id IS NULL AND rise_date = w.rise_date)
      );
    IF FOUND THEN CONTINUE; END IF;

    tries := 0;
    LOOP
      BEGIN
        INSERT INTO public.lightning_quiz_vouchers
          (week_start, rise_date, question_id, rank, user_id, name, pastoral_zone, elapsed_ms, code, expires_on)
        VALUES
          (p_week_start, w.rise_date, w.question_id, w.rank, w.user_id, w.name, w.pastoral_zone, w.elapsed_ms,
           public._lightning_quiz_voucher_code(), today_tw + 29);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- 兌換碼撞到別張就換一組再試
        tries := tries + 1;
        IF tries >= 10 THEN RAISE; END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_sync_week_vouchers(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_sync_week_vouchers(date) TO service_role;

-- ── 4c. 券的 JSON 多帶題目（其餘照 20261005110447）────────────────────────────
CREATE OR REPLACE FUNCTION public._lightning_quiz_voucher_json(v public.lightning_quiz_vouchers, p_today DATE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', v.id,
    'code', v.code,
    'amount', v.amount,
    'weekStart', v.week_start::TEXT,
    'riseDate', v.rise_date::TEXT,
    'questionId', v.question_id,
    'questionNumber', (slot.s->>'number')::INT,
    'questionCount', (slot.s->>'count')::INT,
    'rank', v.rank,
    'name', v.name,
    'pastoralZone', v.pastoral_zone,
    'elapsedMs', v.elapsed_ms,
    'issuedAt', v.issued_at,
    'expiresOn', v.expires_on::TEXT,
    'redeemedAt', v.redeemed_at,
    'redeemedVia', v.redeemed_via,
    'status', CASE
      WHEN v.voided_at IS NOT NULL THEN 'void'
      WHEN v.redeemed_at IS NOT NULL THEN 'redeemed'
      WHEN v.expires_on < p_today THEN 'expired'
      ELSE 'available'
    END
  )
  FROM (SELECT public._lightning_quiz_day_slot(v.question_id) AS s) slot;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_voucher_json(public.lightning_quiz_vouchers, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_voucher_json(public.lightning_quiz_vouchers, date) TO service_role;
