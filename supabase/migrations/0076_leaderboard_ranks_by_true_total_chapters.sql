-- Migration 0076: Rank 3-person/6-person teams by TRUE total chapters read
-- (all rounds combined), not just the current round.
--
-- get_reading_team_leaderboards and get_reading_team_statistics previously
-- only counted reading_logs where round = the member's current round, so a
-- member who had already finished a full pass and moved on to round 2 only
-- contributed their round-2 progress to the team's score — their entire
-- completed first round vanished from the ranking. Per explicit product
-- decision: re-reading a full round is real effort and must count, so the
-- ranking now sums every reading_logs row for the plan, across all rounds.
--
-- This intentionally departs from the "current-round only" fairness model
-- used elsewhere (e.g. the admin progress-status day-count comparison),
-- because here the requirement is a literal "who has read the most
-- chapters" leaderboard, not a same-lap race.

CREATE OR REPLACE FUNCTION public.get_reading_team_leaderboards(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_reading_team_leaderboards$
DECLARE
  actor_id UUID;
  leaderboards JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.global_plans AS plan
    WHERE plan.id = p_global_plan_id
      AND plan.plan_kind = 'church_campaign_stage'
  ) THEN
    RAISE EXCEPTION 'team_plan_not_found';
  END IF;

  WITH member_progress AS (
    SELECT
      team.id AS team_id,
      membership.user_id,
      membership.member_role,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone,
      COALESCE(progress.chapters_read, 0) AS chapters_read,
      progress.last_read_at
    FROM public.reading_teams AS team
    JOIN public.reading_team_members AS membership
      ON membership.team_id = team.id
     AND membership.global_plan_id = team.global_plan_id
     AND membership.division = team.division
    JOIN public.profiles AS profile ON profile.id = membership.user_id
    LEFT JOIN public.reading_plans AS plan
      ON plan.user_id = membership.user_id
     AND plan.global_plan_id = team.global_plan_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INTEGER AS chapters_read,
        MAX(reading_log.read_at) AS last_read_at
      FROM public.reading_logs AS reading_log
      WHERE reading_log.plan_id = plan.id
    ) AS progress ON TRUE
    WHERE team.global_plan_id = p_global_plan_id
  ), team_rollup AS (
    SELECT
      team.id,
      team.name,
      team.division,
      team.status,
      COUNT(member.user_id)::INTEGER AS member_count,
      COALESCE(SUM(member.chapters_read), 0)::INTEGER AS chapters_read,
      MAX(member.last_read_at) AS last_read_at,
      MAX(member.pastoral_zone) FILTER (WHERE member.member_role = 'captain') AS captain_pastoral_zone,
      COALESCE(BOOL_OR(member.user_id = actor_id), FALSE) AS is_mine
    FROM public.reading_teams AS team
    LEFT JOIN member_progress AS member ON member.team_id = team.id
    WHERE team.global_plan_id = p_global_plan_id
    GROUP BY team.id
  ), ranked_teams AS (
    SELECT
      team_rollup.*,
      RANK() OVER (
        PARTITION BY division
        ORDER BY chapters_read DESC, last_read_at ASC NULLS LAST
      )::INTEGER AS team_rank
    FROM team_rollup
  )
  SELECT jsonb_build_object(
    'division3', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'name', ranked.name,
          'division', ranked.division,
          'status', ranked.status,
          'memberCount', ranked.member_count,
          'chaptersRead', ranked.chapters_read,
          'lastReadAt', ranked.last_read_at,
          'rank', ranked.team_rank,
          'captainPastoralZone', ranked.captain_pastoral_zone,
          'isMine', ranked.is_mine
        )
        ORDER BY ranked.chapters_read DESC,
          ranked.last_read_at ASC NULLS LAST,
          ranked.name,
          ranked.id
      )
      FROM ranked_teams AS ranked
      WHERE ranked.division = 3
    ), '[]'::JSONB),
    'division6', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'name', ranked.name,
          'division', ranked.division,
          'status', ranked.status,
          'memberCount', ranked.member_count,
          'chaptersRead', ranked.chapters_read,
          'lastReadAt', ranked.last_read_at,
          'rank', ranked.team_rank,
          'captainPastoralZone', ranked.captain_pastoral_zone,
          'isMine', ranked.is_mine
        )
        ORDER BY ranked.chapters_read DESC,
          ranked.last_read_at ASC NULLS LAST,
          ranked.name,
          ranked.id
      )
      FROM ranked_teams AS ranked
      WHERE ranked.division = 6
    ), '[]'::JSONB)
  )
  INTO leaderboards;

  RETURN leaderboards;
