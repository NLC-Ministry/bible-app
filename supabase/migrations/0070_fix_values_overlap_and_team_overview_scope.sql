-- Migration 0070: Add the missing values_overlap() SQL helper and fix scope
-- comparisons in get_reading_team_registration_overview.
--
-- get_reading_team_registration_overview (migration 0066) calls
-- public.values_overlap(text, text), but no migration ever created that
-- function — every call to this RPC has been failing with 42883 ("function
-- public.values_overlap(text, text) does not exist") since 0066 shipped.
--
-- While recreating it, two more bugs in the same WHERE clause are fixed:
--   1. The old WHERE clause joined the actor's delegated scope and their
--      personal fallback field with the `||` string-concatenation operator,
--      not the COALESCE(NULLIF(...), ...) fallback pattern used everywhere
--      else in this schema (e.g. get_my_profile, can_send_care_reminder).
--      Once the delegated scope column held a value, that glued two
--      comma-separated lists together with no separator between them,
--      corrupting the boundary entry.
--   2. The group_leader branch compared the team member's pastoral_zone
--      against the actor's managed_groups/small_group — comparing a zone to
--      a group name. member_details never even selected small_group. This
--      made a group leader's team visibility silently always empty instead
--      of scoped to their group.

CREATE OR REPLACE FUNCTION public.values_overlap(left_values TEXT, right_values TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog, public
AS $values_overlap$
  SELECT EXISTS (
    SELECT 1
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(left_values, ''), ',')) AS left_value(value)
    JOIN UNNEST(STRING_TO_ARRAY(COALESCE(right_values, ''), ',')) AS right_value(value)
      ON BTRIM(left_value.value) <> ''
     AND BTRIM(left_value.value) = BTRIM(right_value.value)
  );
$values_overlap$;

REVOKE ALL ON FUNCTION public.values_overlap(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.values_overlap(TEXT, TEXT) TO authenticated, service_role;

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
            'pastoralZone', md.pastoral_zone
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
