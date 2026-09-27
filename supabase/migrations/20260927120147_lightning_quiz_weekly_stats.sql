-- ============================================================================
-- 20260927120147_lightning_quiz_weekly_stats.sql  —  #311 快問快答週統計
--
-- 快問快答固定每週一、三、五，統計改以「週」為單位（週一到週日，台灣日期）。
-- 「這週至少答 1 題的人數」「全部答完的人數」沒辦法從逐日數字加總出來
-- （同一個人會被算好幾次），所以新增兩支只讀函式：
--   1. admin_get_lightning_quiz_weeks(p_from, p_to)：每週一列，給週趨勢圖與週列表。
--   2. admin_get_lightning_quiz_week(p_week_start)：某一週的逐人彙總與應答人數，
--      前端再彙總成大區／牧區分析、週排行榜、週 CSV（lightning-quiz-analytics.mjs）。
--
-- 計入的題目：已發布的題目（草稿沒人能作答；已下架的原活動跟逐日趨勢一樣不計入）。
-- 寫成 status NOT IN ('draft','archived')，之後 #309 把狀態改成 scheduled 時不用改這裡。
-- 「作答」只算已送出的（completed_at 不是 NULL），作答中的不算。
-- 應答人數跟逐日統計一樣用目前啟用中的會友（profiles.is_active）。
-- ============================================================================

-- ── 1. 每週一列 ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_weeks(
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

  WITH q AS (
    SELECT id, rise_date, date_trunc('week', rise_date)::DATE AS week_start
    FROM public.lightning_quiz_questions
    WHERE status NOT IN ('draft', 'archived')
      AND (p_from IS NULL OR rise_date >= date_trunc('week', p_from)::DATE)
      AND (p_to IS NULL OR rise_date <= p_to)
  ),
  per_user AS (
    SELECT q.week_start, a.user_id,
           COUNT(*) AS answered,
           COUNT(*) FILTER (WHERE a.is_correct) AS correct,
           SUM(a.elapsed_ms) AS elapsed_ms
    FROM q
    JOIN public.lightning_quiz_attempts a ON a.question_id = q.id AND a.completed_at IS NOT NULL
    GROUP BY q.week_start, a.user_id
  ),
  weeks AS (
    SELECT week_start, COUNT(*) AS question_count
    FROM q GROUP BY week_start
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekStart', w.week_start::TEXT,
      'weekEnd', (w.week_start + 6)::TEXT,
      'questionCount', w.question_count,
      'participants', COALESCE(s.participants, 0),
      'allAnswered', COALESCE(s.all_answered, 0),
      'completedAttempts', COALESCE(s.completed_attempts, 0),
      'correctAttempts', COALESCE(s.correct_attempts, 0),
      'avgElapsedMs', s.avg_elapsed_ms,
      'totalEligible', total_eligible
    ) ORDER BY w.week_start), '[]'::jsonb)
  INTO rows_j
  FROM weeks w
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS participants,
           COUNT(*) FILTER (WHERE pu.answered >= w.question_count) AS all_answered,
           SUM(pu.answered) AS completed_attempts,
           SUM(pu.correct) AS correct_attempts,
           ROUND(SUM(pu.elapsed_ms)::NUMERIC / NULLIF(SUM(pu.answered), 0)) AS avg_elapsed_ms
    FROM per_user pu WHERE pu.week_start = w.week_start
  ) s ON TRUE;

  RETURN jsonb_build_object('totalEligible', total_eligible, 'weeks', rows_j);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_weeks(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_weeks(date, date, uuid) TO authenticated, service_role;

-- ── 2. 某一週：逐人彙總＋應答人數 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_week(
  p_week_start DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id    UUID := public.resolve_quiz_actor(p_actor_id);
  week_start  DATE;
  q_ids       UUID[];
  questions_j JSONB;
  members_j   JSONB;
  eligible_j  JSONB;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'lightning_quiz_week_required'; END IF;
  week_start := date_trunc('week', p_week_start)::DATE;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO q_ids
  FROM public.lightning_quiz_questions
  WHERE status NOT IN ('draft', 'archived')
    AND rise_date BETWEEN week_start AND week_start + 6;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'questionId', q.id,
      'riseDate', q.rise_date::TEXT,
      'status', q.status,
      'completedCount', (SELECT COUNT(*) FROM public.lightning_quiz_attempts a WHERE a.question_id = q.id AND a.completed_at IS NOT NULL),
      'correctCount', (SELECT COUNT(*) FROM public.lightning_quiz_attempts a WHERE a.question_id = q.id AND a.completed_at IS NOT NULL AND a.is_correct)
    ) ORDER BY q.rise_date), '[]'::jsonb)
  INTO questions_j
  FROM public.lightning_quiz_questions q
  WHERE q.id = ANY(q_ids);

  WITH member_org AS (
    SELECT
      p.id,
      p.name,
      p.is_active,
      COALESCE(NULLIF(r.name, ''), NULLIF(pr.name, ''), NULLIF(btrim(p.great_region), ''), '') AS great_region,
      COALESCE(r.sort_order, pr.sort_order) AS region_sort,
      COALESCE(NULLIF(z.name, ''), NULLIF(btrim(p.pastoral_zone), ''), '') AS pastoral_zone,
      z.sort_order AS zone_sort,
      COALESCE(NULLIF(g.name, ''), NULLIF(btrim(p.small_group), ''), '') AS small_group
    FROM public.profiles p
    LEFT JOIN public.small_groups g ON g.id = p.small_group_id
    LEFT JOIN public.pastoral_zones z ON z.id = COALESCE(p.pastoral_zone_id, g.pastoral_zone_id)
    LEFT JOIN public.great_regions r ON r.id = z.great_region_id
    LEFT JOIN public.great_regions pr ON pr.id = p.great_region_id
  ),
  per_user AS (
    SELECT a.user_id,
           COUNT(*) AS answered,
           COUNT(*) FILTER (WHERE a.is_correct) AS correct,
           COALESCE(SUM(a.elapsed_ms) FILTER (WHERE a.is_correct), 0) AS correct_elapsed_ms
    FROM public.lightning_quiz_attempts a
    WHERE a.question_id = ANY(q_ids) AND a.completed_at IS NOT NULL
    GROUP BY a.user_id
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', pu.user_id,
        'name', m.name,
        'greatRegion', m.great_region,
        'pastoralZone', m.pastoral_zone,
        'smallGroup', m.small_group,
        'regionSort', m.region_sort,
        'zoneSort', m.zone_sort,
        'answered', pu.answered,
        'correct', pu.correct,
        'correctElapsedMs', pu.correct_elapsed_ms
      ) ORDER BY pu.correct DESC, pu.correct_elapsed_ms, m.name)
      FROM per_user pu JOIN member_org m ON m.id = pu.user_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'greatRegion', e.great_region,
        'pastoralZone', e.pastoral_zone,
        'regionSort', e.region_sort,
        'zoneSort', e.zone_sort,
        'count', e.cnt
      ))
      FROM (
        SELECT great_region, pastoral_zone, MIN(region_sort) AS region_sort, MIN(zone_sort) AS zone_sort, COUNT(*) AS cnt
        FROM member_org
        WHERE is_active = TRUE
        GROUP BY great_region, pastoral_zone
      ) e
    ), '[]'::jsonb)
  INTO members_j, eligible_j;

  RETURN jsonb_build_object(
    'weekStart', week_start::TEXT,
    'weekEnd', (week_start + 6)::TEXT,
    'questions', questions_j,
    'members', members_j,
    'eligible', eligible_j
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_week(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_week(date, uuid) TO authenticated, service_role;
