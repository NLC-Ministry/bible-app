-- ============================================================================
-- 20261007110640_reading_activity_l7.sql  —  #453 讀經使用率：L7 分布（本週 vs 上週）
--
-- 管理面板「讀經使用率」區段的 L7 分布，只給系統管理員（role = admin）。
--
-- 週＝日曆週，週一到週日（台灣時間 Asia/Taipei 的日期，午夜切日；跟雲柱測驗週統計一致）。
--   本週＝p_end 所在的那一週，還沒過完就只算到 p_end（dayCount < 7）。
--   上週＝前一個完整的週一到週日。
-- 每位會友在該週的「活躍天數」＝有 plan_id IS NOT NULL 打卡的天數，依 1～7 分組；
-- 0 天不列（沒有好的分母）。各組人數加總＝該週的不重複活躍人數（total）。
--
-- 限制同 #452：重讀會改寫 read_at、取消打卡會刪除紀錄，數字偏低，適合看趨勢。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_reading_activity_l7(
  p_end DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  week_start DATE;
  prev_start DATE;
  result_j   JSONB;
BEGIN
  IF public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'reading_activity_admin_required';
  END IF;
  IF p_end IS NULL THEN
    RAISE EXCEPTION 'reading_activity_invalid_range';
  END IF;
  week_start := date_trunc('week', p_end)::DATE;
  prev_start := week_start - 7;

  WITH user_days AS (
    SELECT l.user_id, (l.read_at AT TIME ZONE 'Asia/Taipei')::DATE AS d
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND l.read_at >= (prev_start::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_end + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
    GROUP BY 1, 2
  ),
  per_user AS (
    SELECT CASE WHEN d >= week_start THEN 'current' ELSE 'previous' END AS which,
           user_id,
           COUNT(*) AS active_days
    FROM user_days
    GROUP BY 1, 2
  ),
  buckets AS (
    SELECT w.which, b.days, COUNT(pu.user_id) AS users
    FROM (VALUES ('current'), ('previous')) AS w(which)
    CROSS JOIN generate_series(1, 7) AS b(days)
    LEFT JOIN per_user pu ON pu.which = w.which AND pu.active_days = b.days
    GROUP BY w.which, b.days
  )
  SELECT jsonb_object_agg(w.which, jsonb_build_object(
      'weekStart', w.ws::TEXT,
      'weekEnd', (w.ws + 6)::TEXT,
      'coveredEnd', w.covered_end::TEXT,
      'dayCount', w.covered_end - w.ws + 1,
      'total', (SELECT COALESCE(SUM(users), 0) FROM buckets b WHERE b.which = w.which),
      'buckets', (SELECT jsonb_agg(jsonb_build_object('days', b.days, 'users', b.users) ORDER BY b.days)
                  FROM buckets b WHERE b.which = w.which)
    ))
  INTO result_j
  FROM (VALUES ('current', week_start, p_end),
               ('previous', prev_start, week_start - 1)) AS w(which, ws, covered_end);

  RETURN result_j;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_reading_activity_l7(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_activity_l7(date, uuid) TO authenticated, service_role;
