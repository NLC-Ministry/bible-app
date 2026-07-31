-- Separate Member Hub identity/role authority from this satellite app's
-- multi-value management scope. Personal placement remains in great_region,
-- pastoral_zone, and small_group; delegated scope remains in managed_*.

COMMENT ON COLUMN public.profiles.managed_regions IS
  'Comma-separated great-region names delegated by this application. Used only when the effective role has region scope.';
COMMENT ON COLUMN public.profiles.managed_zones IS
  'Comma-separated pastoral-zone names delegated by this application. Used only when the effective role has zone scope.';
COMMENT ON COLUMN public.profiles.managed_groups IS
  'Comma-separated small-group names delegated by this application. Used only when the effective role has group scope.';

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(
  my_role TEXT,
  my_great_region TEXT,
  my_pastoral_zone TEXT,
  my_small_group TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $get_my_profile$
  SELECT
    COALESCE(public.role_code(profile.role_id), 'member'),
    COALESCE(NULLIF(profile.managed_regions, ''), profile.great_region),
    COALESCE(NULLIF(profile.managed_zones, ''), profile.pastoral_zone),
    COALESCE(NULLIF(profile.managed_groups, ''), profile.small_group)
  FROM public.profiles AS profile
  WHERE profile.id = public.current_profile_id();
$get_my_profile$;

-- Role IDs and managed scopes are both privileged. Member Hub owns role_id;
-- only a local application administrator may change managed_*.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $protect_profile_privileged_fields$
DECLARE
  actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;

  SELECT public.role_code(profile.role_id)
  INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.auth_user_id = auth.uid()
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID THEN
      RAISE EXCEPTION 'role assignment is managed by Member Hub' USING ERRCODE = '42501';
    END IF;
    IF actor_role = 'admin' THEN RETURN NEW; END IF;
    IF NEW.is_demo <> FALSE
       OR NEW.is_active <> TRUE
       OR NEW.nlc_member_id IS NOT NULL
       OR COALESCE(NEW.managed_regions, '') <> ''
       OR COALESCE(NEW.managed_zones, '') <> ''
       OR COALESCE(NEW.managed_groups, '') <> ''
       OR (NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'privileged profile fields cannot be supplied by a member'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION 'role assignment is managed by Member Hub' USING ERRCODE = '42501';
    END IF;
    IF actor_role = 'admin' THEN RETURN NEW; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.nlc_member_id IS DISTINCT FROM OLD.nlc_member_id
       OR NEW.managed_regions IS DISTINCT FROM OLD.managed_regions
       OR NEW.managed_zones IS DISTINCT FROM OLD.managed_zones
       OR NEW.managed_groups IS DISTINCT FROM OLD.managed_groups THEN
      RAISE EXCEPTION 'privileged profile fields can only be changed by an administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$protect_profile_privileged_fields$;

CREATE OR REPLACE FUNCTION public.set_profile_managed_scopes(
  p_profile_id UUID,
  p_managed_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_managed_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_managed_groups TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $set_profile_managed_scopes$
DECLARE
  actor_role TEXT;
  target_role TEXT;
  normalized_regions TEXT[];
  normalized_zones TEXT[];
  normalized_groups TEXT[];
BEGIN
  SELECT public.role_code(profile.role_id)
  INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.id = public.current_profile_id();

  IF actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'managed_scope_admin_required' USING ERRCODE = '42501';
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

  UPDATE public.profiles
  SET
    managed_regions = ARRAY_TO_STRING(normalized_regions, ','),
    managed_zones = ARRAY_TO_STRING(normalized_zones, ','),
    managed_groups = ARRAY_TO_STRING(normalized_groups, ','),
    updated_at = NOW()
  WHERE id = p_profile_id;

  RETURN JSONB_BUILD_OBJECT(
    'profileId', p_profile_id,
    'roleCode', target_role,
    'managedRegions', normalized_regions,
    'managedZones', normalized_zones,
    'managedGroups', normalized_groups
  );
END;
$set_profile_managed_scopes$;

REVOKE ALL ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_managed_scopes(UUID, TEXT[], TEXT[], TEXT[]) TO authenticated;

DROP POLICY IF EXISTS profiles_select_by_scope ON public.profiles;
CREATE POLICY profiles_select_by_scope ON public.profiles FOR SELECT TO authenticated USING (
  id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
    AND great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
  )
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
    AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
  )
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
    AND small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
  )
);

DROP POLICY IF EXISTS reading_plans_select_by_scope ON public.reading_plans;
CREATE POLICY reading_plans_select_by_scope ON public.reading_plans FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = user_id
      AND (
        (
          (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
          AND profile.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
          AND profile.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
          AND profile.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
        )
      )
  )
);

DROP POLICY IF EXISTS reading_logs_select_by_scope ON public.reading_logs;
CREATE POLICY reading_logs_select_by_scope ON public.reading_logs FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = user_id
      AND (
        (
          (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
          AND profile.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
          AND profile.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
          AND profile.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
        )
      )
  )
);

CREATE OR REPLACE FUNCTION public.can_send_care_reminder(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $can_send_care_reminder$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS sender
    JOIN public.profiles AS recipient ON recipient.id = target_profile_id
    WHERE sender.id = public.current_profile_id()
      AND sender.id <> recipient.id
      AND recipient.is_active = TRUE
      AND (
        public.role_code(sender.role_id) IN ('admin', 'senior_pastor')
        OR (
          public.role_code(sender.role_id) = 'great_zone_leader'
          AND recipient.great_region = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_regions, ''), sender.great_region, ''), ','
          ))
        )
        OR (
          public.role_code(sender.role_id) = 'zone_leader'
          AND recipient.pastoral_zone = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_zones, ''), sender.pastoral_zone, ''), ','
          ))
        )
        OR (
          public.role_code(sender.role_id) = 'group_leader'
          AND recipient.small_group = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_groups, ''), sender.small_group, ''), ','
          ))
        )
      )
  );
$can_send_care_reminder$;
