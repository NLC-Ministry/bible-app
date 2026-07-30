-- Small-group permissions are intentionally unavailable for now.
-- Preserve existing group leaders, but prevent assigning the role to another
-- profile until the feature is reopened.

CREATE OR REPLACE FUNCTION public.prevent_group_leader_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $prevent_group_leader_assignment$
BEGIN
  IF NEW.role = 'group_leader'
     AND OLD.role IS DISTINCT FROM 'group_leader' THEN
    RAISE EXCEPTION 'group_leader_assignment_disabled';
  END IF;
  RETURN NEW;
END;
$prevent_group_leader_assignment$;

DROP TRIGGER IF EXISTS trg_prevent_group_leader_assignment ON public.profiles;
CREATE TRIGGER trg_prevent_group_leader_assignment
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_group_leader_assignment();
