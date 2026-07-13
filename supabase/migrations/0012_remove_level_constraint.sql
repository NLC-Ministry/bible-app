-- Migration 0012: Remove rigid level constraint and rank-based triggers for reading plans
-- This supports unlimited rounds/levels of Bible reading.

-- 1. Drop the check constraint that limits levels to 'normal', 'breakthrough', 'super'
ALTER TABLE public.reading_plans DROP CONSTRAINT IF EXISTS reading_plans_level_check;

-- 2. Update the progress transition trigger function to remove rigid level rank checks
CREATE OR REPLACE FUNCTION public.enforce_reading_plan_progress_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'reading plan ownership is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- Verify current_round transitions. Since manual levels are removed,
  -- round decreases are only allowed under an explicit downgrade lock.
  IF NEW.current_round < OLD.current_round
     AND NOT (
       NEW.was_downgraded = TRUE
       AND NEW.downgrade_locked_until IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'current_round cannot decrease from % to % without an explicit downgrade', OLD.current_round, NEW.current_round
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
