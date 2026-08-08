-- Migration 0073: Get Joined Plan Members
-- Companion to get_unjoined_plan_members (migration 0045) for the new
-- "已加入計畫" admin tab — same scoped roster, inverted join condition.
--
-- Written against the current role model rather than copying 0045's
-- original checks: role_code(role_id) + the full management role list
-- (admin/senior_pastor/great_zone_leader/zone_leader/group_leader),
-- matching canManagePlans() in nlc-data, and public.values_overlap()
-- (migration 0070) for scope matching so group_leader is scoped by
-- small_group directly in SQL (0045 only ever handled great_zone_leader/
-- zone_leader in its RPC — group_leader support existed only in the
-- client-side JS fallback).

CREATE OR REPLACE FUNCTION public.get_joined_plan_members(
  p_global_plan_id UUID,
  p_plan_key TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_joined_plan_members$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  members_json JSONB;
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

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', candidate.id,
        'name', candidate.name,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'joinedAt', joined_plan.created_at,
        'currentRound', COALESCE(joined_plan.current_round, 1)
      )
      ORDER BY candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO members_json
  FROM public.profiles AS candidate
  JOIN public.reading_plans AS joined_plan
    ON joined_plan.user_id = candidate.id
   AND (
     joined_plan.global_plan_id = target_plan.id
     OR (
       NULLIF(BTRIM(p_plan_key), '') IS NOT NULL
       AND joined_plan.preset_key = BTRIM(p_plan_key)
     )
   )
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND candidate.id <> actor_id
    AND (
      actor_role IN ('admin', 'senior_pastor')
      OR (actor_role = 'great_zone_leader' AND public.values_overlap(candidate.great_region, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
      OR (actor_role = 'zone_leader' AND public.values_overlap(candidate.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
      OR (actor_role = 'group_leader' AND public.values_overlap(candidate.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
    );

  RETURN JSONB_BUILD_OBJECT(
    'planId', target_plan.id,
    'planName', target_plan.name,
    'members', members_json
  );
END;
$get_joined_plan_members$;

REVOKE ALL ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) TO authenticated, service_role;
