-- Materialized projection of the versioned Member Hub journey contract.
-- Enum-like values intentionally remain TEXT: unknown upstream values are preserved
-- so older Bible deployments can fail authorization closed and still recover via
-- required_action_url instead of failing the entire session synchronization.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS member_context_contract_version INTEGER,
  ADD COLUMN IF NOT EXISTS member_context_membership_lifecycle_state TEXT,
  ADD COLUMN IF NOT EXISTS member_context_placement_state TEXT,
  ADD COLUMN IF NOT EXISTS member_context_placement_workflow_state TEXT,
  ADD COLUMN IF NOT EXISTS member_context_has_required_placement BOOLEAN,
  ADD COLUMN IF NOT EXISTS member_context_required_action TEXT,
  ADD COLUMN IF NOT EXISTS member_context_required_action_url TEXT;

COMMENT ON COLUMN public.profiles.member_context_contract_version IS
  'Member Hub context contract version from the last successful canonical synchronization.';
COMMENT ON COLUMN public.profiles.member_context_required_action IS
  'Raw versioned Member Hub action. Unknown upstream values are preserved and interpreted fail-closed by Bible.';
COMMENT ON COLUMN public.profiles.member_context_required_action_url IS
  'Stable Member Hub resolver URL from the last successful canonical synchronization.';

CREATE OR REPLACE FUNCTION public.protect_profile_member_context_journey_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.member_context_contract_version IS NOT NULL
       OR NEW.member_context_membership_lifecycle_state IS NOT NULL
       OR NEW.member_context_placement_state IS NOT NULL
       OR NEW.member_context_placement_workflow_state IS NOT NULL
       OR NEW.member_context_has_required_placement IS NOT NULL
       OR NEW.member_context_required_action IS NOT NULL
       OR NEW.member_context_required_action_url IS NOT NULL THEN
      RAISE EXCEPTION 'member context journey fields are managed by Member Hub';
    END IF;
  ELSIF NEW.member_context_contract_version IS DISTINCT FROM OLD.member_context_contract_version
     OR NEW.member_context_membership_lifecycle_state IS DISTINCT FROM OLD.member_context_membership_lifecycle_state
     OR NEW.member_context_placement_state IS DISTINCT FROM OLD.member_context_placement_state
     OR NEW.member_context_placement_workflow_state IS DISTINCT FROM OLD.member_context_placement_workflow_state
     OR NEW.member_context_has_required_placement IS DISTINCT FROM OLD.member_context_has_required_placement
     OR NEW.member_context_required_action IS DISTINCT FROM OLD.member_context_required_action
     OR NEW.member_context_required_action_url IS DISTINCT FROM OLD.member_context_required_action_url THEN
    RAISE EXCEPTION 'member context journey fields are managed by Member Hub';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_member_context_journey ON public.profiles;
CREATE TRIGGER trg_profiles_protect_member_context_journey
BEFORE INSERT OR UPDATE OF
  member_context_contract_version,
  member_context_membership_lifecycle_state,
  member_context_placement_state,
  member_context_placement_workflow_state,
  member_context_has_required_placement,
  member_context_required_action,
  member_context_required_action_url
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_member_context_journey_fields();
