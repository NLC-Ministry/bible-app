-- Isolated reading-team registration fixture.
-- Prerequisite: migrations through 0022_allow_both_team_divisions.sql.
-- It creates a separate test plan and UUID-linked demo profiles only.
-- Your real account is untouched until you join the test plan in the App.

DO $requirements$
BEGIN
  IF to_regclass('public.reading_teams') IS NULL
     OR to_regclass('public.reading_team_members') IS NULL THEN
    RAISE EXCEPTION '請先執行 0019_reading_team_registration.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reading_team_members'
      AND column_name = 'division'
  ) THEN
    RAISE EXCEPTION '請先執行 0022_allow_both_team_divisions.sql';
  END IF;
END;
$requirements$;

-- Rerunning is safe: remove only the reserved fixture plan, teams and profiles.
DELETE FROM public.reading_plans
WHERE global_plan_id = '00000000-0000-0000-c026-000000009999'::UUID;

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

INSERT INTO public.profiles(id, name, email, role, is_demo, is_active)
VALUES
  ('00000000-0000-0000-0000-000000009100', '團報測試隊長', 'team-fixture-captain@example.invalid', 'member', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000009101', '團報測試隊員 A', 'team-fixture-a@example.invalid', 'member', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000009102', '團報測試隊員 B', 'team-fixture-b@example.invalid', 'member', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000009103', '團報測試隊員 C', 'team-fixture-c@example.invalid', 'member', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000009104', '團報測試隊員 D', 'team-fixture-d@example.invalid', 'member', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000009105', '團報測試隊員 E', 'team-fixture-e@example.invalid', 'member', TRUE, TRUE);

INSERT INTO public.global_plans(
  id, name, description, start_date, end_date, target_books,
  is_hidden, is_fixed, plan_kind, rules, rule_version, published_at
)
VALUES (
  '00000000-0000-0000-c026-000000009999'::UUID,
  '團報功能測試計畫',
  '僅供測試 3 人與 6 人團隊報名；測試後可完整清除。',
  CURRENT_DATE - 1,
  CURRENT_DATE + 30,
  ARRAY['創世記']::TEXT[],
  FALSE,
  TRUE,
  'church_campaign_stage',
  jsonb_build_object(
    'id', '00000000-0000-0000-c026-000000009999',
    'presetKey', 'reading_team_fixture',
    'planKind', 'church_campaign_stage',
    'name', '團報功能測試計畫',
    'description', '僅供測試 3 人與 6 人團隊報名；測試後可完整清除。',
    'startDate', (CURRENT_DATE - 1)::TEXT,
    'endDate', (CURRENT_DATE + 30)::TEXT,
    'isFixed', TRUE,
    'version', 1,
    'stageNo', 1,
    'roundNo', 1,
    'phase', 'test',
    'awardName', '測試徽章',
    'examDate', NULL,
    'rules', jsonb_build_object('allowMidJoin', TRUE),
    'stages', jsonb_build_array(jsonb_build_object(
      'stageNo', 1,
      'roundNo', 1,
      'phase', 'test',
      'name', '團報功能測試',
      'startDate', (CURRENT_DATE - 1)::TEXT,
      'endDate', (CURRENT_DATE + 30)::TEXT,
      'awardName', '測試徽章',
      'examDate', NULL
    )),
    'segments', jsonb_build_array(jsonb_build_object(
      'stageNo', 1,
      'roundNo', 1,
      'label', '團報測試章節',
      'startDate', (CURRENT_DATE - 1)::TEXT,
      'endDate', (CURRENT_DATE + 30)::TEXT,
      'readings', jsonb_build_array(jsonb_build_object(
        'book', '創世記',
        'from', 1,
        'to', 3
      ))
    )),
    'books', jsonb_build_array('創世記')
  ),
  1,
  NOW()
);

INSERT INTO public.reading_teams(
  id, global_plan_id, division, name, captain_id, invite_code, status
)
VALUES
  (
    '00000000-0000-0000-0000-000000003003'::UUID,
    '00000000-0000-0000-c026-000000009999'::UUID,
    3,
    '團報測試｜3 人隊',
    '00000000-0000-0000-0000-000000009100'::UUID,
    'TEST3TEAM',
    'forming'
  ),
  (
    '00000000-0000-0000-0000-000000006006'::UUID,
    '00000000-0000-0000-c026-000000009999'::UUID,
    6,
    '團報測試｜6 人隊',
    '00000000-0000-0000-0000-000000009100'::UUID,
    'TEST6TEAM',
    'forming'
  );

-- The same UUID-linked test captain belongs to both divisions.
INSERT INTO public.reading_team_members(
  team_id, global_plan_id, user_id, division, member_role
)
SELECT
  team.id,
  team.global_plan_id,
  team.captain_id,
  team.division,
  'captain'
FROM public.reading_teams team
WHERE team.invite_code IN ('TEST3TEAM', 'TEST6TEAM');

-- 3-person team: test captain + filler A = 2/3.
INSERT INTO public.reading_team_members(
  team_id, global_plan_id, user_id, division, member_role
)
VALUES (
  '00000000-0000-0000-0000-000000003003'::UUID,
  '00000000-0000-0000-c026-000000009999'::UUID,
  '00000000-0000-0000-0000-000000009101'::UUID,
  3,
  'member'
);

-- 6-person team: test captain + fillers B-E = 5/6.
INSERT INTO public.reading_team_members(
  team_id, global_plan_id, user_id, division, member_role
)
VALUES
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-c026-000000009999', '00000000-0000-0000-0000-000000009102', 6, 'member'),
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-c026-000000009999', '00000000-0000-0000-0000-000000009103', 6, 'member'),
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-c026-000000009999', '00000000-0000-0000-0000-000000009104', 6, 'member'),
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-c026-000000009999', '00000000-0000-0000-0000-000000009105', 6, 'member');

SELECT
  '團報功能測試計畫' AS "測試計畫",
  'TEST3TEAM' AS "3人隊邀請碼",
  '2 / 3' AS "3人隊目前人數",
  'TEST6TEAM' AS "6人隊邀請碼",
  '5 / 6' AS "6人隊目前人數",
  '請用你的正式帳號加入此測試計畫，再依序輸入兩組邀請碼' AS "下一步";
