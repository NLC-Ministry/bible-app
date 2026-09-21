-- diagnose_taoyuan_team_members_missing_region.sql
--
-- Finds reading-team members enrolled under a region-restricted plan whose
-- own profile has no region set (or a region that doesn't match the plan's
-- audience_regions) — i.e. people who most likely joined via a team invite
-- code, bypassing the audience-region gate.
--
-- Why this is possible: the "explore & join plan" UI checks
-- global_plans.audience_regions against the viewer's profiles.great_region
-- before allowing "加入" (js/modules/plan.js's isPlanAudienceMatch), but
-- join_reading_team_by_code (supabase/migrations/0147_join_team_already_in_
-- other_team.sql) never re-checks audience_regions or whether the joiner
-- has any org placement at all — it only checks the invite code, whether
-- they're already in another team in the same plan/division, and capacity.
--
-- Usage: run in the Supabase SQL editor. Adjust the plan filter in the WHERE
-- clause below — either the ILIKE name match, or swap in
-- `gp.id = '<known-global-plan-uuid>'` if you already know the plan id.

SELECT
  p.id                      AS profile_id,
  p.name                    AS member_name,
  p.email,
  NULLIF(TRIM(p.great_region), '')   AS great_region,
  NULLIF(TRIM(p.pastoral_zone), '')  AS pastoral_zone,
  NULLIF(TRIM(p.small_group), '')    AS small_group,
  gp.name                   AS plan_name,
  gp.audience_regions,
  rt.name                   AS team_name,
  rt.invite_code,
  rtm.division,
  rtm.member_role,
  rtm.joined_at,
  (rp.id IS NOT NULL)       AS has_formal_plan_enrollment
FROM public.reading_team_members rtm
JOIN public.reading_teams rt   ON rt.id = rtm.team_id
JOIN public.global_plans gp    ON gp.id = rtm.global_plan_id
JOIN public.profiles p         ON p.id = rtm.user_id
LEFT JOIN public.reading_plans rp
  ON rp.user_id = rtm.user_id AND rp.global_plan_id = rtm.global_plan_id
WHERE gp.audience_regions IS NOT NULL
  AND cardinality(gp.audience_regions) > 0
  AND gp.name ILIKE '%桃園%'   -- ← 改成實際計畫名稱關鍵字，或改用 gp.id = '...'
  AND (
    COALESCE(NULLIF(TRIM(p.great_region), ''), '') = ''
    OR NOT (p.great_region = ANY (gp.audience_regions))
  )
ORDER BY (p.great_region IS NULL OR TRIM(p.great_region) = ''), rt.name, p.name;

-- Quick count-only version, if you just want to confirm "3":
--
-- SELECT COUNT(*)
-- FROM public.reading_team_members rtm
-- JOIN public.reading_teams rt ON rt.id = rtm.team_id
-- JOIN public.global_plans gp  ON gp.id = rtm.global_plan_id
-- JOIN public.profiles p       ON p.id = rtm.user_id
-- WHERE gp.audience_regions IS NOT NULL
--   AND cardinality(gp.audience_regions) > 0
--   AND gp.name ILIKE '%桃園%'
--   AND (
--     COALESCE(NULLIF(TRIM(p.great_region), ''), '') = ''
--     OR NOT (p.great_region = ANY (gp.audience_regions))
--   );
