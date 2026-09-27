-- ============================================================================
-- 20260927123111_lightning_quiz_calendar_import.sql  —  #310 一三五排程日曆＋文字匯入
--
-- 1. lightning_quiz_settings：排程規則（哪幾天有快問快答、預設時段），只有一列。
--    預設每週一、三、五，07:00～10:00。後台日曆用它標出「缺題」的日子，
--    新增題目與文字匯入用它帶入預設時段。
-- 2. admin_import_lightning_quiz_questions：文字匯入一次寫入多題，全部成功或
--    全部失敗（任何一題有問題就整批不存）。日期由前端依規則排好後送來；這裡
--    再檢查一次：同一天不能已經有題目（準備中或已排程都算）、同一批不能重複
--    日期；要直接排程的題目時段不能已經開始。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lightning_quiz_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  weekdays SMALLINT[] NOT NULL DEFAULT '{1,3,5}',
  time_start TIME NOT NULL DEFAULT '07:00',
  time_end TIME NOT NULL DEFAULT '10:00',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lightning_quiz_settings_window_check CHECK (time_start < time_end),
  CONSTRAINT lightning_quiz_settings_weekdays_check
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[])
);
ALTER TABLE public.lightning_quiz_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_quiz_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lightning_quiz_settings TO service_role;
INSERT INTO public.lightning_quiz_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ── 讀取／儲存排程規則（weekdays 用 ISO：1＝週一 … 7＝週日）──────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_settings(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  s        public.lightning_quiz_settings%ROWTYPE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  SELECT * INTO s FROM public.lightning_quiz_settings WHERE id;
  RETURN jsonb_build_object(
    'weekdays', to_jsonb(COALESCE(s.weekdays, '{1,3,5}'::SMALLINT[])),
    'timeStart', to_char(COALESCE(s.time_start, '07:00'::TIME), 'HH24:MI'),
    'timeEnd', to_char(COALESCE(s.time_end, '10:00'::TIME), 'HH24:MI')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_settings(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_save_lightning_quiz_settings(
  p_weekdays SMALLINT[],
  p_time_start TIME,
  p_time_end TIME,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  days     SMALLINT[];
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO days FROM unnest(p_weekdays) d WHERE d BETWEEN 1 AND 7;
  IF days IS NULL THEN RAISE EXCEPTION 'lightning_quiz_weekdays_required'; END IF;
  IF p_time_start IS NULL OR p_time_end IS NULL OR p_time_start >= p_time_end THEN
    RAISE EXCEPTION 'lightning_quiz_invalid_time_window';
  END IF;
  INSERT INTO public.lightning_quiz_settings (id, weekdays, time_start, time_end, updated_by, updated_at)
  VALUES (TRUE, days, p_time_start, p_time_end, actor_id, NOW())
  ON CONFLICT (id) DO UPDATE SET
    weekdays = EXCLUDED.weekdays, time_start = EXCLUDED.time_start, time_end = EXCLUDED.time_end,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  RETURN public.admin_get_lightning_quiz_settings(actor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_lightning_quiz_settings(smallint[], time, time, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_lightning_quiz_settings(smallint[], time, time, uuid) TO authenticated, service_role;

-- ── 文字匯入：一次寫入多題，全部成功或全部失敗 ─────────────────────────────
-- p_items：[{ riseDate, riseTimeStart, riseTimeEnd, questionType, payload, answerKey }]
-- p_schedule：TRUE＝匯入後直接排程（已排程）；FALSE＝匯入為準備中
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

  -- 同一批不能有兩題在同一天
  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items) x)
     <> (SELECT COUNT(DISTINCT x ->> 'riseDate') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'lightning_quiz_import_duplicate_date';
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
       OR q_type NOT IN ('truefalse', 'single', 'multiple', 'matching', 'ordering')
       OR jsonb_typeof(item -> 'payload') <> 'object'
       OR COALESCE(btrim(item -> 'payload' ->> 'stem'), '') = ''
       OR item -> 'answerKey' IS NULL OR jsonb_typeof(item -> 'answerKey') = 'null' THEN
      RAISE EXCEPTION 'lightning_quiz_import_invalid_item:%', n;
    END IF;
    IF EXISTS (SELECT 1 FROM public.lightning_quiz_questions WHERE rise_date = d) THEN
      RAISE EXCEPTION 'lightning_quiz_date_taken:%', d;
    END IF;
    IF p_schedule AND public._lightning_quiz_window_started(d, t_start) THEN
      RAISE EXCEPTION 'lightning_quiz_window_passed:%', d;
    END IF;

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
