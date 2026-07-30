-- Target the access paths used by plan dashboards, rankings and scoped profile reads.
-- Keep these indexes narrow: every additional index also increases write cost.

CREATE INDEX IF NOT EXISTS idx_profiles_active_great_region
  ON public.profiles(great_region)
  WHERE is_demo = FALSE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_profiles_active_zone_group
  ON public.profiles(pastoral_zone, small_group)
  WHERE is_demo = FALSE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_reading_plans_global_user
  ON public.reading_plans(global_plan_id, user_id)
  WHERE global_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reading_logs_plan_round_read_at
  ON public.reading_logs(plan_id, round, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_devotional_notes_date_created
  ON public.devotional_notes(note_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at
  ON public.issue_reports(created_at DESC);

COMMENT ON INDEX public.idx_profiles_active_great_region IS
  'Supports server-side great-region permission scope filtering without scanning all profiles.';
COMMENT ON INDEX public.idx_reading_plans_global_user IS
  'Supports plan participation and unjoined-member lookups by global plan.';
COMMENT ON INDEX public.idx_reading_logs_plan_round_read_at IS
  'Supports plan leaderboard and completion aggregation filters.';

