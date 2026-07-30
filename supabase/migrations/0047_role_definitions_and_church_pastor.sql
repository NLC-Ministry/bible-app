-- Canonical role definitions use immutable UUIDs. Labels may change without
-- changing profile relationships or the stable authorization code.
CREATE TABLE IF NOT EXISTS public.role_definitions (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_assignable BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_plans BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_permissions BOOLEAN NOT NULL DEFAULT FALSE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('self', 'group', 'zone', 'region', 'church'))
);

INSERT INTO public.role_definitions (
  id, code, label, sort_order, is_assignable,
  can_manage_plans, can_manage_permissions, scope_type
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'member', '一般會友', 60, TRUE, FALSE, FALSE, 'self'),
  ('10000000-0000-4000-8000-000000000002', 'group_leader', '小組長', 50, FALSE, FALSE, FALSE, 'group'),
  ('10000000-0000-4000-8000-000000000003', 'zone_leader', '牧區長', 40, TRUE, TRUE, FALSE, 'zone'),
  ('10000000-0000-4000-8000-000000000004', 'great_zone_leader', '大區長', 30, TRUE, TRUE, FALSE, 'region'),
  ('10000000-0000-4000-8000-000000000005', 'senior_pastor', '教會牧者', 20, TRUE, TRUE, FALSE, 'church'),
  ('10000000-0000-4000-8000-000000000006', 'admin', '系統管理員', 10, TRUE, TRUE, TRUE, 'church')
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_assignable = EXCLUDED.is_assignable,
  can_manage_plans = EXCLUDED.can_manage_plans,
  can_manage_permissions = EXCLUDED.can_manage_permissions,
  scope_type = EXCLUDED.scope_type;

ALTER TABLE public.role_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_definitions_read_authenticated ON public.role_definitions;
CREATE POLICY role_definitions_read_authenticated
  ON public.role_definitions FOR SELECT TO authenticated USING (TRUE);
GRANT SELECT ON public.role_definitions TO authenticated;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role_id UUID;
UPDATE public.profiles AS profile
SET role_id = definition.id
FROM public.role_definitions AS definition
WHERE definition.code = profile.role
  AND profile.role_id IS DISTINCT FROM definition.id;

ALTER TABLE public.profiles
  ALTER COLUMN role_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  DROP CONSTRAINT IF EXISTS profiles_role_definition_fkey,
  ADD CONSTRAINT profiles_role_definition_fkey
    FOREIGN KEY (role_id) REFERENCES public.role_definitions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.sync_profile_role_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_id UUID;
  resolved_code TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id IS NOT NULL THEN
      SELECT code INTO resolved_code FROM public.role_definitions WHERE id = NEW.role_id;
      IF resolved_code IS NULL THEN RAISE EXCEPTION 'unknown_role_id'; END IF;
      NEW.role := resolved_code;
    ELSE
      SELECT id INTO resolved_id FROM public.role_definitions WHERE code = NEW.role;
      IF resolved_id IS NULL THEN RAISE EXCEPTION 'unknown_role_code'; END IF;
      NEW.role_id := resolved_id;
    END IF;
  ELSIF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT code INTO resolved_code FROM public.role_definitions WHERE id = NEW.role_id;
    IF resolved_code IS NULL THEN RAISE EXCEPTION 'unknown_role_id'; END IF;
    NEW.role := resolved_code;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT id INTO resolved_id FROM public.role_definitions WHERE code = NEW.role;
    IF resolved_id IS NULL THEN RAISE EXCEPTION 'unknown_role_code'; END IF;
    NEW.role_id := resolved_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_role_reference ON public.profiles;
CREATE TRIGGER trg_profiles_sync_role_reference
  BEFORE INSERT OR UPDATE OF role, role_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_reference();

CREATE OR REPLACE FUNCTION public.prevent_group_leader_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $prevent_group_leader_assignment$
BEGIN
  IF (NEW.role = 'group_leader'
      OR NEW.role_id = '10000000-0000-4000-8000-000000000002'::UUID)
     AND OLD.role IS DISTINCT FROM 'group_leader'
     AND OLD.role_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000002'::UUID THEN
    RAISE EXCEPTION 'group_leader_assignment_disabled';
  END IF;
  RETURN NEW;
END;
$prevent_group_leader_assignment$;

DROP TRIGGER IF EXISTS trg_prevent_group_leader_assignment ON public.profiles;
CREATE TRIGGER trg_prevent_group_leader_assignment
  BEFORE UPDATE OF role, role_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_group_leader_assignment();
