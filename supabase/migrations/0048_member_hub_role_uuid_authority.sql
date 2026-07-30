-- Phase 2: Member Hub is the only authority for application role assignments.
-- Profiles keep only an immutable UUID relationship; labels and authorization
-- capabilities are resolved through role_definitions.

ALTER TABLE public.role_definitions
  ADD COLUMN IF NOT EXISTS hub_permission_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS hub_permission_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE public.role_definitions
SET
  is_assignable = FALSE,
  hub_permission_keys = CASE code
    WHEN 'member' THEN ARRAY['member']::TEXT[]
    WHEN 'group_leader' THEN ARRAY['group_leader', 'small_group_leader']::TEXT[]
    WHEN 'zone_leader' THEN ARRAY['zone_leader', 'pastoral_zone_leader']::TEXT[]
    WHEN 'great_zone_leader' THEN ARRAY['great_zone_leader', 'great_region_leader']::TEXT[]
    WHEN 'senior_pastor' THEN ARRAY['senior_pastor', 'church_pastor']::TEXT[]
    WHEN 'admin' THEN ARRAY['admin', 'system_admin', 'system_administrator']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END,
  hub_permission_labels = CASE code
    WHEN 'member' THEN ARRAY['一般會友', '一般組員', '組員', '會友']::TEXT[]
    WHEN 'group_leader' THEN ARRAY['小組長']::TEXT[]
    WHEN 'zone_leader' THEN ARRAY['牧區長', '區長']::TEXT[]
    WHEN 'great_zone_leader' THEN ARRAY['大區長']::TEXT[]
    WHEN 'senior_pastor' THEN ARRAY['主任牧師', '教會牧者']::TEXT[]
    WHEN 'admin' THEN ARRAY['系統管理員', '管理員']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

COMMENT ON COLUMN public.role_definitions.hub_permission_keys IS
  'Stable Member Hub leadership identity keys that map to this application role UUID.';
COMMENT ON COLUMN public.role_definitions.hub_permission_labels IS
  'Fallback Member Hub display labels; identity keys take precedence when available.';
COMMENT ON COLUMN public.role_definitions.is_assignable IS
  'Always false for local clients. Role assignments are controlled by Member Hub labels.';

CREATE OR REPLACE FUNCTION public.role_code(target_role_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT definition.code
  FROM public.role_definitions AS definition
  WHERE definition.id = target_role_id;
$$;

CREATE OR REPLACE FUNCTION public.current_role_code()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.role_code(profile.role_id), 'member')
  FROM public.profiles AS profile
  WHERE profile.id = public.current_profile_id();
$$;

REVOKE ALL ON FUNCTION public.role_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.role_code(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_role_code() TO authenticated, service_role;

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
AS $$
  SELECT COALESCE(public.role_code(profile.role_id), 'member'),
         profile.great_region,
         profile.pastoral_zone,
         profile.small_group
  FROM public.profiles AS profile
  WHERE profile.id = public.current_profile_id();
$$;

-- Member Hub synchronization runs with the service role. Authenticated app
-- clients, including administrators, cannot create or change role assignments.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;

  SELECT profile.id, public.role_code(profile.role_id)
  INTO actor_id, actor_role
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
       OR NEW.nlc_member_id IS DISTINCT FROM OLD.nlc_member_id THEN
      RAISE EXCEPTION 'privileged profile fields can only be changed by an administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_org_placement_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  SELECT public.role_code(profile.role_id) INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.auth_user_id = auth.uid()
  LIMIT 1;
  IF actor_role = 'admin' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.great_region, '') <> ''
       OR COALESCE(NEW.pastoral_zone, '') <> ''
       OR COALESCE(NEW.small_group, '') <> ''
       OR NEW.great_region_id IS NOT NULL
       OR NEW.pastoral_zone_id IS NOT NULL
       OR NEW.small_group_id IS NOT NULL THEN
      RAISE EXCEPTION 'org placement fields are managed by Member Hub' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.great_region IS DISTINCT FROM OLD.great_region
       OR NEW.pastoral_zone IS DISTINCT FROM OLD.pastoral_zone
       OR NEW.small_group IS DISTINCT FROM OLD.small_group
       OR NEW.great_region_id IS DISTINCT FROM OLD.great_region_id
       OR NEW.pastoral_zone_id IS DISTINCT FROM OLD.pastoral_zone_id
       OR NEW.small_group_id IS DISTINCT FROM OLD.small_group_id THEN
      RAISE EXCEPTION 'org placement fields are managed by Member Hub' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_send_care_reminder(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
          AND recipient.great_region = ANY(string_to_array(sender.great_region, ','))
        )
        OR (
          public.role_code(sender.role_id) = 'zone_leader'
          AND recipient.pastoral_zone = ANY(string_to_array(sender.pastoral_zone, ','))
        )
        OR (
          public.role_code(sender.role_id) = 'group_leader'
          AND recipient.pastoral_zone = ANY(string_to_array(sender.pastoral_zone, ','))
          AND recipient.small_group = ANY(string_to_array(sender.small_group, ','))
        )
      )
  );
