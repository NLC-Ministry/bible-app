// 「帶隊進入下一個計畫」的目標計畫 —— 對應 DB 的
// public.previous_campaign_stage_plan_id（migration 20260928101011，#321）。
//
// 下一張 = 同一個活動（parentCampaignId）、同一個對象大區（audienceRegions）的
// 階段計畫裡，開始日期晚於目前計畫、而且最接近的那一張（隱藏的不算）。
// 不能再用 stageNo + 1：第一輪期末賽拆成 9～12 月四張，全部都是 stageNo 2。
import { isCampaignStageKind } from "./campaign-stage-kinds.mjs";

function regionsKey(plan) {
  const regions = plan && (plan.audienceRegions || plan.audience_regions);
  return Array.isArray(regions) && regions.length ? regions.map(String).sort().join("|") : "";
}

function startDateOf(plan) {
  return String(plan && (plan.startDate || plan.start_date) || "");
}

function planIdOf(plan) {
  return String(plan && (plan.globalPlanId || plan.global_plan_id || plan.id) || "");
}

export function findNextCampaignStagePlan(currentPlan, globalPlans, { isHidden } = {}) {
  const plans = Array.isArray(globalPlans) ? globalPlans : [];
  const currentId = planIdOf(currentPlan);
  // 目前計畫的活動／對象大區以 global plan 那一筆為準（reading plan 物件不一定帶 audienceRegions）。
  const source = plans.find(plan => plan && String(plan.id) === currentId) || currentPlan;
  if (!source || !isCampaignStageKind(source)) return null;

  const sourceStart = startDateOf(source);
  if (!sourceStart) return null;
  const campaignId = String(source.parentCampaignId || "");
  const regions = regionsKey(source);
  const hidden = typeof isHidden === "function"
    ? isHidden
    : plan => Boolean(plan.isHidden || plan.is_hidden);

  return plans
    .filter(plan => plan
      && isCampaignStageKind(plan)
      && String(plan.id) !== currentId
      && !hidden(plan)
      && String(plan.parentCampaignId || "") === campaignId
      && regionsKey(plan) === regions
      && startDateOf(plan) > sourceStart)
    .sort((a, b) => startDateOf(a).localeCompare(startDateOf(b)))[0] || null;
}
