CREATE OR REPLACE FUNCTION public.protect_profile_member_context_leadership_fields()
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
    IF NEW.member_context_leadership_display_label IS NOT NULL
       OR NEW.member_context_leadership_primary_assignment_id IS NOT NULL
       OR COALESCE(NEW.member_context_leadership_assignments, '[]'::jsonb) <> '[]'::jsonb THEN
      RAISE EXCEPTION 'member context leadership fields are managed by Member Hub'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.member_context_leadership_display_label IS DISTINCT FROM OLD.member_context_leadership_display_label
       OR NEW.member_context_leadership_primary_assignment_id IS DISTINCT FROM OLD.member_context_leadership_primary_assignment_id
       OR NEW.member_context_leadership_assignments IS DISTINCT FROM OLD.member_context_leadership_assignments THEN
      RAISE EXCEPTION 'member context leadership fields are managed by Member Hub'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_member_context_leadership ON public.profiles;
CREATE TRIGGER trg_profiles_protect_member_context_leadership
  BEFORE INSERT OR UPDATE
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_member_context_leadership_fields();

COMMENT ON FUNCTION public.protect_profile_member_context_leadership_fields() IS
  'Blocks authenticated members from writing Hub-owned leadership identity projection columns on profiles.';
