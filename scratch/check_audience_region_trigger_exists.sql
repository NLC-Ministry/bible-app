-- check_audience_region_trigger_exists.sql
--
-- Before writing a fix for "invite-code join bypasses audience_regions",
-- confirm whether the trigger-based enforcement that migrations 0056 and
-- 0127 describe (assert_campaign_stage_open, fired via BEFORE INSERT
-- triggers on reading_plans / reading_teams / reading_team_members) is
-- actually live in this database. This codebase has had cases before where
-- a migration file existed but the described protection wasn't actually
-- active in production (see sync-devotion-video's verify_jwt gap).
--
-- Usage: run in the Supabase SQL editor.

-- 1. Does the function exist, and does its body still contain the
--    audience_regions check?
SELECT
  proname,
  pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'assert_campaign_stage_open';

-- 2. Are the triggers actually attached to the tables?
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_reading_plan_stage_open',
  'trg_reading_team_stage_open',
  'trg_reading_team_member_stage_open'
)
ORDER BY event_object_table;

-- 3. Direct test: would today's assert_campaign_stage_open actually reject
--    a blank-region member joining the 桃園 plan? Replace the plan id with
--    the actual global_plan_id of "第1階段｜第一輪熱身賽（桃園）" (you can
--    get it from the reading_plan_id column you already pulled, or query
--    global_plans by name), and use any of the 3 profile_ids you already
--    have (blank great_region right now, so this simulates the exact
--    condition they'd have hit if they joined again today).
--
-- SELECT public.assert_campaign_stage_open(
--   '<global_plan_id of 桃園 plan>'::uuid,
--   '06796829-872d-488c-88f9-fed4217a9d29'::uuid  -- 李宜馨
-- );
-- If the trigger/function is working, this should raise
-- "plan_audience_restricted". If it silently succeeds (returns nothing, no
-- error), the check is not actually enforcing today.