$$;

-- Replace the remaining active RPC role reads with UUID-derived role codes.
DO $$
DECLARE
  target_signature REGPROCEDURE;
  original_definition TEXT;
  updated_definition TEXT;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.get_reading_team_registration_overview(uuid)'::REGPROCEDURE,
    'public.get_unjoined_plan_members(uuid,text,uuid)'::REGPROCEDURE,
    'public.send_plan_join_invitation(uuid,uuid,text,uuid)'::REGPROCEDURE
  ] LOOP
    SELECT pg_get_functiondef(target_signature::OID) INTO original_definition;
    updated_definition := REPLACE(
      original_definition,
      'actor_profile public.profiles%ROWTYPE;',
      'actor_profile RECORD;'
    );
    updated_definition := REPLACE(
      updated_definition,
      'SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;',
      'SELECT profile.*, public.role_code(profile.role_id) AS role_code INTO actor_profile FROM public.profiles AS profile WHERE profile.id = actor_id;'
    );
    updated_definition := REPLACE(updated_definition, 'actor_profile.role', 'actor_profile.role_code');
    IF updated_definition = original_definition
       OR POSITION('actor_profile.role_code' IN updated_definition) = 0 THEN
      RAISE EXCEPTION 'role UUID rewrite failed for %', target_signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;

DO $$
DECLARE
  target_signature REGPROCEDURE;
  original_definition TEXT;
  updated_definition TEXT;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.publish_global_plan_rules(uuid,integer,jsonb,uuid)'::REGPROCEDURE,
    'public.get_reading_team_statistics(uuid,uuid)'::REGPROCEDURE
  ] LOOP
    SELECT pg_get_functiondef(target_signature::OID) INTO original_definition;
    updated_definition := REPLACE(
      original_definition,
      'SELECT role INTO caller_role FROM public.profiles WHERE id = actor_id;',
      'SELECT public.role_code(role_id) INTO caller_role FROM public.profiles WHERE id = actor_id;'
    );
    updated_definition := REPLACE(
      updated_definition,
      'SELECT role INTO actor_role FROM public.profiles WHERE id = actor_id;',
      'SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;'
    );
    IF target_signature = 'public.get_reading_team_statistics(uuid,uuid)'::REGPROCEDURE THEN
      updated_definition := REPLACE(
        updated_definition,
        'IF actor_role <> ''admin'' THEN',
        'IF actor_role NOT IN (''admin'', ''senior_pastor'') THEN'
      );
    END IF;
    IF updated_definition = original_definition THEN
      RAISE EXCEPTION 'role UUID rewrite failed for %', target_signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;

-- Rebuild policies that used the removed text column directly.
DROP POLICY IF EXISTS devotional_notes_select_group ON public.devotional_notes;
CREATE POLICY devotional_notes_select_group ON public.devotional_notes FOR SELECT TO authenticated USING (
  public.is_feature_enabled('pastoral_sharing_wall')
  AND (
    user_id = public.current_profile_id()
    OR public.current_role_code() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p1.pastoral_zone = p2.pastoral_zone AND p1.small_group = p2.small_group
      WHERE p1.id = user_id AND p2.id = public.current_profile_id()
    )
  )
);

