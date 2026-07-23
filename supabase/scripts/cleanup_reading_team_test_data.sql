-- Removes only the isolated fixture created by seed_reading_team_test_data.sql.
BEGIN;

-- Reading plans use ON DELETE SET NULL, so remove fixture enrollments first;
-- their reading logs are removed by the reading_plans cascade.
DELETE FROM public.reading_plans
WHERE global_plan_id = '00000000-0000-0000-c026-000000009999'::UUID;

-- Fixture teams and memberships cascade from the fixture global plan.
DELETE FROM public.global_plans
WHERE id = '00000000-0000-0000-c026-000000009999'::UUID;

DELETE FROM public.reading_teams
WHERE invite_code IN ('TEST3TEAM', 'TEST6TEAM')
   OR id IN (
     '00000000-0000-0000-0000-000000003003'::UUID,
     '00000000-0000-0000-0000-000000006006'::UUID
   );

DELETE FROM public.profiles
WHERE id IN (
  '00000000-0000-0000-0000-000000009100'::UUID,
  '00000000-0000-0000-0000-000000009101'::UUID,
  '00000000-0000-0000-0000-000000009102'::UUID,
  '00000000-0000-0000-0000-000000009103'::UUID,
  '00000000-0000-0000-0000-000000009104'::UUID,
  '00000000-0000-0000-0000-000000009105'::UUID
);

COMMIT;

SELECT '團報測試計畫、隊伍與測試成員已清除' AS result;
