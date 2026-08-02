-- Supabase startup performance health check (read-only)
-- Safe to run in the SQL Editor. This script does not change schema or data.

-- 1. Verify the indexes required by the current startup and plan queries.
SELECT
  required.index_name,
  to_regclass('public.' || required.index_name) IS NOT NULL AS installed
FROM (VALUES
  ('user_identities_provider_subject_unique'),
  ('idx_user_identities_profile_id'),
  ('idx_reading_logs_user_id'),
  ('idx_reading_plans_user_id'),
  ('idx_profiles_active_great_region'),
  ('idx_profiles_active_zone_group'),
  ('idx_reading_plans_global_user'),
  ('idx_reading_logs_plan_round_read_at')
) AS required(index_name)
ORDER BY required.index_name;

-- 2. Check whether connections are saturated or stuck in transactions.
SELECT
  state,
  count(*) AS connections,
  max(EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(xact_start, query_start))))::bigint AS oldest_seconds
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
GROUP BY state
ORDER BY connections DESC;

-- 3. Find sessions currently waiting on locks.
SELECT
  pid,
  state,
  wait_event_type,
  wait_event,
  EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::numeric(12, 1) AS running_seconds,
  left(query, 240) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND wait_event_type = 'Lock'
ORDER BY query_start;

-- 4. Confirm whether query statistics are available.
SELECT EXISTS (
  SELECT 1
  FROM pg_extension
  WHERE extname = 'pg_stat_statements'
) AS pg_stat_statements_enabled;

-- 5. Run this final query only when the previous result is true.
-- SELECT
--   calls,
--   round(total_exec_time::numeric, 2) AS total_ms,
--   round(mean_exec_time::numeric, 2) AS mean_ms,
--   rows,
--   left(query, 240) AS query
-- FROM pg_stat_statements
-- WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
-- ORDER BY total_exec_time DESC
-- LIMIT 20;