COMMENT ON COLUMN public.profiles.role_id IS
  'Canonical immutable UUID relationship to role_definitions. Display labels come from the related row.';
COMMENT ON COLUMN public.profiles.role IS
  'Compatibility authorization code synchronized from role_id; never use this field as a display label.';

-- Only a system administrator may alter privileged profile fields, including
-- the new role UUID relationship.
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

  SELECT p.id, p.role INTO actor_id, actor_role
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;

  IF actor_role = 'admin' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'member'
       OR (NEW.role_id IS NOT NULL AND NEW.role_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID)
       OR NEW.is_demo <> FALSE
       OR NEW.is_active <> TRUE
       OR NEW.nlc_member_id IS NOT NULL
       OR (NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'privileged profile fields cannot be supplied by a member'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
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
  SELECT p.role INTO actor_role
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
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

-- Re-enable whole-church read scope for church pastors, while all system and
-- permission writes remain admin-only.
DROP POLICY IF EXISTS org_manage_admin ON public.great_regions;
CREATE POLICY org_manage_admin ON public.great_regions FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS zones_manage_admin ON public.pastoral_zones;
CREATE POLICY zones_manage_admin ON public.pastoral_zones FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS groups_manage_admin ON public.small_groups;
CREATE POLICY groups_manage_admin ON public.small_groups FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');

DROP POLICY IF EXISTS profiles_manage_admin ON public.profiles;
CREATE POLICY profiles_manage_admin ON public.profiles FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS profiles_select_by_scope ON public.profiles;
CREATE POLICY profiles_select_by_scope ON public.profiles FOR SELECT TO authenticated USING (
  id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR ((SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ',')))
  OR ((SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')))
  OR ((SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member')
      AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
      AND small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ',')))
);

DROP POLICY IF EXISTS identities_select_own_or_admin ON public.user_identities;
CREATE POLICY identities_select_own_or_admin ON public.user_identities FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR (SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS identities_manage_admin ON public.user_identities;
CREATE POLICY identities_manage_admin ON public.user_identities FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');

DROP POLICY IF EXISTS global_plans_read_visible ON public.global_plans;
CREATE POLICY global_plans_read_visible ON public.global_plans FOR SELECT TO authenticated
  USING (is_hidden = FALSE OR (SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS global_plans_manage_admin ON public.global_plans;
CREATE POLICY global_plans_manage_admin ON public.global_plans FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');

DROP POLICY IF EXISTS announcements_read_published ON public.church_announcements;
CREATE POLICY announcements_read_published ON public.church_announcements FOR SELECT TO authenticated
  USING (is_published = TRUE OR (SELECT my_role FROM public.get_my_profile()) = 'admin');
DROP POLICY IF EXISTS announcements_manage_admin ON public.church_announcements;
CREATE POLICY announcements_manage_admin ON public.church_announcements FOR ALL TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');

-- Update the three plan-management RPCs without duplicating their large,
-- audited definitions. Each currently comes from migrations 0044/0045.
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
      'actor_profile.role NOT IN (''admin'', ''great_zone_leader'', ''zone_leader'')',
      'actor_profile.role NOT IN (''admin'', ''senior_pastor'', ''great_zone_leader'', ''zone_leader'')'
    );
    updated_definition := REPLACE(
      updated_definition,
      'actor_profile.role = ''admin''',
      'actor_profile.role IN (''admin'', ''senior_pastor'')'
    );
    IF updated_definition = original_definition THEN
      RAISE EXCEPTION 'expected plan-management role guard was not found in %', target_signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;

-- Old migrations treated senior_pastor as an administrator for these mutation
-- RPCs. The restored church-pastor role must not inherit those writes.
DO $$
DECLARE
  target_signature REGPROCEDURE;
  original_definition TEXT;
  updated_definition TEXT;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.publish_global_plan_rules(uuid,integer,jsonb,uuid)'::REGPROCEDURE,
    'public.sync_church_organization(text[],jsonb,jsonb)'::REGPROCEDURE
  ] LOOP
    SELECT pg_get_functiondef(target_signature::OID) INTO original_definition;
    updated_definition := REPLACE(
      original_definition,
      'NOT IN (''admin'', ''senior_pastor'')',
      '<> ''admin'''
    );
    IF updated_definition = original_definition THEN
      RAISE EXCEPTION 'expected legacy administrator guard was not found in %', target_signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;