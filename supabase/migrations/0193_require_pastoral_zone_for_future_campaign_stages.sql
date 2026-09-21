-- 0193_require_pastoral_zone_for_future_campaign_stages.sql
--
-- Decision: starting from the next not-yet-started campaign stage (第一輪
-- 期末賽｜2026年10月・利未記, start_date 2026-10-01) and every stage after
-- it, a member must have their 牧區 (pastoral_zone) set before they can be
-- enrolled — via any entry path. The audience_regions check added in 0127
-- only validates 大區 (great_region); it says nothing about whether
-- pastoral_zone itself is filled in, so someone with a matching great_region
-- but a blank pastoral_zone currently sails through untouched.
--
-- The cutover is a FIXED constant date (2026-09-30), not
-- `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::DATE` compared against
-- start_date. An earlier draft of this migration used that dynamic "is this
-- stage still in the future" comparison, which looked right but silently
-- stops enforcing the moment each stage's own start_date arrives — the
-- requirement would only ever hold for the few days before a stage opens,
-- then evaporate for the entire time it's actually live and people are
-- actually trying to join it, which defeats the point. Anchoring to a fixed
-- date that never moves means every stage starting on/after 2026-10-01 is
-- permanently in scope, forever, regardless of what "today" is when a join
-- is attempted.
--
-- Scope, deliberately narrow:
--   - Only applies to church_campaign_stage / church_campaign_stage_cohort
--     plans (public.is_campaign_stage_kind) — not devotional/group_meeting
--     or any non-campaign plan a member might create for themselves.
--   - Only applies to a stage whose start_date is on/after 2026-10-01.
--     Stages that already started before that (the currently-open 第1階段
--     timeline, the 桃園 cohort stage) are NOT retroactively affected —
--     nobody already enrolled gets kicked out, and nobody in an
--     already-open stage gets newly blocked. Every stage created after this
--     migration automatically inherits the requirement as long as its own
--     start_date falls on/after the fixed cutover — there is nothing to
--     update when a new stage is added later.
--   - admin/pastor keep bypassing this, same as the existing audience_regions
--     check in this same function — they manage rosters across placements.
--
-- This function is already wired via BEFORE INSERT/UPDATE triggers on
-- reading_plans / reading_teams / reading_team_members / small_home_teams /
-- small_home_team_members (migration 0056), so a single change here covers
-- every entry path uniformly: solo "加入", invite-code team join, a captain
-- creating a new team, and cross-stage carryover (0058/0154) — confirmed
-- live against production (see scratch/check_audience_region_trigger_
-- exists.sql).
--
-- 純 CREATE OR REPLACE，無 signature / trigger 變更。
-- 部署：Supabase SQL editor 執行，或 supabase db push。

CREATE OR REPLACE FUNCTION public.assert_campaign_stage_open(
  target_global_plan_id UUID,
  actor_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_stage_open$
DECLARE
  target_plan          public.global_plans%ROWTYPE;
  actor_role           TEXT;
  actor_region         TEXT;
  actor_pastoral_zone  TEXT;
  -- 固定分界：2026-10-01（含）之後開始的階段，一律要求牧區。用固定日期而不是
  -- 動態的「現在幾號」，這樣分界不會隨真實時間推進而消失——見檔頭說明。
  pastoral_zone_required_from CONSTANT DATE := '2026-10-01';
BEGIN
  IF target_global_plan_id IS NULL THEN RETURN; END IF;

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = target_global_plan_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT public.role_code(profile.role_id),
         NULLIF(BTRIM(profile.great_region), ''),
         NULLIF(BTRIM(profile.pastoral_zone), '')
    INTO actor_role, actor_region, actor_pastoral_zone
  FROM public.profiles profile
  WHERE profile.id = actor_profile_id;
  actor_role := COALESCE(actor_role, 'member');

  -- (a) 對象大區限制：非空 audience_regions，且 actor 不是全教會角色、也不在名單 → 擋
  IF target_plan.audience_regions IS NOT NULL
     AND cardinality(target_plan.audience_regions) > 0
     AND actor_role NOT IN ('admin', 'pastor')
     AND NOT (COALESCE(actor_region, '') = ANY(target_plan.audience_regions))
  THEN
    RAISE EXCEPTION 'plan_audience_restricted' USING ERRCODE = 'P0001';
  END IF;

  -- (b) 隱藏的階段（正式或延後梯次）：非 admin 一律擋
  IF public.is_campaign_stage_kind(target_plan.plan_kind)
     AND target_plan.is_hidden
     AND actor_role <> 'admin'
  THEN
    RAISE EXCEPTION 'campaign_stage_not_open' USING ERRCODE = 'P0001';
  END IF;

  -- (c) 2026-10-01 起的階段（含之後每一階段，永久生效，不會隨時間過去而失效）：
  -- 非全教會角色，且沒有設定牧區 → 擋。這個日期之前已經開放的階段不受影響。
  IF public.is_campaign_stage_kind(target_plan.plan_kind)
     AND target_plan.start_date >= pastoral_zone_required_from
     AND actor_role NOT IN ('admin', 'pastor')
     AND actor_pastoral_zone IS NULL
  THEN
    RAISE EXCEPTION 'plan_requires_pastoral_zone' USING ERRCODE = 'P0001';
  END IF;
END;
$assert_stage_open$;

REVOKE ALL ON FUNCTION public.assert_campaign_stage_open(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_campaign_stage_open(UUID, UUID) TO authenticated, service_role;
