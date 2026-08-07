-- Migration 0068: Fix set_profile_managed_scopes writing NULL into NOT NULL columns
--
-- profiles.managed_regions / managed_zones / managed_groups are
-- `NOT NULL DEFAULT ''` (migration 0011). Migration 0067 changed the UPDATE
-- to use NULLIF(ARRAY_TO_STRING(...), '') which turns an empty scope into
-- NULL, violating the NOT NULL constraint. Every call with an empty scope
-- array (e.g. the client-side managed-scope backfill in fetchManagedScopeProfiles)
-- has been failing with a not-null violation ever since. Revert to writing
-- '' for an empty scope, consistent with get_my_profile()'s
-- COALESCE(NULLIF(managed_regions, ''), great_region) sentinel semantics.

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

REVOKE ALL ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[], UUID) TO authenticated;

-- Repair any rows already corrupted by the NULL-writing bug (the write
-- itself always failed with a not-null violation, so in practice no rows
-- should have NULL here — this is a defensive no-op safety net).
UPDATE public.profiles
SET managed_regions = COALESCE(managed_regions, ''),
    managed_zones = COALESCE(managed_zones, ''),
    managed_groups = COALESCE(managed_groups, '')
WHERE managed_regions IS NULL OR managed_zones IS NULL OR managed_groups IS NULL;
