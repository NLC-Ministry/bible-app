-- Keep plan-management team visibility limited to administrators and pastoral-zone leaders.
-- A visible team still only needs one member inside the manager scope.
-- This replaces the prior function so small-group leaders no longer have plan-management access.
--
-- Let pastoral leaders see every complete team that contains at least one
-- member in their managed scope. Team visibility must never depend on captain placement.
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
  actor_profile public.profiles%ROWTYPE;
  plans_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;

  IF actor_profile.id IS NULL
     OR actor_profile.role NOT IN ('admin', 'great_zone_leader', 'zone_leader') THEN
    RAISE EXCEPTION 'team_statistics_management_scope_required';
  END IF;

  WITH member_details AS (
    SELECT
      team.id AS team_id,
      membership.user_id,
      membership.member_role,
      membership.joined_at,
      profile.name,
      NULLIF(BTRIM(profile.great_region), '') AS great_region,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone,
      NULLIF(BTRIM(profile.small_group), '') AS small_group
    FROM public.reading_teams AS team
    JOIN public.reading_team_members AS membership ON membership.team_id = team.id
    JOIN public.profiles AS profile ON profile.id = membership.user_id
  ), visible_team_ids AS (
    SELECT DISTINCT member.team_id
    FROM member_details AS member
    WHERE actor_profile.role = 'admin'
       OR (
         actor_profile.role = 'great_zone_leader'
         AND EXISTS (
           SELECT 1
           FROM UNNEST(STRING_TO_ARRAY(COALESCE(member.great_region, ''), ',')) AS member_scope(value)
           JOIN UNNEST(STRING_TO_ARRAY(
             COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ','
           )) AS actor_scope(value)
             ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
           WHERE BTRIM(member_scope.value) <> ''
         )
       )
       OR (
         actor_profile.role = 'zone_leader'
         AND EXISTS (
           SELECT 1
           FROM UNNEST(STRING_TO_ARRAY(COALESCE(member.pastoral_zone, ''), ',')) AS member_scope(value)
           JOIN UNNEST(STRING_TO_ARRAY(
             COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ','
           )) AS actor_scope(value)
             ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
           WHERE BTRIM(member_scope.value) <> ''
         )
       )

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
            'greatRegion', member.great_region,
            'pastoralZone', member.pastoral_zone,
            'smallGroup', member.small_group,
            'joinedAt', member.joined_at
          )
          ORDER BY CASE WHEN member.member_role = 'captain' THEN 0 ELSE 1 END, member.joined_at
        ) FILTER (WHERE member.user_id IS NOT NULL),
        '[]'::JSONB
      ) AS members
    FROM visible_team_ids AS visible
    JOIN public.reading_teams AS team ON team.id = visible.team_id
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
      'teamCount', (
        SELECT COALESCE(SUM((plan_item->>'teamCount')::INTEGER), 0)
        FROM JSONB_ARRAY_ELEMENTS(plans_json) AS plan_item
      ),
      'memberCount', (
        SELECT COALESCE(SUM((plan_item->>'memberCount')::INTEGER), 0)
        FROM JSONB_ARRAY_ELEMENTS(plans_json) AS plan_item
      )
    ),
    'plans', plans_json
  );
END;
$reading_team_registration_overview$;

REVOKE ALL ON FUNCTION public.get_reading_team_registration_overview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_registration_overview(UUID) TO authenticated, service_role;
