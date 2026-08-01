import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getPlanUpgradeAvailability } from "../js/modules/plan-upgrade-availability.mjs";

const planSource = readFileSync("js/modules/plan.js", "utf8");
const css = readFileSync("index.css", "utf8");

describe("persistent plan upgrade entry", () => {
  it("keeps upgrade available after the first completion prompt was dismissed", () => {
    const result = getPlanUpgradeAvailability({
      currentRound: 1,
      progress: 100,
      lastPromptedRound: 1
    });

    expect(result.eligible).toBe(true);
    expect(result.nextRound).toBe(2);
    expect(result.nextRoundLabel).toBe("\u7b2c\u4e8c\u904d");
  });

  it("does not allow incomplete or expired plans to upgrade", () => {
    expect(getPlanUpgradeAvailability({ currentRound: 1, progress: 99 }).eligible).toBe(false);
    expect(getPlanUpgradeAvailability({ currentRound: 1, progress: 100 }, { expired: true }).eligible).toBe(false);
  });

  it("recognizes an explicitly completed second round", () => {
    const result = getPlanUpgradeAvailability({
      currentRound: 2,
      progress: 0,
      isRound2Completed: true
    });

    expect(result.eligible).toBe(true);
    expect(result.nextRound).toBe(3);
    expect(result.nextRoundLabel).toBe("\u7b2c\u4e09\u904d");
  });

  it("renders upgrade actions in both the plan card and plan detail", () => {
    expect(planSource).toContain('import { getPlanUpgradeAvailability }');
    expect(planSource).toContain('id = "plan-persistent-upgrade-entry"');
    expect(planSource).toContain('data-plan-card-action="upgrade"');
    expect(planSource).toContain('renderPersistentPlanUpgradeEntry(state.activePlan)');
    expect(planSource).not.toContain('className = "glass-card congrats-inline-banner"');
    expect(css).toContain(".plan-persistent-upgrade-entry");
  });

  it("revalidates completion when the persistent action is used", () => {
    expect(planSource).toContain("if (!upgradeAvailability.eligible)");
    expect(planSource).toContain("const currentRound = upgradeAvailability.currentRound");
  });
});