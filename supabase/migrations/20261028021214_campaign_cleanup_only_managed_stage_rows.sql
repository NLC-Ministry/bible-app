-- #634 總表規則更新時，階段清理觸發器只刪它自己管理的 c026 階段列。
--
-- cleanup_removed_church_campaign_stages（0018，0137 改寫過述詞）會刪掉 parentCampaignId 指向總表、
-- 但 id 不在 {c026-<總表 stages 的 stageNo>} 裡的正式階段。0142 把第 2 階段拆成 4 張月度期末賽，
-- id 用 c126-YYYYMM 命名空間，永遠對不上 c026，所以每次重新發布總表規則都會被當成
-- 「已移除的階段」刪掉，會友的報名與打卡（reading_logs ON DELETE CASCADE）也一起消失。
-- 另外 stages 缺少時 jsonb_typeof(NULL) <> 'array' 是 NULL，提早 return 沒生效，等於刪掉全部階段。
--
-- 改成：
--   1. 只刪 id 在 c026-<12 位數字> 命名空間、由 sync_church_campaign_stage_plans 產生的列（白名單），
--      月度期末賽等其他命名空間的計畫一律不碰。
--   2. stages 不是陣列時直接結束，什麼都不刪。
-- 總表真的移除某個階段時，那個 c026 階段與它的報名照舊刪除。

CREATE OR REPLACE FUNCTION public.cleanup_removed_church_campaign_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id <> '00000000-0000-0000-c026-000000002029'::UUID
     OR NEW.plan_kind IS DISTINCT FROM 'church_campaign'
     OR jsonb_typeof(NEW.rules->'stages') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  -- reading_plans uses ON DELETE SET NULL for global_plan_id, so remove the
  -- enrollment first. Its reading_logs are removed by their ON DELETE CASCADE.
  DELETE FROM public.reading_plans enrollment
  USING public.global_plans stage_plan
  WHERE enrollment.global_plan_id = stage_plan.id
    AND public.is_canonical_campaign_stage_kind(stage_plan.plan_kind)
    AND stage_plan.audience_regions IS NULL
    AND stage_plan.id <> NEW.id
    AND stage_plan.id::TEXT ~ '^00000000-0000-0000-c026-[0-9]{12}$'
    AND stage_plan.rules->>'parentCampaignId' = NEW.id::TEXT
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.rules->'stages') stage
      WHERE stage_plan.id = format(
        '00000000-0000-0000-c026-%s',
        lpad((stage->>'stageNo')::TEXT, 12, '0')
      )::UUID
    );

  DELETE FROM public.global_plans stage_plan
  WHERE public.is_canonical_campaign_stage_kind(stage_plan.plan_kind)
    AND stage_plan.audience_regions IS NULL
    AND stage_plan.id <> NEW.id
    AND stage_plan.id::TEXT ~ '^00000000-0000-0000-c026-[0-9]{12}$'
    AND stage_plan.rules->>'parentCampaignId' = NEW.id::TEXT
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.rules->'stages') stage
      WHERE stage_plan.id = format(
        '00000000-0000-0000-c026-%s',
        lpad((stage->>'stageNo')::TEXT, 12, '0')
      )::UUID
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_removed_church_campaign_stages() FROM PUBLIC, anon, authenticated;
