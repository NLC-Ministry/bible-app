-- Migration 0074: Include great_region/small_group on team members
--
-- get_reading_team_registration_overview only ever selected pastoral_zone
-- for each team member (member_details CTE), never great_region or
-- small_group. js/modules/admin.js's teamMatchesManagementOrgFilter() reads
-- member.greatRegion/member.smallGroup when the admin's shared 查看範圍
-- filter is set to 大區 or 小組 — since those fields were always undefined,
-- every team member failed that check and the 3人/6人團隊報名狀況 panels
-- silently showed zero teams whenever filtering by region or group (only
-- filtering by 牧區 could ever match, since pastoralZone was the only field
-- actually populated).

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
  actor_role TEXT;
  plans_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;

  actor_role := public.role_code(actor_profile.role_id);

  IF actor_profile.id IS NULL
     OR actor_role NOT IN ('admin', 'senior_pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'team_statistics_management_scope_required';
  END IF;

  WITH member_details AS (
    SELECT
      tm.team_id,
      tm.member_role,
      tm.division,
      p.id AS user_id,
      p.name,
      p.great_region,
      p.pastoral_zone,
      p.small_group
    FROM public.reading_team_members tm
    JOIN public.profiles p ON p.id = tm.user_id
  ),
  team_details AS (
    SELECT
      rt.id AS team_id,
      rt.global_plan_id,
      rt.name AS team_name,
      rt.division,
      rt.status,
      rt.created_at,
      c.pastoral_zone AS captain_pastoral_zone,
      (
        SELECT COALESCE(JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'userId', md.user_id,
            'role', md.member_role,
            'name', md.name,
            'greatRegion', md.great_region,
            'pastoralZone', md.pastoral_zone,
            'smallGroup', md.small_group
          )
        ), '[]'::JSONB)
        FROM member_details md
        WHERE md.team_id = rt.id
      ) AS members,
      (
        SELECT COUNT(*)::INT
        FROM member_details md
        WHERE md.team_id = rt.id
      ) AS member_count
    FROM public.reading_teams rt
    LEFT JOIN public.profiles c ON c.id = rt.captain_id
  ),
  scoped_teams AS (
    SELECT DISTINCT td.*
    FROM team_details td
    JOIN member_details md ON md.team_id = td.team_id
    WHERE actor_role IN ('admin', 'senior_pastor')
       OR (actor_role = 'great_zone_leader' AND public.values_overlap(md.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
       OR (actor_role = 'zone_leader' AND public.values_overlap(md.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
       OR (actor_role = 'group_leader' AND public.values_overlap(md.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
  ),
  plan_aggregates AS (
    SELECT
      gp.id AS plan_id,
      gp.name AS plan_name,
      gp.start_date,
      gp.end_date,
      COUNT(DISTINCT st.team_id)::INT AS team_count,
      COALESCE(SUM(st.member_count), 0)::INT AS member_count,
      COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', st.team_id,
          'name', st.team_name,
          'division', st.division,
          'status', st.status,
          'createdAt', st.created_at,
          'captainPastoralZone', st.captain_pastoral_zone,
          'memberCount', st.member_count,
          'members', st.members
        )
      ) FILTER (WHERE st.team_id IS NOT NULL), '[]'::JSONB) AS teams
    FROM public.global_plans gp
    LEFT JOIN scoped_teams st ON st.global_plan_id = gp.id
    WHERE gp.is_hidden = FALSE OR gp.plan_kind = 'church_campaign_stage'
    GROUP BY gp.id, gp.name, gp.start_date, gp.end_date
  )
  SELECT COALESCE(JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', pa.plan_id,
      'name', pa.plan_name,
      'startDate', pa.start_date,
      'endDate', pa.end_date,
      'teamCount', pa.team_count,
      'memberCount', pa.member_count,
      'teams', pa.teams
    )
  ), '[]'::JSONB)
  INTO plans_json
  FROM plan_aggregates pa;

  RETURN JSONB_BUILD_OBJECT(
    'summary', JSONB_BUILD_OBJECT(
      'planCount', JSONB_ARRAY_LENGTH(plans_json),
      'teamCount', (SELECT COALESCE(SUM((p->>'teamCount')::INT), 0) FROM JSONB_ARRAY_ELEMENTS(plans_json) p),
      'memberCount', (SELECT COALESCE(SUM((p->>'memberCount')::INT), 0) FROM JSONB_ARRAY_ELEMENTS(plans_json) p)
    ),
    'plans', plans_json
  );
END;
$reading_team_registration_overview$;

REVOKE ALL ON FUNCTION public.get_reading_team_registration_overview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_registration_overview(UUID) TO authenticated;
