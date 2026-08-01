-- Keep locked campaign stages visible while enrollment remains blocked by 0056.
-- Other hidden plans remain invisible to ordinary members.

BEGIN;

DROP POLICY IF EXISTS global_plans_read_visible ON public.global_plans;
CREATE POLICY global_plans_read_visible
ON public.global_plans
FOR SELECT
TO authenticated
USING (
  is_hidden = FALSE
  OR plan_kind = 'church_campaign_stage'
  OR (SELECT my_role FROM public.get_my_profile()) = 'admin'
);

COMMIT;