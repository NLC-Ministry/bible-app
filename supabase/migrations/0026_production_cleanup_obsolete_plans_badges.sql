-- Production cleanup: remove retired test/quarter plans and the five legacy badges.
-- Every selector is an exact, typed value. The whole migration is atomic.
BEGIN;

LOCK TABLE public.global_plans,
  public.reading_plans,
  public.reading_logs,
  public.plan_rule_versions,
  public.small_home_teams,
  public.small_home_team_members,
  public.reading_teams,
  public.reading_team_members,
  public.care_reminders
IN SHARE ROW EXCLUSIVE MODE;

-- Future global-plan deletion must also remove enrollments, progress and reminders.
ALTER TABLE public.reading_plans
  DROP CONSTRAINT IF EXISTS reading_plans_global_plan_id_fkey;
ALTER TABLE public.reading_plans
  ADD CONSTRAINT reading_plans_global_plan_id_fkey
  FOREIGN KEY (global_plan_id)
  REFERENCES public.global_plans(id)
  ON DELETE CASCADE;

ALTER TABLE public.care_reminders
  DROP CONSTRAINT IF EXISTS care_reminders_global_plan_id_fkey;
ALTER TABLE public.care_reminders
  ADD CONSTRAINT care_reminders_global_plan_id_fkey
  FOREIGN KEY (global_plan_id)
  REFERENCES public.global_plans(id)
  ON DELETE CASCADE;

DO $production_cleanup$
DECLARE
  retired_global_plan_ids CONSTANT UUID[] := ARRAY[
    '00000000-0000-0000-c026-000000009999'::UUID
  ];
  retired_plan_names CONSTANT TEXT[] := ARRAY[
    '測試讀書計畫',
    '測試讀經計畫',
    '團報測試計畫',
    '第一季速讀：2026年7月~9月',
    '第二季速讀：2026年10月~12月',
    '第三季速讀：2027年1月~3月',
    '第四季速讀：2027年4月~6月'
  ];
  retired_preset_keys CONSTANT TEXT[] := ARRAY['q1', 'q2', 'q3', 'q4'];
  retired_profile_ids CONSTANT UUID[] := ARRAY[
    '00000000-0000-0000-0000-000000009100'::UUID,
    '00000000-0000-0000-0000-000000009101'::UUID,
    '00000000-0000-0000-0000-000000009102'::UUID,
    '00000000-0000-0000-0000-000000009103'::UUID,
    '00000000-0000-0000-0000-000000009104'::UUID,
    '00000000-0000-0000-0000-000000009105'::UUID
  ];
  retired_badge_ids CONSTANT TEXT[] := ARRAY[
    'subscribe_plan',
    'streak_30',
    'complete_plan',
    'share_verse',
    'read_all_bible'
  ];
  orphan_count BIGINT;
BEGIN
  CREATE TEMP TABLE cleanup_plan_targets (
    id UUID PRIMARY KEY
  ) ON COMMIT DROP;

  -- Resolve targets by immutable UUID, exact name, or an enrollment's exact legacy key.
  INSERT INTO cleanup_plan_targets(id)
  SELECT plan.id
  FROM public.global_plans plan
  WHERE plan.id = ANY(retired_global_plan_ids)
     OR plan.name = ANY(retired_plan_names)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO cleanup_plan_targets(id)
  SELECT DISTINCT enrollment.global_plan_id
  FROM public.reading_plans enrollment
  WHERE enrollment.global_plan_id IS NOT NULL
    AND (
      enrollment.preset_key = ANY(retired_preset_keys)
      OR enrollment.name = ANY(retired_plan_names)
    )
  ON CONFLICT (id) DO NOTHING;

  -- Remove plan-linked notifications, including legacy rows that only kept plan_key.
  DELETE FROM public.care_reminders reminder
  WHERE reminder.global_plan_id IN (SELECT id FROM cleanup_plan_targets)
     OR reminder.plan_key = ANY(retired_preset_keys)
     OR reminder.plan_key IN (SELECT id::TEXT FROM cleanup_plan_targets);

  -- Remove enrollments before definitions. reading_logs cascade from reading_plans.
  DELETE FROM public.reading_plans enrollment
  WHERE enrollment.global_plan_id IN (SELECT id FROM cleanup_plan_targets)
     OR enrollment.preset_key = ANY(retired_preset_keys)
     OR enrollment.name = ANY(retired_plan_names);

  -- Rules, teams and memberships cascade from global_plans.
  DELETE FROM public.global_plans plan
  WHERE plan.id IN (SELECT id FROM cleanup_plan_targets);

  -- Remove isolated fixture teams/profiles even if their plan was manually removed earlier.
  DELETE FROM public.reading_teams team
  WHERE team.invite_code IN ('TEST3TEAM', 'TEST6TEAM')
     OR team.id IN (
       '00000000-0000-0000-0000-000000003003'::UUID,
       '00000000-0000-0000-0000-000000006006'::UUID
     );

  DELETE FROM public.profiles profile
  WHERE profile.id = ANY(retired_profile_ids);

  -- The active schema stores badges in the browser, not PostgreSQL. This guarded,
  -- parameter-bound deletion also cleans installations that added user_badges.
  IF to_regclass('public.user_badges') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_badges'
         AND column_name = 'badge_id'
     )
  THEN
    EXECUTE 'DELETE FROM public.user_badges WHERE badge_id = ANY($1)'
      USING retired_badge_ids;
  END IF;

  -- Abort the transaction instead of committing partial or orphaned data.
  SELECT
    (SELECT COUNT(*) FROM public.plan_rule_versions version
      WHERE version.global_plan_id IN (SELECT id FROM cleanup_plan_targets))
    + (SELECT COUNT(*) FROM public.small_home_teams team
      WHERE team.global_plan_id IN (SELECT id FROM cleanup_plan_targets))
    + (SELECT COUNT(*) FROM public.reading_teams team
      WHERE team.global_plan_id IN (SELECT id FROM cleanup_plan_targets))
    + (SELECT COUNT(*) FROM public.care_reminders reminder
      WHERE reminder.global_plan_id IN (SELECT id FROM cleanup_plan_targets)
         OR reminder.plan_key = ANY(retired_preset_keys)
         OR reminder.plan_key IN (SELECT id::TEXT FROM cleanup_plan_targets))
  INTO orphan_count;
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % retired plan children remain', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM public.reading_logs log
  WHERE log.plan_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.reading_plans plan WHERE plan.id = log.plan_id
    );
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % orphan reading_logs remain', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM public.reading_team_members member
  WHERE NOT EXISTS (
    SELECT 1 FROM public.reading_teams team WHERE team.id = member.team_id
  );
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % orphan reading_team_members remain', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM public.small_home_team_members member
  WHERE NOT EXISTS (
    SELECT 1 FROM public.small_home_teams team WHERE team.id = member.team_id
  );
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % orphan small_home_team_members remain', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM public.reading_plans enrollment
  WHERE enrollment.preset_key = ANY(retired_preset_keys)
     OR enrollment.name = ANY(retired_plan_names)
     OR enrollment.global_plan_id = ANY(retired_global_plan_ids);
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % retired enrollments remain', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM public.global_plans plan
  WHERE plan.id = ANY(retired_global_plan_ids)
     OR plan.name = ANY(retired_plan_names);
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'cleanup_failed: % retired global plans remain', orphan_count;
  END IF;
END;
$production_cleanup$;

COMMIT;
