-- list_church_plans_audience_config.sql
--
-- Lists every "教會的計畫" (global_plans row) with its plan_kind and current
-- audience_regions, so we can confirm which plans the audience-region gate
-- (assert_campaign_stage_open, enforced via triggers on reading_plans /
-- reading_teams / reading_team_members) actually applies to today, before
-- deciding the scope of an additional "must have 牧區 set" requirement.
--
-- Usage: run in the Supabase SQL editor.

SELECT
  id,
  name,
  plan_kind,
  audience_regions,
  is_hidden,
  start_date,
  end_date
FROM public.global_plans
ORDER BY
  (audience_regions IS NULL OR cardinality(audience_regions) = 0),  -- 有設 audience_regions 的排前面
  plan_kind,
  start_date;
