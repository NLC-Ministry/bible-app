-- diagnose_taoyuan_plan_members_missing_region.sql
--
-- Broader version of diagnose_taoyuan_team_members_missing_region.sql: finds
-- EVERYONE formally enrolled in a region-restricted plan (any reading_plans
-- row, whether or not they're in a reading team) whose own profile has no
-- region set, or a region that doesn't match the plan's audience_regions.
--
-- Confirmed mechanism: audience_regions is only enforced client-side in the
-- "explore & join" list filter (js/modules/plan.js's isPlanAudienceMatch /
-- viewerRegionMissing). The actual write path — db.joinPresetPlan()
-- (js/db.js:4810), which is what both the normal "加入" button AND the
-- global "輸入邀請碼" entry point (joinTeamGlobally -> joinReadingTeam ->
-- joinPresetPlan, js/modules/plan.js:2119-2126) ultimately call — does a
-- plain INSERT into reading_plans with no audience_regions check at all.
-- So this can also catch someone who joined solo (joinPlanSoloFromCard),
-- or whose region was cleared/changed after they joined.
--
-- Usage: run in the Supabase SQL editor. Adjust the plan filter in the WHERE
-- clause below — either the ILIKE name match, or swap in
-- `gp.id = '<known-global-plan-uuid>'` if you already know the plan id.

SELECT
  p.id                       AS profile_id,
  p.name                     AS member_name,
  p.email,
  NULLIF(TRIM(p.great_region), '')   AS great_region,
  NULLIF(TRIM(p.pastoral_zone), '')  AS pastoral_zone,
  NULLIF(TRIM(p.small_group), '')    AS small_group,
  gp.name                    AS plan_name,
  gp.audience_regions,
  rp.id                      AS reading_plan_id,
  rp.created_at              AS plan_joined_at,
  rt.name                    AS team_name,
  rt.invite_code,
  rtm.division,
  rtm.joined_at              AS team_joined_at
FROM public.reading_plans rp
JOIN public.global_plans gp ON gp.id = rp.global_plan_id
JOIN public.profiles p      ON p.id = rp.user_id
LEFT JOIN public.reading_team_members rtm
  ON rtm.user_id = rp.user_id AND rtm.global_plan_id = rp.global_plan_id
LEFT JOIN public.reading_teams rt ON rt.id = rtm.team_id
WHERE gp.audience_regions IS NOT NULL
  AND cardinality(gp.audience_regions) > 0
  AND gp.name ILIKE '%桃園%'   -- ← 改成實際計畫名稱關鍵字，或改用 gp.id = '...'
  AND (
    COALESCE(NULLIF(TRIM(p.great_region), ''), '') = ''
    OR NOT (p.great_region = ANY (gp.audience_regions))
  )
ORDER BY (p.great_region IS NULL OR TRIM(p.great_region) = ''), rp.created_at;

-- Quick count-only version, if you just want to confirm "3":
--
-- SELECT COUNT(*)
-- FROM public.reading_plans rp
-- JOIN public.global_plans gp ON gp.id = rp.global_plan_id
-- JOIN public.profiles p      ON p.id = rp.user_id
-- WHERE gp.audience_regions IS NOT NULL
--   AND cardinality(gp.audience_regions) > 0
--   AND gp.name ILIKE '%桃園%'
--   AND (
--     COALESCE(NULLIF(TRIM(p.great_region), ''), '') = ''
--     OR NOT (p.great_region = ANY (gp.audience_regions))
--   );
