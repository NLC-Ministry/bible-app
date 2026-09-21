-- diagnose_orphaned_solo_member_team_history.sql
--
-- For the one member from diagnose_taoyuan_plan_members_missing_region.sql
-- who has a reading_plans row but NO current reading_team_members row
-- (team_name/invite_code came back null) — check whether she was ever in a
-- team that got deleted afterward. reading_team_members has no history of
-- its own (a captain disbanding the team, or leave_reading_team, just does
-- `DELETE FROM reading_teams ...` which cascades and erases the row), but
-- migration 0149_reading_team_audit.sql added permanent insert/delete
-- logging that survives the cascade — this is the only way to see it now.
--
-- Usage: run in the Supabase SQL editor. Replace the user_id below if
-- you're checking someone else.

-- 1. Full team-membership history for this user (insert = joined, delete =
--    left/removed/team disbanded — call_context shows which).
SELECT
  event_type,
  team_id,
  global_plan_id,
  division,
  member_role,
  call_context,
  created_at
FROM public.reading_team_member_events
WHERE user_id = '06796829-872d-488c-88f9-fed4217a9d29'  -- 李宜馨
ORDER BY created_at;

-- 2. What happened to any team she was in (did it get disbanded / carried
--    to another stage / have its plan changed)?
SELECT
  event_type,
  team_id,
  global_plan_id_old,
  global_plan_id_new,
  name_old,
  name_new,
  status_old,
  status_new,
  invite_code,
  call_context,
  created_at
FROM public.reading_teams_events
WHERE team_id IN (
  SELECT DISTINCT team_id
  FROM public.reading_team_member_events
  WHERE user_id = '06796829-872d-488c-88f9-fed4217a9d29'
)
ORDER BY created_at;
