import { describe, expect, it } from "vitest";
import { findNextCampaignStagePlan } from "../js/data/campaign-next-stage.mjs";

// 正式站 2026-09-28 的階段計畫排列（#321）。
const CAMPAIGN = "00000000-0000-0000-c026-000000002029";
const stage = (id, startDate, extra = {}) => ({
  id,
  planKind: "church_campaign_stage",
  parentCampaignId: CAMPAIGN,
  startDate,
  audienceRegions: null,
  isHidden: false,
  ...extra
});
const cohort = (id, startDate, extra = {}) => stage(id, startDate, {
  planKind: "church_campaign_stage_cohort",
  audienceRegions: ["桃園"],
  ...extra
});

const plans = [
  stage("aug", "2026-08-01", { stageNo: 1 }),
  stage("sep", "2026-09-01", { stageNo: 2 }),
  stage("oct", "2026-10-01", { stageNo: 2 }),
  stage("nov", "2026-11-01", { stageNo: 2, isHidden: true }),
  stage("dec", "2026-12-01", { stageNo: 2, isHidden: true }),
  stage("s3", "2027-01-01", { stageNo: 3, isHidden: true }),
  cohort("ty-warmup", "2026-09-01", { stageNo: 1 }),
  cohort("ty-exodus", "2026-10-01", { stageNo: 2 }),
  { id: "master", planKind: "church_campaign", startDate: "2026-08-01", parentCampaignId: null }
];

const next = (current, list = plans) => {
  const found = findNextCampaignStagePlan(current, list);
  return found && found.id;
};

describe("findNextCampaignStagePlan (#321)", () => {
  it("moves from one monthly final to the next even though both are stageNo 2", () => {
    expect(next({ globalPlanId: "sep" })).toBe("oct");
  });

  it("takes the immediately following plan, not a later one with the same stageNo", () => {
    expect(next({ globalPlanId: "aug" })).toBe("sep");
  });

  it("skips hidden plans", () => {
    expect(next({ globalPlanId: "oct" })).toBe(null);
    const opened = plans.map(plan => plan.id === "nov" ? { ...plan, isHidden: false } : plan);
    expect(next({ globalPlanId: "oct" }, opened)).toBe("nov");
  });

  it("keeps the 桃園 cohort on its own track", () => {
    expect(next({ globalPlanId: "ty-warmup" })).toBe("ty-exodus");
    expect(next({ globalPlanId: "ty-exodus" })).toBe(null);
    // 全教會的 9 月不會被帶進桃園版
    expect(next({ globalPlanId: "sep" })).not.toBe("ty-exodus");
  });

  it("uses the global plan's region even when the reading plan object lacks it", () => {
    expect(next({ id: "reading-plan-row", globalPlanId: "ty-warmup", planKind: "church_campaign_stage_cohort" })).toBe("ty-exodus");
  });

  it("honours a custom hidden check", () => {
    const found = findNextCampaignStagePlan({ globalPlanId: "sep" }, plans, { isHidden: plan => plan.id === "oct" });
    expect(found && found.id).toBe("nov");
  });

  it("returns null for non-stage plans or missing data", () => {
    expect(next({ globalPlanId: "master" })).toBe(null);
    expect(next(null)).toBe(null);
    expect(findNextCampaignStagePlan({ globalPlanId: "sep" }, undefined)).toBe(null);
  });
});
