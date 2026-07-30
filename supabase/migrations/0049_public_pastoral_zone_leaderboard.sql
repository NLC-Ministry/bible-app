-- Plan-specific pastoral-zone leaderboard available to every authenticated user.
-- Only aggregate zone statistics are returned; individual member identities stay private.

CREATE OR REPLACE FUNCTION public.get_pastoral_zone_leaderboard(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_pastoral_zone_leaderboard$
DECLARE
  actor_id UUID;
  actor_pastoral_zone TEXT;
  result JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.global_plans AS plan
    WHERE plan.id = p_global_plan_id
  ) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT NULLIF(BTRIM(profile.pastoral_zone), '')
  INTO actor_pastoral_zone
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  WITH member_progress AS (
    SELECT
      profile.id,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone,
      COALESCE(progress.chapters_read, 0) AS chapters_read,
      progress.last_read_at
    FROM public.profiles AS profile
    LEFT JOIN public.reading_plans AS reading_plan
      ON reading_plan.user_id = profile.id
     AND reading_plan.global_plan_id = p_global_plan_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE reading_log.round = COALESCE(reading_plan.current_round, 1)
        )::INTEGER AS chapters_read,
        MAX(reading_log.read_at) FILTER (
          WHERE reading_log.round = COALESCE(reading_plan.current_round, 1)
        ) AS last_read_at
      FROM public.reading_logs AS reading_log
      WHERE reading_log.plan_id = reading_plan.id
    ) AS progress ON TRUE
    WHERE profile.is_demo = FALSE
      AND COALESCE(profile.is_active, TRUE) = TRUE
  ), zone_rollup AS (
    SELECT
      pastoral_zone,
      COUNT(*)::INTEGER AS member_count,
      COALESCE(SUM(chapters_read), 0)::INTEGER AS chapters_read,
      MAX(last_read_at) AS last_read_at
    FROM member_progress
    WHERE pastoral_zone IS NOT NULL
      AND pastoral_zone NOT IN ('未設定', '未設定牧區', '未分類')
    GROUP BY pastoral_zone
  )
  SELECT jsonb_build_object(
    'zones',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', zone.pastoral_zone,
          'memberCount', zone.member_count,
          'chaptersRead', zone.chapters_read,
          'lastReadAt', zone.last_read_at,
          'isMine', actor_pastoral_zone IS NOT NULL
            AND zone.pastoral_zone = actor_pastoral_zone
        )
        ORDER BY zone.chapters_read DESC,
          zone.last_read_at ASC NULLS LAST,
          zone.pastoral_zone
      )
      FROM zone_rollup AS zone
    ), '[]'::JSONB),
    'unassignedCount',
    (
      SELECT COUNT(*)::INTEGER
      FROM member_progress
      WHERE pastoral_zone IS NULL
        OR pastoral_zone IN ('未設定', '未設定牧區', '未分類')
    )
  )
  INTO result;

  RETURN result;
END;
$get_pastoral_zone_leaderboard$;

REVOKE ALL ON FUNCTION public.get_pastoral_zone_leaderboard(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pastoral_zone_leaderboard(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pastoral_zone_leaderboard(UUID, UUID) IS
  'Returns plan-specific pastoral-zone aggregates to authenticated users without member identities.';
