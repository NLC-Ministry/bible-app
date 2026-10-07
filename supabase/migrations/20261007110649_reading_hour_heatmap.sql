-- ============================================================================
-- 20261007110649_reading_hour_heatmap.sql  —  #454 讀經時段：星期 × 小時熱度圖
--
-- 管理面板「讀經使用率」區段的熱度圖，只給系統管理員（role = admin）。
--
-- 時間以台灣時間 Asia/Taipei 為準，只算 plan_id IS NOT NULL 的打卡。
-- 每一格（星期一～日 × 0～23 時）回傳區間內的加總：
--   sumUsers    ＝每個「日期 × 小時」的不重複人數加總
--   sumChapters ＝打卡章數加總
-- 以及 dayCounts（區間內各星期幾出現幾天）。前端用「加總 ÷ 該星期幾的天數」算出
-- 「平均每天」，區間裡各星期幾天數不同時，格子之間仍可比較。168 格都會回傳，沒人補 0。
--
-- 限制同 #452：重讀會把 read_at 改成新時間，歷史時段會往後偏；區間上限 180 天。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_reading_hour_heatmap(
  p_from DATE,
  p_to DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  cells_j  JSONB;
  counts_j JSONB;
BEGIN
  IF public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'reading_activity_admin_required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'reading_activity_invalid_range';
  END IF;
  IF p_to - p_from > 179 THEN
    RAISE EXCEPTION 'reading_activity_range_too_long';
  END IF;

  WITH logs AS (
    SELECT l.user_id, l.read_at AT TIME ZONE 'Asia/Taipei' AS t
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND l.read_at >= (p_from::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
  ),
  per_day_hour AS (
    SELECT t::DATE AS d,
           EXTRACT(HOUR FROM t)::INT AS h,
           COUNT(DISTINCT user_id) AS users,
           COUNT(*) AS chapters
    FROM logs
    GROUP BY 1, 2
  ),
  per_cell AS (
    SELECT EXTRACT(ISODOW FROM d)::INT AS dow, h,
           SUM(users) AS sum_users, SUM(chapters) AS sum_chapters
    FROM per_day_hour
    GROUP BY 1, 2
  )
  SELECT jsonb_agg(jsonb_build_object(
      'dow', g.dow,
      'hour', g.h,
      'sumUsers', COALESCE(c.sum_users, 0),
      'sumChapters', COALESCE(c.sum_chapters, 0)
    ) ORDER BY g.dow, g.h)
  INTO cells_j
  FROM generate_series(1, 7) AS g_dow(dow)
  CROSS JOIN generate_series(0, 23) AS g_h(h)
  CROSS JOIN LATERAL (SELECT g_dow.dow, g_h.h) g
  LEFT JOIN per_cell c ON c.dow = g.dow AND c.h = g.h;

  SELECT jsonb_object_agg(dow::TEXT, cnt)
  INTO counts_j
  FROM (
    SELECT g.dow, COUNT(dd.d) AS cnt
    FROM generate_series(1, 7) AS g(dow)
    LEFT JOIN (
      SELECT x::DATE AS d FROM generate_series(p_from, p_to, INTERVAL '1 day') AS x
    ) dd ON EXTRACT(ISODOW FROM dd.d)::INT = g.dow
    GROUP BY g.dow
  ) s;

  RETURN jsonb_build_object('from', p_from::TEXT, 'to', p_to::TEXT, 'cells', cells_j, 'dayCounts', counts_j);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_reading_hour_heatmap(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_hour_heatmap(date, date, uuid) TO authenticated, service_role;
