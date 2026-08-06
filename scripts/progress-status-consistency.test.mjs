import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("progress status consistency unit tests", () => {
  it("verifies renderPlanMembersView in plan.js uses unified completed - expectedDaysCount for diff", () => {
    const code = readFileSync("js/modules/plan.js", "utf8");
    expect(code).toContain("diff = completed - expectedDaysCount;");
    expect(code).not.toContain("diff = completedDaysCount - expectedDaysCount;");
    expect(code).not.toContain("diff = completedDaysCapped - expectedDaysCount;");
  });

  it("verifies round 2+ progress displays '第2遍進行中' when progress is 0%", () => {
    const code = readFileSync("js/modules/plan.js", "utf8");
    expect(code).toContain('statusStr = memberProgress > 0 ? `第${memberRound}遍完成${memberProgress}%` : `第${memberRound}遍進行中`;');
  });
});
