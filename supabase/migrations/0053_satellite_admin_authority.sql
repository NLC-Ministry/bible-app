-- Map the Member Hub role created specifically for this satellite application
-- onto the existing local admin UUID. Keeping one local authorization code
-- means every existing RLS policy, RPC guard, Edge Function check, and frontend
-- admin surface continues to use role_definition.code = 'admin'.
UPDATE public.role_definitions
SET hub_permission_keys = (
  SELECT ARRAY(
    SELECT DISTINCT permission_key
    FROM UNNEST(
      COALESCE(role_definitions.hub_permission_keys, ARRAY[]::TEXT[])
      || ARRAY['satellite_admin']::TEXT[]
    ) AS permission_key
    ORDER BY permission_key
  )
)
WHERE code = 'admin';

DO $satellite_admin_mapping$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_definitions
    WHERE code = 'admin'
      AND 'satellite_admin' = ANY(hub_permission_keys)
  ) THEN
    RAISE EXCEPTION 'satellite_admin_mapping_failed';
  END IF;
END;
$satellite_admin_mapping$;

-- Replace the registration report function from 0052. Profiles no longer have
-- the legacy text role column after migration 0048; authorization must resolve
-- through the immutable role UUID.
CREATE OR REPLACE FUNCTION public.get_admin_registration_statistics(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_registration_statistics$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  plan_name TEXT;
  pastoral_zones_json JSONB;
  great_regions_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT public.role_code(profile.role_id)
  INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  IF actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'registration_statistics_admin_required';
  END IF;

  SELECT plan.name INTO plan_name
  FROM public.global_plans AS plan
  WHERE plan.id = p_global_plan_id;

  IF plan_name IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  WITH eligible_profiles AS (
    SELECT
      profile.id,
      COALESCE(NULLIF(BTRIM(profile.pastoral_zone), ''), '未設定牧區') AS label
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
      AND profile.is_demo = FALSE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count
      )
      ORDER BY CASE WHEN label = '未設定牧區' THEN 1 ELSE 0 END, label
    ),
    '[]'::JSONB
  )
  INTO pastoral_zones_json
  FROM rollup;

  WITH eligible_profiles AS (
    SELECT
      profile.id,
      COALESCE(NULLIF(BTRIM(profile.great_region), ''), '未設定') AS label
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
      AND profile.is_demo = FALSE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count
      )
      ORDER BY CASE WHEN label = '未設定' THEN 1 ELSE 0 END, label
    ),
    '[]'::JSONB
  )
  INTO great_regions_json
  FROM rollup;

  RETURN JSONB_BUILD_OBJECT(
    'planId', p_global_plan_id,
    'planName', plan_name,
    'pastoralZones', pastoral_zones_json,
    'greatRegions', great_regions_json
  );
END;
$admin_registration_statistics$;

REVOKE ALL ON FUNCTION public.get_admin_registration_statistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_registration_statistics(UUID, UUID) TO authenticated, service_role;
