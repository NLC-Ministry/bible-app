-- Keep the materialized stage plans in sync when an administrator removes a
-- future round from the versioned church campaign definition. The RPC update,
-- stage upserts, and this cleanup all run in the same PostgreSQL transaction.

CREATE OR REPLACE FUNCTION public.cleanup_removed_church_campaign_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id <> '00000000-0000-0000-c026-000000002029'::UUID
     OR NEW.plan_kind <> 'church_campaign'
     OR jsonb_typeof(NEW.rules->'stages') <> 'array' THEN
    RETURN NEW;
  END IF;

  -- reading_plans uses ON DELETE SET NULL for global_plan_id, so remove the
  -- enrollment first. Its reading_logs are removed by their ON DELETE CASCADE.
  DELETE FROM public.reading_plans enrollment
  USING public.global_plans stage_plan
  WHERE enrollment.global_plan_id = stage_plan.id
    AND stage_plan.plan_kind = 'church_campaign_stage'
    AND stage_plan.rules->>'parentCampaignId' = NEW.id::TEXT
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.rules->'stages') stage
      WHERE stage_plan.id = format(
        '00000000-0000-0000-c026-%s',
        lpad((stage->>'stageNo')::TEXT, 12, '0')
      )::UUID
    );

  DELETE FROM public.global_plans stage_plan
  WHERE stage_plan.plan_kind = 'church_campaign_stage'
    AND stage_plan.rules->>'parentCampaignId' = NEW.id::TEXT
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.rules->'stages') stage
      WHERE stage_plan.id = format(
        '00000000-0000-0000-c026-%s',
        lpad((stage->>'stageNo')::TEXT, 12, '0')
      )::UUID
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_removed_church_campaign_stages ON public.global_plans;
CREATE TRIGGER trg_cleanup_removed_church_campaign_stages
  AFTER UPDATE OF rules ON public.global_plans
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_removed_church_campaign_stages();

