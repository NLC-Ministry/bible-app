-- Migration 0067: Fix set_profile_managed_scopes SECURITY DEFINER RPC to ensure seamless admin scope updates

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

  UPDATE public.profiles AS profile
  SET
    managed_regions = NULLIF(ARRAY_TO_STRING(normalized_regions, ','), ''),
    managed_zones = NULLIF(ARRAY_TO_STRING(normalized_zones, ','), ''),
    managed_groups = NULLIF(ARRAY_TO_STRING(normalized_groups, ','), '')
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

REVOKE ALL ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) TO authenticated;
