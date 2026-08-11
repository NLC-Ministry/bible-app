-- Add 3-person / 6-person reading-team join counts to the admin registration
-- report, per great region and per pastoral zone (current def: migration 0055).
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
  summary_json JSONB;
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
      NULLIF(BTRIM(profile.pastoral_zone), '') IS NOT NULL AS has_pastoral_zone
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
      AND profile.is_demo = FALSE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  )
  SELECT JSONB_BUILD_OBJECT(
    'withoutPastoralZoneNotJoined', COUNT(*) FILTER (
      WHERE NOT profile.has_pastoral_zone AND signup.user_id IS NULL
    )::INTEGER,
    'withoutPastoralZoneJoined', COUNT(*) FILTER (
      WHERE NOT profile.has_pastoral_zone AND signup.user_id IS NOT NULL
    )::INTEGER,
    'withPastoralZoneNotJoined', COUNT(*) FILTER (
      WHERE profile.has_pastoral_zone AND signup.user_id IS NULL
    )::INTEGER,
    'withPastoralZoneJoined', COUNT(*) FILTER (
      WHERE profile.has_pastoral_zone AND signup.user_id IS NOT NULL
    )::INTEGER,
    'totalJoined', COUNT(signup.user_id)::INTEGER,
    'totalRegistered', COUNT(*)::INTEGER
  )
  INTO summary_json
  FROM eligible_profiles AS profile
  LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id;

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
  ), team_memberships AS (
    -- A user can join at most one team per plan (UNIQUE(global_plan_id, user_id)
    -- on reading_team_members), so the two division filters below never overlap.
    SELECT tm.user_id, rt.division
    FROM public.reading_team_members AS tm
    JOIN public.reading_teams AS rt ON rt.id = tm.team_id
    WHERE tm.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count,
      COUNT(team3.user_id)::INTEGER AS team3_count,
      COUNT(team6.user_id)::INTEGER AS team6_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    LEFT JOIN team_memberships AS team3 ON team3.user_id = profile.id AND team3.division = 3
    LEFT JOIN team_memberships AS team6 ON team6.user_id = profile.id AND team6.division = 6
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count,
        'team3Count', team3_count,
        'team6Count', team6_count
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
  ), team_memberships AS (
    SELECT tm.user_id, rt.division
    FROM public.reading_team_members AS tm
    JOIN public.reading_teams AS rt ON rt.id = tm.team_id
    WHERE tm.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count,
      COUNT(team3.user_id)::INTEGER AS team3_count,
      COUNT(team6.user_id)::INTEGER AS team6_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    LEFT JOIN team_memberships AS team3 ON team3.user_id = profile.id AND team3.division = 3
    LEFT JOIN team_memberships AS team6 ON team6.user_id = profile.id AND team6.division = 6
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count,
        'team3Count', team3_count,
        'team6Count', team6_count
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
    'summary', summary_json,
    'pastoralZones', pastoral_zones_json,
    'greatRegions', great_regions_json
  );
END;
$admin_registration_statistics$;

REVOKE ALL ON FUNCTION public.get_admin_registration_statistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_registration_statistics(UUID, UUID) TO authenticated, service_role;
