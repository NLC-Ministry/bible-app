-- #612：雲柱測驗新增「選單題」（menu）——像點餐一樣替每個項目選數量。
--   payload    { stem, items:[{id,text}] }
--   answer_key { "<itemId>": 數量, .. }（只記數量 > 0 的項目；干擾項不出現）
--   作答       同 answer_key 的形狀
-- 判分：兩邊都去掉數量為 0 的項目後整組相等才算對（{I1:0} 跟沒選一樣）。
-- 只有雲柱有這個題型；小測驗（0185）、大測驗（0096）不動。
-- 前端舊版本不會出這種題，也不影響既有題目 → 不需要 forceUpdateBuiltBefore。

-- 1. 題目表的題型限制
ALTER TABLE public.lightning_quiz_questions
  DROP CONSTRAINT lightning_quiz_questions_type_check;
ALTER TABLE public.lightning_quiz_questions
  ADD CONSTRAINT lightning_quiz_questions_type_check
    CHECK (question_type IN ('truefalse', 'single', 'multiple', 'matching', 'ordering', 'menu'));

-- 2. 判分：加 menu 分支（其餘五型照 0202 原樣）
CREATE OR REPLACE FUNCTION public._lightning_quiz_answer_is_correct(
  p_question_type TEXT,
  p_answer_key    JSONB,
  p_response      JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $$
DECLARE
  key_quantities  JSONB;
  resp_quantities JSONB;
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
  ELSIF p_question_type = 'menu' THEN
    IF jsonb_typeof(p_answer_key) <> 'object' OR jsonb_typeof(p_response) <> 'object' THEN
      RETURN FALSE;
    END IF;
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO key_quantities
    FROM jsonb_each(p_answer_key)
    WHERE CASE WHEN jsonb_typeof(value) = 'number' THEN value::numeric > 0 ELSE FALSE END;
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO resp_quantities
    FROM jsonb_each(p_response)
    WHERE CASE WHEN jsonb_typeof(value) = 'number' THEN value::numeric > 0 ELSE FALSE END;
    -- 正解至少要有一個項目，否則「什麼都沒選」會被判對
    RETURN key_quantities <> '{}'::jsonb AND key_quantities = resp_quantities;
  END IF;
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_answer_is_correct(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_answer_is_correct(text, jsonb, jsonb) TO service_role;

-- 3. 文字／行事曆匯入的題型白名單加 menu（其餘照 20260927123111 原樣）
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
       OR q_type NOT IN ('truefalse', 'single', 'multiple', 'matching', 'ordering', 'menu')
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
