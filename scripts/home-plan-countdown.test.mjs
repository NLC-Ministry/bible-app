import { describe, expect, it } from "vitest";
import { formatUpcomingPlanCountdown } from "../js/modules/home-plan-countdown.mjs";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../js/modules/home.js", import.meta.url), "utf8");

describe("home upcoming plan countdown", () => {
  it("shows the number of calendar days before the plan starts", () => {
    expect(formatUpcomingPlanCountdown("2026-08-05", new Date(2026, 6, 30, 23, 59)))
      .toBe("倒數 6 天");
    expect(formatUpcomingPlanCountdown("2026-07-31", new Date(2026, 6, 30, 12)))
      .toBe("倒數 1 天");
  });

  it("does not show zero, negative, or invalid countdowns", () => {
    expect(formatUpcomingPlanCountdown("2026-07-30", new Date(2026, 6, 30, 8))).toBe("");
    expect(formatUpcomingPlanCountdown("2026-07-29", new Date(2026, 6, 30, 8))).toBe("");
    expect(formatUpcomingPlanCountdown("2026-02-30", new Date(2026, 0, 1))).toBe("");
    expect(formatUpcomingPlanCountdown("", new Date(2026, 6, 30))).toBe("");
  });

  it("uses the countdown in both homepage waiting labels", () => {
    expect(home).toContain("formatUpcomingPlanCountdown(state.activePlan.startDate)");
    expect(home).toContain("`等待開始・${countdownText}`");
    expect(home).toContain("${waitingLabel}</span> (將於");
    expect(home).toContain('stat-badge stat-badge--brand">${waitingLabel}');
  });
});