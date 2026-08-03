-- Performance Optimization: Add composite indexes for reading_logs and devotional_notes
-- to accelerate user plan calculations and daily devotional note lookups.

CREATE INDEX IF NOT EXISTS idx_reading_logs_user_plan
  ON public.reading_logs(user_id, plan_id);

CREATE INDEX IF NOT EXISTS idx_devotional_notes_date_user
  ON public.devotional_notes(note_date, user_id);
