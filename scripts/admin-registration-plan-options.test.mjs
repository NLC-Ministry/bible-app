import { describe, expect, it } from "vitest";
import {
  FIRST_STAGE_GLOBAL_PLAN_ID,
  buildAdminRegistrationStatisticsPlans
} from "../js/modules/admin-registration-plan-options.mjs";

describe("admin registration statistics plan options", () => {
  it("offers stage one even when no global plan has loaded", () => {
    const plans = buildAdminRegistrationStatisticsPlans([], {});
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: FIRST_STAGE_GLOBAL_PLAN_ID,
      name: "第1階段｜第一輪熱身賽",
      presetKey: "church_stage_01"
    });
  });

  it("does not wait for the plan start date", () => {
    const plans = buildAdminRegistrationStatisticsPlans([], {
      church_stage_01: {
        id: FIRST_STAGE_GLOBAL_PLAN_ID,
        name: "尚未開始的第一階段",
        startDate: "2099-08-01",
        planKind: "church_campaign_stage"
      }
    });
    expect(plans.map(plan => plan.id)).toContain(FIRST_STAGE_GLOBAL_PLAN_ID);
  });

  it("uses the loaded stage record once and excludes campaign containers", () => {
    const otherId = "11111111-1111-4111-8111-111111111111";
    const plans = buildAdminRegistrationStatisticsPlans([
      { id: FIRST_STAGE_GLOBAL_PLAN_ID, name: "資料庫第一階段", plan_kind: "church_campaign_stage" },
      { id: "22222222-2222-4222-8222-222222222222", name: "活動容器", plan_kind: "church_campaign" },
      { id: otherId, name: "另一個計畫", plan_kind: "custom" }
    ], {});

    expect(plans.filter(plan => plan.id === FIRST_STAGE_GLOBAL_PLAN_ID)).toHaveLength(1);
    expect(plans.find(plan => plan.id === FIRST_STAGE_GLOBAL_PLAN_ID)?.name).toBe("資料庫第一階段");
    expect(plans.map(plan => plan.id)).toContain(otherId);
    expect(plans.some(plan => plan.plan_kind === "church_campaign")).toBe(false);
  });
});
