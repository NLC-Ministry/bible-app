-- Hub-owned org placement: members cannot mutate placement columns directly.
-- Only service-role integrations (nlc-session) may project Member Hub context.

CREATE OR REPLACE FUNCTION public.protect_profile_org_placement_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT p.role
  INTO actor_role
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;

  IF actor_role IN ('admin', 'senior_pastor') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.great_region, '') <> ''
       OR COALESCE(NEW.pastoral_zone, '') <> ''
       OR COALESCE(NEW.small_group, '') <> ''
       OR NEW.great_region_id IS NOT NULL
       OR NEW.pastoral_zone_id IS NOT NULL
       OR NEW.small_group_id IS NOT NULL THEN
      RAISE EXCEPTION 'org placement fields are managed by Member Hub'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.great_region IS DISTINCT FROM OLD.great_region
       OR NEW.pastoral_zone IS DISTINCT FROM OLD.pastoral_zone
       OR NEW.small_group IS DISTINCT FROM OLD.small_group
       OR NEW.great_region_id IS DISTINCT FROM OLD.great_region_id
       OR NEW.pastoral_zone_id IS DISTINCT FROM OLD.pastoral_zone_id
       OR NEW.small_group_id IS DISTINCT FROM OLD.small_group_id THEN
      RAISE EXCEPTION 'org placement fields are managed by Member Hub'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_org_placement ON public.profiles;
CREATE TRIGGER trg_profiles_protect_org_placement
  BEFORE INSERT OR UPDATE
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_org_placement_fields();

COMMENT ON FUNCTION public.protect_profile_org_placement_fields() IS
  'Blocks authenticated members from writing Hub-owned org placement columns on profiles.';
