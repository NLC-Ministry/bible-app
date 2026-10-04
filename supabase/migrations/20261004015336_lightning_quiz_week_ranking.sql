-- ============================================================================
-- 20261004015336_lightning_quiz_week_ranking.sql  —  #429 雲柱測驗每週前三名公布到首頁
--
-- 一週（週一到週日，台灣日期）結束後，管理員把這週每一天的前三名公布在首頁，
-- 公布 1～7 天。名次由人工調整：系統依天列出答對且已送出的人（作答秒數由快到慢），
-- 管理員以「天」為單位排除某些人，下面的人遞補。
--
-- 1. lightning_quiz_week_rankings：每週一列。公布時把名次、姓名、牧區、秒數存成
--    固定紀錄（entries），之後有人改名或換牧區也不會變。excluded 記下當時的排除
--    名單（{ "YYYY-MM-DD": [user_id, …] }），重新公布時後台帶回來。撤下＝revoked_at。
-- 2. _lightning_quiz_week_candidates：某週每一天的答對名單（內部用）。
-- 3. admin_get_lightning_quiz_week_ranking：後台讀候選名單＋目前的公布狀態。
-- 4. admin_publish_lightning_quiz_week_ranking：伺服器依排除名單自己重算前三名後
--    寫入（不信任前端送來的名單）；這週還有題目沒結束就不能公布。重新公布覆蓋舊的。
-- 5. admin_revoke_lightning_quiz_week_ranking：撤下，首頁立即不顯示。
-- 6. get_lightning_quiz_week_ranking：首頁讀最新一份還在公布期間的前三名，加上
--    呼叫者自己這週每一題的結果。只回傳姓名／牧區／秒數／名次，不回傳 user id、
--    排除名單，也不回傳呼叫者自己的名次（維護者決定不公布個人名次）。
--
-- 全部是新增，舊版程式不會呼叫，不需要 forceUpdateBuiltBefore。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lightning_quiz_week_rankings (
  week_start DATE PRIMARY KEY CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_days SMALLINT NOT NULL CHECK (display_days BETWEEN 1 AND 7),
  display_until DATE NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.lightning_quiz_week_rankings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_quiz_week_rankings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lightning_quiz_week_rankings TO service_role;

-- ── 某週每一天的答對名單（依作答秒數由快到慢；同秒數先送出的在前）──────────
-- 牧區名稱的取法跟週統計（admin_get_lightning_quiz_week）一樣。
CREATE OR REPLACE FUNCTION public._lightning_quiz_week_candidates(p_week_start DATE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'riseDate', q.rise_date::TEXT,
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
  ) ORDER BY q.rise_date), '[]'::jsonb)
  FROM public.lightning_quiz_questions q
  WHERE q.status = 'published'
    AND q.rise_date BETWEEN p_week_start AND p_week_start + 6;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_week_candidates(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_week_candidates(date) TO service_role;

-- ── 後台：候選名單＋目前的公布狀態 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_week_ranking(
  p_week_start DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_week     DATE;
  days_j     JSONB;
  r          public.lightning_quiz_week_rankings%ROWTYPE;
  today_tw   DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'lightning_quiz_week_required'; END IF;
  v_week := date_trunc('week', p_week_start)::DATE;
  days_j := public._lightning_quiz_week_candidates(v_week);

  SELECT * INTO r FROM public.lightning_quiz_week_rankings WHERE week_start = v_week;

  RETURN jsonb_build_object(
    'weekStart', v_week::TEXT,
    'weekEnd', (v_week + 6)::TEXT,
    'allEnded', jsonb_array_length(days_j) > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(days_j) d WHERE NOT (d->>'ended')::BOOLEAN),
    'days', days_j,
    'publication', CASE WHEN r.week_start IS NULL THEN NULL ELSE jsonb_build_object(
      'entries', r.entries,
      'excluded', r.excluded,
      'displayDays', r.display_days,
      'displayUntil', r.display_until::TEXT,
      'publishedAt', r.published_at,
      'revoked', r.revoked_at IS NOT NULL,
      'showing', r.revoked_at IS NULL AND r.display_until >= today_tw
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_week_ranking(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_week_ranking(date, uuid) TO authenticated, service_role;

-- ── 後台：公布（重新公布會覆蓋舊的）─────────────────────────────────────────
-- p_excluded：{ "YYYY-MM-DD": ["<user id>", …] }，以天為單位。
-- 公布天數從公布當天（台灣日期）算起：1 天＝公布到當天 23:59。
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
  day_key      TEXT;
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
    day_key := day_j->>'riseDate';
    day_excluded := ARRAY[]::TEXT[];
    IF p_excluded IS NOT NULL AND jsonb_typeof(p_excluded->day_key) = 'array' THEN
      SELECT COALESCE(array_agg(DISTINCT v), ARRAY[]::TEXT[]) INTO day_excluded
      FROM jsonb_array_elements_text(p_excluded->day_key) AS t(v);
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
      'questionId', day_j->>'questionId',
      'riseDate', day_key,
      'winners', winners_j
    ));
    -- 只留真的有答對紀錄的人，避免存進跟這週無關的 id。
    excluded_j := excluded_j || jsonb_build_object(day_key, COALESCE((
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

-- ── 後台：撤下 ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_lightning_quiz_week_ranking(
  p_week_start DATE,
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
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'lightning_quiz_week_required'; END IF;

  UPDATE public.lightning_quiz_week_rankings
  SET revoked_at = NOW(), revoked_by = actor_id
  WHERE week_start = date_trunc('week', p_week_start)::DATE
    AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lightning_quiz_ranking_not_published';
  END IF;

  RETURN jsonb_build_object('weekStart', date_trunc('week', p_week_start)::DATE::TEXT, 'revoked', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_lightning_quiz_week_ranking(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_lightning_quiz_week_ranking(date, uuid) TO authenticated, service_role;

-- ── 首頁：最新一份還在公布期間的前三名＋自己的結果 ──────────────────────────
-- 個人結果即時查呼叫者自己的作答，不放進快照；被排除的人看到的是自己真實的結果。
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
    'riseDate', e->>'riseDate',
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
        ON a.question_id = (e->>'questionId')::UUID AND a.user_id = actor_id
    )
  ) ORDER BY e->>'riseDate'), '[]'::jsonb)
  INTO days_j
  FROM jsonb_array_elements(r.entries) e;

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
