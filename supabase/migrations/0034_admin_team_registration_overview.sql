-- Return the complete admin registration overview in one request. The query is
-- anchored on reading_teams so it never depends on a browser-side plan cache.
CREATE OR REPLACE FUNCTION public.get_reading_team_registration_overview(
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_registration_overview$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  plans_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT role INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role <> 'admin' THEN
    RAISE EXCEPTION 'team_statistics_admin_required';
  END IF;

  WITH member_details AS (
    SELECT
      team.id AS team_id,
      membership.user_id,
      membership.member_role,
      membership.joined_at,
      profile.name,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone
    FROM public.reading_teams AS team
    JOIN public.reading_team_members AS membership ON membership.team_id = team.id
    JOIN public.profiles AS profile ON profile.id = membership.user_id
  ), team_rollup AS (
    SELECT
      plan.id AS plan_id,
      plan.name AS plan_name,
      plan.start_date,
      plan.end_date,
      team.id,
      team.name,
      team.division,
      team.status,
      team.created_at,
      COUNT(member.user_id)::INTEGER AS member_count,
      MAX(member.pastoral_zone) FILTER (WHERE member.member_role = 'captain') AS captain_pastoral_zone,
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'userId', member.user_id,
            'name', member.name,
            'role', member.member_role,
            'pastoralZone', member.pastoral_zone,
            'joinedAt', member.joined_at
          )
          ORDER BY CASE WHEN member.member_role = 'captain' THEN 0 ELSE 1 END, member.joined_at
        ) FILTER (WHERE member.user_id IS NOT NULL),
        '[]'::JSONB
      ) AS members
    FROM public.reading_teams AS team
    JOIN public.global_plans AS plan ON plan.id = team.global_plan_id
    LEFT JOIN member_details AS member ON member.team_id = team.id
    GROUP BY plan.id, plan.name, plan.start_date, plan.end_date,
      team.id, team.name, team.division, team.status, team.created_at
  ), plan_rollup AS (
    SELECT
      plan_id,
      plan_name,
      start_date,
      end_date,
      COUNT(*)::INTEGER AS team_count,
      COALESCE(SUM(member_count), 0)::INTEGER AS member_count,
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'id', id,
            'name', name,
            'division', division,
            'status', status,
            'memberCount', member_count,
            'captainPastoralZone', captain_pastoral_zone,
            'createdAt', created_at,
            'members', members
          )
          ORDER BY division, created_at, name
        ),
        '[]'::JSONB
      ) AS teams
    FROM team_rollup
    GROUP BY plan_id, plan_name, start_date, end_date
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', plan_id,
        'name', plan_name,
        'startDate', start_date,
        'endDate', end_date,
        'teamCount', team_count,
        'memberCount', member_count,
        'teams', teams
      )
      ORDER BY start_date DESC, plan_name
    ),
    '[]'::JSONB
  ) INTO plans_json
  FROM plan_rollup;

  RETURN JSONB_BUILD_OBJECT(
    'summary', JSONB_BUILD_OBJECT(
      'planCount', JSONB_ARRAY_LENGTH(plans_json),
      'teamCount', (SELECT COUNT(*) FROM public.reading_teams),
      'memberCount', (SELECT COUNT(*) FROM public.reading_team_members)
    ),
    'plans', plans_json
  );
END;
$reading_team_registration_overview$;

REVOKE ALL ON FUNCTION public.get_reading_team_registration_overview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_registration_overview(UUID) TO authenticated, service_role;
