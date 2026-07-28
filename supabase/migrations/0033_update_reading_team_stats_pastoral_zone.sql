-- Update get_reading_team_statistics to include pastoral_zone of members
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
  SELECT role INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role <> 'admin' THEN
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
      SELECT COUNT(*) FILTER (WHERE log.round = COALESCE(plan.current_round, 1))::INTEGER AS chapters_read,
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
