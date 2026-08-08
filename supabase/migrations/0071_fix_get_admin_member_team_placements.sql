-- Migration 0071: Fix get_admin_member_team_placements crash and scope leak
--
-- Two bugs found while fixing the one the caller hit:
--
-- 1. (the reported crash) the old "isJoined" check read the id column off
--    the reading_team_members join alias, which has no `id` column at all
--    (its primary key is `(team_id, user_id)`, see migration 0019). Every
--    call failed with 42703. Fixed by checking that join alias's user_id
--    instead — an equivalent "did the LEFT JOIN find a match" test using a
--    column that actually exists on the table.
--
-- 2. (found while fixing #1, not yet reported by name) managed_regions /
--    managed_zones / managed_groups are `NOT NULL DEFAULT ''` (migration
--    0011) — they are empty strings, never actually SQL NULL, for anyone
--    who hasn't been explicitly delegated a scope. `COALESCE(managed_x, x,
--    '')` only replaces real NULLs, so it always returned '' and never fell
--    back to the personal great_region/pastoral_zone/small_group. The
--    resulting empty scope array then hit the `CARDINALITY(...) = 0 OR ...`
--    fallback in the WHERE clause, which treats "no explicit scope" as
--    "unrestricted" — so a great_zone_leader/zone_leader/group_leader who
--    was never given an explicit managed_* value saw every active member
--    church-wide in this admin team-placement view, not just their own
--    region/zone/group. Fixed with the same COALESCE(NULLIF(...), ...)
--    pattern already used for this exact fallback everywhere else in this
--    schema (get_my_profile, can_send_care_reminder, migration 0070).

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
  IF actor_role NOT IN ('admin', 'senior_pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
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
      actor_role IN ('admin', 'senior_pastor')
      OR (
        actor_role = 'great_zone_leader'
        AND (
          CARDINALITY(managed_regions_arr) = 0
          OR candidate.great_region = ANY(managed_regions_arr)
        )
      )
      OR (
        actor_role = 'zone_leader'
        AND (
          CARDINALITY(managed_zones_arr) = 0
          OR candidate.pastoral_zone = ANY(managed_zones_arr)
        )
      )
      OR (
        actor_role = 'group_leader'
        AND (
          CARDINALITY(managed_groups_arr) = 0
          OR candidate.small_group = ANY(managed_groups_arr)
        )
      )
    );

  RETURN results_json;
END;
$get_admin_member_team_placements$;

REVOKE ALL ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) TO authenticated, service_role;
