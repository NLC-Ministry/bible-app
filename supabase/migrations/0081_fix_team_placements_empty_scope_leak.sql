-- Fix: get_admin_member_team_placements ("尚未加入團隊的人員" in 計畫管理) leaked
-- every active member to a great_zone_leader/zone_leader/group_leader whose
-- OWN org placement was empty — most commonly right after first login,
-- before Member Hub's org-placement sync has landed on their profile.
--
-- The three scope branches used `CARDINALITY(managed_x_arr) = 0 OR
-- candidate.field = ANY(managed_x_arr)`. managed_x_arr is built from
-- COALESCE(NULLIF(actor_profile.managed_x, ''), actor_profile.<personal_field>, '')
-- (migration 0054's fix for the managed-scope COALESCE trap), so it is only
-- ever empty in two cases: (a) the leader manages no explicit delegated
-- scope AND their own personal region/zone/group is also blank — i.e. not
-- yet synced or genuinely misconfigured — or (b) same thing, just stated
-- differently. There is no case where an empty array legitimately means
-- "this leader should see the whole church" — every other RPC (see
-- get_reading_team_registration_overview / get_joined_plan_members, which
-- use public.values_overlap()) already fails CLOSED on an empty scope
-- (values_overlap('anything', '') = FALSE, since string_to_array('', ',')
-- is {} and the join has no rows to match). This function is the only one
-- that had the inverted, fail-OPEN `CARDINALITY(...) = 0 OR` bypass.
--
-- Removing the bypass makes an empty scope match nothing (candidate.field =
-- ANY('{}') is always FALSE) instead of everything, consistent with every
-- other scoped RPC in this schema and with this function's own stated
-- purpose ("within their authorized managed scopes").
CREATE OR REPLACE FUNCTION public.get_admin_member_team_placements(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_admin_member_team_placements$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  managed_regions_arr TEXT[];
  managed_zones_arr TEXT[];
  managed_groups_arr TEXT[];
  results_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_identity_not_found';
  END IF;

  actor_role := public.role_code(actor_profile.role_id);
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;

  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  -- Prepare delegated managed scopes arrays
  managed_regions_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_zones_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_groups_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'profileId', candidate.id,
        'name', candidate.name,
        'email', candidate.email,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'isJoined', (membership.user_id IS NOT NULL),
        'teamId', team.id,
        'teamName', team.name,
        'division', membership.division,
        'memberRole', membership.member_role,
        'memberCount', (
          SELECT COUNT(*)
          FROM public.reading_team_members AS tm
          WHERE tm.team_id = team.id
        )
      )
      ORDER BY candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO results_json
  FROM public.profiles AS candidate
  LEFT JOIN public.reading_team_members AS membership
    ON membership.user_id = candidate.id
   AND membership.global_plan_id = target_plan.id
  LEFT JOIN public.reading_teams AS team
    ON team.id = membership.team_id
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND (
      actor_role IN ('admin', 'pastor')
      OR (actor_role = 'great_zone_leader' AND candidate.great_region = ANY(managed_regions_arr))
      OR (actor_role = 'zone_leader' AND candidate.pastoral_zone = ANY(managed_zones_arr))
      OR (actor_role = 'group_leader' AND candidate.small_group = ANY(managed_groups_arr))
    );

  RETURN results_json;
END;
$get_admin_member_team_placements$;

REVOKE ALL ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) TO authenticated, service_role;
