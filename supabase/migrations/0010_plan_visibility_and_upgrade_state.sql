-- ============================================================
-- Migration: 0010_plan_visibility_and_upgrade_state.sql
-- Purpose:
--   1. Allow admins to hide test or unpublished global plans.
--   2. Store the downgrade lock expiry after automatic level downgrade.
--   3. Store whether the first-round upgrade prompt has already been handled.
-- ============================================================

ALTER TABLE public.global_plans
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN public.global_plans.is_hidden
  IS 'Whether this global plan is hidden from normal users while remaining manageable by admins.';

CREATE INDEX IF NOT EXISTS idx_global_plans_is_hidden
  ON public.global_plans(is_hidden);

ALTER TABLE public.reading_plans
  ADD COLUMN IF NOT EXISTS downgrade_locked_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS upgrade_prompt_handled BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN public.reading_plans.downgrade_locked_until
  IS 'Upgrade lock expiry after automatic downgrade caused by falling behind at higher levels.';

COMMENT ON COLUMN public.reading_plans.upgrade_prompt_handled
  IS 'Whether the user has already answered the upgrade prompt after completing the first round.';

CREATE INDEX IF NOT EXISTS idx_reading_plans_downgrade_locked_until
  ON public.reading_plans(downgrade_locked_until);

CREATE INDEX IF NOT EXISTS idx_reading_plans_upgrade_prompt_handled
  ON public.reading_plans(upgrade_prompt_handled);
