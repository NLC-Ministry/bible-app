import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("admin ongoing plan selection tests", () => {
  it("verifies admin.js prioritizes ongoing active plans and removes hardcoded stageOnePlan selection", () => {
    const adminJs = readFileSync("js/modules/admin.js", "utf8");
    expect(adminJs).not.toContain("const stageOnePlan =");
    expect(adminJs).not.toContain("const isStageOneBootstrap =");
    expect(adminJs).toContain("const ongoingPlan = plans.find(plan => plan.managementStatus === 'ongoing');");
  });
});
