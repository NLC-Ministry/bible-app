import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getExplorePlanVisibility } from "../js/modules/explore-plan-visibility.mjs";
import { formatPlanEndDate, getPlanEndedNotice } from "../js/data/plan-ended-copy.mjs";

const home = readFileSync(new URL("../js/modules/home.js", import.meta.url), "utf8");
const plan = readFileSync(new URL("../js/modules/plan.js", import.meta.url), "utf8");
const bible = readFileSync(new URL("../js/modules/bible.js", import.meta.url), "utf8");

describe("explore plan visibility (#372)", () => {
  it("shows ordinary open plans to everyone", () => {
    expect(getExplorePlanVisibility({})).toEqual({ visible: true, managerOnly: false });
  });

  it("hides ended plans from everyone, admins included", () => {
    expect(getExplorePlanVisibility({ expired: true }).visible).toBe(false);
    expect(getExplorePlanVisibility({ expired: true, viewerRole: "admin", canManageHidden: true }).visible).toBe(false);
  });

  it("hides locked monthly finals (discoverWhenLocked) from members", () => {
    const lockedFinal = { hidden: true, lockedStage: true, discoverableWhileLocked: true };
    expect(getExplorePlanVisibility(lockedFinal)).toEqual({ visible: false, managerOnly: false });
    expect(getExplorePlanVisibility({ ...lockedFinal, viewerRole: "pastor", canManageHidden: true }))
      .toEqual({ visible: true, managerOnly: true });
  });

  it("keeps later locked stages admin-only", () => {
    const lockedStage = { hidden: true, lockedStage: true, discoverableWhileLocked: false };
    expect(getExplorePlanVisibility({ ...lockedStage, viewerRole: "pastor", canManageHidden: true }).visible).toBe(false);
    expect(getExplorePlanVisibility({ ...lockedStage, viewerRole: "admin", canManageHidden: true }))
      .toEqual({ visible: true, managerOnly: true });
  });

  it("lets managers preview other hidden plans, marked as hidden from members", () => {
    expect(getExplorePlanVisibility({ hidden: true }).visible).toBe(false);
    expect(getExplorePlanVisibility({ hidden: true, canManageHidden: true }))
      .toEqual({ visible: true, managerOnly: true });
  });

  it("drops the 'open for pre-join' line from locked stage cards", () => {
    expect(plan).toContain("const upcomingNotice = isUpcomingFixed && !isLockedStage");
  });
});

describe("ended plan copy (#372)", () => {
  it("formats the end date as M/D", () => {
    expect(formatPlanEndDate("2026-09-30")).toBe("9/30");
    expect(formatPlanEndDate("")).toBe("");
    expect(formatPlanEndDate("bad")).toBe("");
  });

  it("says the plan ended and records are kept, instead of 'cannot enter'", () => {
    expect(getPlanEndedNotice("2026-09-30")).toBe("此計畫已於 9/30 結束，紀錄與成績都已保存，可以查看但無法再打卡。");
    expect(getPlanEndedNotice(null)).toBe("此計畫已結束，紀錄與成績都已保存，可以查看但無法再打卡。");
  });

  it("no longer uses the old 'expired / cannot enter' wording", () => {
    for (const source of [home, plan, bible]) {
      expect(source).not.toContain("此計畫已過期");
    }
  });
});

describe("home plan card after the plan ends (#372)", () => {
  it("shows an ended badge and end date instead of an ever-growing day count", () => {
    expect(home).toContain('const ended = typeof isPlanExpired === "function" && isPlanExpired(state.activePlan);');
    expect(home).toContain('<span class="stat-badge stat-badge--neutral">已結束</span>');
    expect(home).toContain("已於 ${endDateLabel} 結束");
  });

  it("offers 查看紀錄 and 找下一個計畫 instead of buttons that only toast", () => {
    expect(home).toContain(">查看紀錄</button>");
    expect(home).toContain("appRouter.switchTab('plan-view', { onboardingPlanDestination: 'discover' })\">找下一個計畫</button>");
  });

  it("lets the dashboard open an ended plan for viewing, like the plan tab does", () => {
    const opener = home.slice(home.indexOf("window.openActivePlanFromDashboard = function"));
    const body = opener.slice(0, opener.indexOf("};"));
    expect(body).not.toContain("isPlanExpired");
  });
});
