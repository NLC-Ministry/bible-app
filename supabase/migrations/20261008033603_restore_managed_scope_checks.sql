-- Restore the two set_profile_managed_scopes checks lost in 0065 (#459)
--
-- 0054 rejected organization names that do not exist and kept only the
-- scope column matching the target's Member Hub role. 0065 rewrote the
-- function to add p_actor_id and dropped both blocks; 0067/0068/0174 kept
-- that version. This is 0174's definition (actor_override_forbidden guard,
-- '' instead of NULL) with 0054's two checks put back.
--
-- No ordering requirement; signature unchanged, so js/db.js and nlc-data
-- need no change.

CREATE OR REPLACE FUNCTION public.set_profile_managed_scopes(
  p_profile_id UUID,
  p_managed_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_managed_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_managed_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $set_profile_managed_scopes$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  target_role TEXT;
  normalized_regions TEXT[];
  normalized_zones TEXT[];
  normalized_groups TEXT[];
BEGIN
  IF p_actor_id IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'actor_override_forbidden';
  END IF;

  actor_id := COALESCE(p_actor_id, public.current_profile_id());

  IF auth.role() <> 'service_role' THEN
    SELECT public.role_code(profile.role_id)
    INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = actor_id;

    IF actor_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'managed_scope_admin_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT public.role_code(profile.role_id)
  INTO target_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'managed_scope_profile_not_found';
  END IF;

  SELECT COALESCE(ARRAY_AGG(scope ORDER BY scope), ARRAY[]::TEXT[])
  INTO normalized_regions
  FROM (
    SELECT DISTINCT BTRIM(value) AS scope
    FROM UNNEST(COALESCE(p_managed_regions, ARRAY[]::TEXT[])) AS requested_value(value)
    WHERE BTRIM(value) <> ''
  ) AS normalized;

  SELECT COALESCE(ARRAY_AGG(scope ORDER BY scope), ARRAY[]::TEXT[])
  INTO normalized_zones
  FROM (
    SELECT DISTINCT BTRIM(value) AS scope
    FROM UNNEST(COALESCE(p_managed_zones, ARRAY[]::TEXT[])) AS requested_value(value)
    WHERE BTRIM(value) <> ''
  ) AS normalized;

  SELECT COALESCE(ARRAY_AGG(scope ORDER BY scope), ARRAY[]::TEXT[])
  INTO normalized_groups
  FROM (
    SELECT DISTINCT BTRIM(value) AS scope
    FROM UNNEST(COALESCE(p_managed_groups, ARRAY[]::TEXT[])) AS requested_value(value)
    WHERE BTRIM(value) <> ''
  ) AS normalized;

  IF EXISTS (
    SELECT 1 FROM UNNEST(normalized_regions) AS requested(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.great_regions AS region WHERE region.name = requested.name
    )
  ) THEN
    RAISE EXCEPTION 'managed_scope_unknown_region';
  END IF;

  IF EXISTS (
    SELECT 1 FROM UNNEST(normalized_zones) AS requested(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pastoral_zones AS zone WHERE zone.name = requested.name
    )
  ) THEN
    RAISE EXCEPTION 'managed_scope_unknown_zone';
  END IF;

  IF EXISTS (
    SELECT 1 FROM UNNEST(normalized_groups) AS requested(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.small_groups AS small_group WHERE small_group.name = requested.name
    )
  ) THEN
    RAISE EXCEPTION 'managed_scope_unknown_group';
  END IF;

  -- Only the column matching the Member Hub role is active. Clearing dormant
  -- columns prevents an old delegation from silently reappearing after a role change.
  IF target_role = 'great_zone_leader' THEN
    normalized_zones := ARRAY[]::TEXT[];
    normalized_groups := ARRAY[]::TEXT[];
  ELSIF target_role = 'zone_leader' THEN
    normalized_regions := ARRAY[]::TEXT[];
    normalized_groups := ARRAY[]::TEXT[];
  ELSIF target_role = 'group_leader' THEN
    normalized_regions := ARRAY[]::TEXT[];
    normalized_zones := ARRAY[]::TEXT[];
  ELSE
    normalized_regions := ARRAY[]::TEXT[];
    normalized_zones := ARRAY[]::TEXT[];
    normalized_groups := ARRAY[]::TEXT[];
  END IF;

  UPDATE public.profiles AS profile
  SET
    managed_regions = ARRAY_TO_STRING(normalized_regions, ','),
    managed_zones = ARRAY_TO_STRING(normalized_zones, ','),
    managed_groups = ARRAY_TO_STRING(normalized_groups, ',')
  WHERE profile.id = p_profile_id;

  RETURN JSONB_BUILD_OBJECT(
    'profileId', p_profile_id,
    'roleCode', target_role,
    'managedRegions', normalized_regions,
    'managedZones', normalized_zones,
    'managedGroups', normalized_groups
  );
END;
$set_profile_managed_scopes$;

REVOKE ALL ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) TO authenticated, service_role;