END;
$get_reading_team_leaderboards$;

REVOKE ALL ON FUNCTION public.get_reading_team_leaderboards(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_leaderboards(UUID, UUID)
  TO authenticated, service_role;

-- Admin fallback (used when the RPC above hasn't rolled out yet, per
-- js/modules/plan.js's canUseAdminFallback path) gets the same fix.
CREATE OR REPLACE FUNCTION public.get_reading_team_statistics(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_statistics$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  teams_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'senior_pastor') THEN
    RAISE EXCEPTION 'team_statistics_admin_required';
  END IF;

  WITH member_progress AS (
    SELECT
      team.id AS team_id, membership.user_id, membership.member_role, membership.joined_at,
      profile.name, profile.pastoral_zone, COALESCE(plan.current_round, 1) AS current_round,
      COALESCE(progress.chapters_read, 0) AS chapters_read, progress.last_read_at
    FROM public.reading_teams team
    JOIN public.reading_team_members membership ON membership.team_id = team.id
    JOIN public.profiles profile ON profile.id = membership.user_id
    LEFT JOIN public.reading_plans plan
      ON plan.user_id = membership.user_id AND plan.global_plan_id = team.global_plan_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS chapters_read,
             MAX(log.read_at) AS last_read_at
      FROM public.reading_logs log WHERE log.plan_id = plan.id
    ) progress ON TRUE
    WHERE team.global_plan_id = p_global_plan_id
  ), team_rollup AS (
    SELECT team.id, team.name, team.division, team.status, team.created_at,
      COUNT(member.user_id)::INTEGER AS member_count,
      COALESCE(SUM(member.chapters_read), 0)::INTEGER AS chapters_read,
      MAX(member.last_read_at) AS last_read_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'userId', member.user_id, 'name', member.name, 'role', member.member_role,
        'pastoralZone', member.pastoral_zone,
        'currentRound', member.current_round, 'chaptersRead', member.chapters_read,
        'lastReadAt', member.last_read_at
      ) ORDER BY CASE WHEN member.member_role = 'captain' THEN 0 ELSE 1 END, member.joined_at)
      FILTER (WHERE member.user_id IS NOT NULL), '[]'::JSONB) AS members
    FROM public.reading_teams team
    LEFT JOIN member_progress member ON member.team_id = team.id
    WHERE team.global_plan_id = p_global_plan_id
    GROUP BY team.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'division', division, 'status', status,
    'memberCount', member_count, 'chaptersRead', chapters_read,
    'lastReadAt', last_read_at, 'members', members
  ) ORDER BY division, name), '[]'::JSONB) INTO teams_json FROM team_rollup;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'teamCount', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id),
      'readyTeamCount', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND status = 'ready'),
      'memberCount', (SELECT COUNT(*) FROM public.reading_team_members WHERE global_plan_id = p_global_plan_id),
      'division3Teams', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND division = 3),
      'division6Teams', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND division = 6)
    ),
    'teams', teams_json
  );
END;
$reading_team_statistics$;

REVOKE ALL ON FUNCTION public.get_reading_team_statistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_statistics(UUID, UUID) TO authenticated, service_role;

-- 牧區速度排行榜 (get_pastoral_zone_leaderboard, migration 0049) had the exact
-- same current-round-only bug — same fix applied here for consistency.
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
        COUNT(*)::INTEGER AS chapters_read,
        MAX(reading_log.read_at) AS last_read_at
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
  'Returns plan-specific pastoral-zone aggregates to authenticated users without member identities. Chapters read is summed across all rounds (true total).';