DROP POLICY IF EXISTS devotional_likes_select_group ON public.devotional_likes;
CREATE POLICY devotional_likes_select_group ON public.devotional_likes FOR SELECT TO authenticated USING (
  public.is_feature_enabled('pastoral_sharing_wall')
  AND (
    user_id = public.current_profile_id()
    OR public.current_role_code() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p1.pastoral_zone = p2.pastoral_zone AND p1.small_group = p2.small_group
      WHERE p1.id = user_id AND p2.id = public.current_profile_id()
    )
  )
);

DROP POLICY IF EXISTS devotional_comments_select_group ON public.devotional_comments;
CREATE POLICY devotional_comments_select_group ON public.devotional_comments FOR SELECT TO authenticated USING (
  public.is_feature_enabled('pastoral_sharing_wall')
  AND (
    user_id = public.current_profile_id()
    OR public.current_role_code() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p1.pastoral_zone = p2.pastoral_zone AND p1.small_group = p2.small_group
      WHERE p1.id = user_id AND p2.id = public.current_profile_id()
    )
  )
);

DROP POLICY IF EXISTS "Only admins can select reports" ON public.issue_reports;
CREATE POLICY "Only admins can select reports" ON public.issue_reports
  FOR SELECT TO authenticated USING (public.current_role_code() = 'admin');
DROP POLICY IF EXISTS "Only admins can delete reports" ON public.issue_reports;
CREATE POLICY "Only admins can delete reports" ON public.issue_reports
  FOR DELETE TO authenticated USING (public.current_role_code() = 'admin');

-- Views expose role UUID, stable code, and mutable label without retaining a
-- second role value on profiles.
DROP VIEW IF EXISTS public.profile_identity_overview;
DROP VIEW IF EXISTS public.member_reading_summary;

CREATE VIEW public.profile_identity_overview AS
SELECT
  profile.id AS profile_id,
  profile.name,
  profile.email,
  profile.role_id,
  definition.code AS role_code,
  definition.label AS role_label,
  profile.pastoral_zone,
  profile.small_group,
  identity.provider,
  identity.provider_user_id,
  identity.email AS identity_email,
  identity.is_primary,
  identity.last_seen_at,
  profile.created_at AS profile_created_at
FROM public.profiles AS profile
JOIN public.role_definitions AS definition ON definition.id = profile.role_id
LEFT JOIN public.user_identities AS identity ON identity.profile_id = profile.id;

CREATE VIEW public.member_reading_summary AS
SELECT
  profile.id AS user_id,
  profile.name,
  profile.role_id,
  definition.code AS role_code,
  definition.label AS role_label,
  profile.great_region,
  profile.pastoral_zone,
  profile.small_group,
  COUNT(DISTINCT plan.id) AS plan_count,
  COUNT(log.id) AS log_count,
  MAX(log.read_at) AS last_read_at
FROM public.profiles AS profile
JOIN public.role_definitions AS definition ON definition.id = profile.role_id
LEFT JOIN public.reading_plans AS plan ON plan.user_id = profile.id
LEFT JOIN public.reading_logs AS log ON log.user_id = profile.id
WHERE profile.is_demo = FALSE
GROUP BY profile.id, profile.name, profile.role_id, definition.code, definition.label,
         profile.great_region, profile.pastoral_zone, profile.small_group;

GRANT SELECT ON public.profile_identity_overview TO authenticated;
GRANT SELECT ON public.member_reading_summary TO authenticated;

DROP TRIGGER IF EXISTS trg_profiles_sync_role_reference ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_role_reference();
DROP TRIGGER IF EXISTS trg_prevent_group_leader_assignment ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_group_leader_assignment();
DROP INDEX IF EXISTS public.idx_profiles_role;

ALTER TABLE public.profiles DROP COLUMN role;

COMMENT ON COLUMN public.profiles.role_id IS
  'Only role assignment. UUID is synchronized from Member Hub permission labels and references role_definitions.';
COMMENT ON COLUMN public.profiles.member_context_leadership_assignments IS
  'Authoritative Member Hub leadership identity projection used to resolve role_id.';