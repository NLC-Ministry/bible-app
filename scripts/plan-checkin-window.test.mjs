import { describe, expect, it } from "vitest";
import {
  getPlanCheckInDeadline,
  isPlanCheckInClosed,
  isPlanCheckInClosedError,
  isPlanInGracePeriod,
  normalizeGraceDays
} from "../js/data/plan-checkin-window.mjs";
import { getPlanGraceNotice } from "../js/data/plan-ended-copy.mjs";

const fixedPlan = (graceDays) => ({ isFixed: true, endDate: "2026-09-30", graceDays });

describe("plan check-in window (#412)", () => {
  it("defaults to no grace: the end date is the last check-in day", () => {
    const plan = fixedPlan(undefined);
    expect(getPlanCheckInDeadline(plan)).toBe("2026-09-30");
    expect(isPlanCheckInClosed(plan, { todayISO: "2026-09-30" })).toBe(false);
    expect(isPlanCheckInClosed(plan, { todayISO: "2026-10-01" })).toBe(true);
    expect(isPlanInGracePeriod(plan, { todayISO: "2026-10-01" })).toBe(false);
  });

  it("keeps check-in open for graceDays after the end date, across a month boundary", () => {
    const plan = fixedPlan(3);
    expect(getPlanCheckInDeadline(plan)).toBe("2026-10-03");
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      expect(isPlanCheckInClosed(plan, { todayISO: day })).toBe(false);
      expect(isPlanInGracePeriod(plan, { todayISO: day })).toBe(true);
    }
    expect(isPlanCheckInClosed(plan, { todayISO: "2026-10-04" })).toBe(true);
    expect(isPlanInGracePeriod(plan, { todayISO: "2026-10-04" })).toBe(false);
    expect(isPlanInGracePeriod(plan, { todayISO: "2026-09-30" })).toBe(false);
  });

  it("reads the DB column name too and handles year ends", () => {
    expect(getPlanCheckInDeadline({ is_fixed: true, end_date: "2026-12-31", grace_days: 2 })).toBe("2027-01-02");
  });

  it("never closes flexible plans or plans without an end date", () => {
    expect(isPlanCheckInClosed({ isFixed: false, endDate: "2020-01-01" }, { todayISO: "2026-10-01" })).toBe(false);
    expect(isPlanCheckInClosed({ isFixed: true }, { todayISO: "2026-10-01" })).toBe(false);
    expect(isPlanCheckInClosed(null)).toBe(false);
  });

  it("clamps grace days to 0–30 whole days", () => {
    expect(normalizeGraceDays(null)).toBe(0);
    expect(normalizeGraceDays(-2)).toBe(0);
    expect(normalizeGraceDays("3")).toBe(3);
    expect(normalizeGraceDays(2.9)).toBe(2);
    expect(normalizeGraceDays(99)).toBe(30);
  });

  it("judges today in Taipei time, like the server trigger", () => {
    const plan = fixedPlan(0);
    // 2026-09-30T16:30Z is already 10/01 00:30 in Taipei.
    expect(isPlanCheckInClosed(plan, { now: new Date("2026-09-30T16:30:00Z") })).toBe(true);
    expect(isPlanCheckInClosed(plan, { now: new Date("2026-09-30T15:30:00Z") })).toBe(false);
  });

  it("recognises the server's plan-closed rejection", () => {
    expect(isPlanCheckInClosedError(new Error("reading_log_plan_closed"))).toBe(true);
    expect(isPlanCheckInClosedError({ error: "reading_log_plan_closed", code: "P0001" })).toBe(true);
    expect(isPlanCheckInClosedError({ code: "reading_log_plan_closed" })).toBe(true);
    expect(isPlanCheckInClosedError(new Error("Failed to fetch"))).toBe(false);
    expect(isPlanCheckInClosedError(null)).toBe(false);
  });

  it("tells members the plan ended but they can still catch up until the deadline", () => {
    expect(getPlanGraceNotice("2026-09-30", "2026-10-03")).toBe("計畫已於 9/30 結束，寬限期內（到 10/3）仍可補打卡。");
  });
});
