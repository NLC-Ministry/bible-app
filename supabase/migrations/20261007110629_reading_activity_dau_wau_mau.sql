-- ============================================================================
-- 20261007110629_reading_activity_dau_wau_mau.sql  —  #452 讀經使用率：DAU／WAU／MAU
--
-- 管理面板「讀經使用率」區段的逐日趨勢，只給系統管理員（role = admin）。
--
-- 定義（台灣時間 Asia/Taipei 的日期，午夜切日）：
--   活躍＝當天在 reading_logs 有至少一筆 plan_id IS NOT NULL 的打卡。
--   DAU＝當天活躍人數；WAU＝含當天往回 7 天內的不重複活躍人數；MAU＝往回 30 天。
--   往前多讀 29 天，所以區間第一天的 MAU 就是完整的 30 天。
--
-- 算法：同一人相鄰兩個活躍日 d1 < d2，d1 讓他在 [d1, min(d2, d1+7)) 這幾天算進 WAU，
-- 各段互不重疊，所以「在 d 加 1、在 min(next_d, d+7) 減 1」再逐日累加，就等於當天的
-- 不重複人數（MAU 同理用 30）。只掃一次資料，不必每天各自 count distinct。
--
-- 限制：重讀同一章會把舊紀錄的 read_at 改成新時間、取消打卡會刪除紀錄，所以越早的
-- 日期越偏低；前端頁面有寫明。reading_logs 沒有單獨的 read_at 索引（#400 刻意移除），
-- 這裡是循序掃描，區間上限 180 天。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_reading_activity(
  p_from DATE,
  p_to DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  scan_from DATE;
  days_j JSONB;
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
  scan_from := p_from - 29;

  WITH user_days AS (
    SELECT l.user_id, (l.read_at AT TIME ZONE 'Asia/Taipei')::DATE AS d
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND l.read_at >= (scan_from::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
    GROUP BY 1, 2
  ),
  spans AS (
    SELECT d, LEAD(d) OVER (PARTITION BY user_id ORDER BY d) AS next_d
    FROM user_days
  ),
  events AS (
    SELECT d AS day, 1 AS dau, 1 AS wau, 1 AS mau FROM spans
    UNION ALL
    SELECT LEAST(next_d, d + 7), 0, -1, 0 FROM spans
    UNION ALL
    SELECT LEAST(next_d, d + 30), 0, 0, -1 FROM spans
  ),
  per_day AS (
    SELECT day, SUM(dau) AS dau, SUM(wau) AS wau_delta, SUM(mau) AS mau_delta
    FROM events GROUP BY day
  ),
  running AS (
    SELECT c.day,
           COALESCE(p.dau, 0) AS dau,
           SUM(COALESCE(p.wau_delta, 0)) OVER (ORDER BY c.day) AS wau,
           SUM(COALESCE(p.mau_delta, 0)) OVER (ORDER BY c.day) AS mau
    FROM generate_series(scan_from, p_to, INTERVAL '1 day') AS g(ts)
    CROSS JOIN LATERAL (SELECT g.ts::DATE AS day) c
    LEFT JOIN per_day p ON p.day = c.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', r.day::TEXT,
      'dau', r.dau,
      'wau', r.wau,
      'mau', r.mau
    ) ORDER BY r.day), '[]'::jsonb)
  INTO days_j
  FROM running r
  WHERE r.day >= p_from;

  RETURN jsonb_build_object('from', p_from::TEXT, 'to', p_to::TEXT, 'days', days_j);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_reading_activity(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_activity(date, date, uuid) TO authenticated, service_role;
