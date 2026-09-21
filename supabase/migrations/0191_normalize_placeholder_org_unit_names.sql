-- 0191_normalize_placeholder_org_unit_names.sql
--
-- Member Hub's own org tree can contain a placeholder node literally named
-- "未定" (their own "not yet placed" marker) at any of the 大區/牧區/小組
-- levels. supabase/functions/nlc-session's org projection used to pass that
-- string straight through into profiles.great_region/pastoral_zone/
-- small_group and upsert it into great_regions/pastoral_zones/small_groups
-- as if it were a real org unit. From there it behaved like a normal region:
--   - counted as "has a region" by every blank/falsy check in the app
--     (e.g. js/modules/plan.js's viewerRegionMissing), so members stuck in
--     it never got the friendly "請先到會員中心補齊資料" nudge;
--   - showed up as its own bucket in get_admin_registration_statistics
--     (migration 0080) sitting next to real regions, distinct from the
--     genuinely-blank "未設定" bucket;
--   - was accepted by assert_campaign_stage_open's audience_regions match
--     (migration 0127) for any 延後大區梯次 plan whose audience_regions
--     happened to include the literal string "未定".
-- nlc-session/index.ts and scripts/lib/nlc-profile-sync.mjs were fixed in
-- the same change to normalize this placeholder to NULL at the source going
-- forward (requires redeploying the nlc-session Edge Function). This
-- migration is the one-time cleanup of what already landed in the database
-- before that fix: 3 profiles surfaced via admin's 報名與註冊統計 showing
-- signups under a "未定" 大區 bucket for a plan restricted to 桃園.
--
-- Deploy: supabase db push, or paste into the Supabase SQL editor. Also
-- redeploy nlc-session (`supabase functions deploy nlc-session`) — otherwise
-- the next login for an affected member re-writes "未定" right back.

DO $normalize_placeholder_org_units$
DECLARE
  placeholder_region_id UUID;
BEGIN
  -- great_region/pastoral_zone/small_group are TEXT NOT NULL DEFAULT ''
  -- (migration 0001) — "unset" is represented as '', not NULL. The *_id FK
  -- columns (great_region_id/pastoral_zone_id/small_group_id) are the
  -- nullable ones.

  -- 小組 level: clear profiles pointing at a placeholder small_group, then
  -- drop the now-orphaned small_groups row(s).
  UPDATE public.profiles
  SET small_group = '', small_group_id = NULL
  WHERE small_group = '未定'
     OR small_group_id IN (SELECT id FROM public.small_groups WHERE name = '未定');

  DELETE FROM public.small_groups sg
  WHERE sg.name = '未定'
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.small_group_id = sg.id
    );

  -- 牧區 level: same pattern.
  UPDATE public.profiles
  SET pastoral_zone = '', pastoral_zone_id = NULL
  WHERE pastoral_zone = '未定'
     OR pastoral_zone_id IN (SELECT id FROM public.pastoral_zones WHERE name = '未定');

  DELETE FROM public.pastoral_zones pz
  WHERE pz.name = '未定'
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.pastoral_zone_id = pz.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.small_groups sg WHERE sg.pastoral_zone_id = pz.id
    );

  -- 大區 level: same pattern.
  UPDATE public.profiles
  SET great_region = '', great_region_id = NULL
  WHERE great_region = '未定'
     OR great_region_id IN (SELECT id FROM public.great_regions WHERE name = '未定');

  SELECT id INTO placeholder_region_id FROM public.great_regions WHERE name = '未定';
  IF placeholder_region_id IS NOT NULL THEN
    DELETE FROM public.great_regions gr
    WHERE gr.id = placeholder_region_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.great_region_id = gr.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pastoral_zones pz WHERE pz.great_region_id = gr.id
      );
  END IF;
END;
$normalize_placeholder_org_units$;
