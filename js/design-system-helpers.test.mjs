import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getHonorBadgeItemClasses,
  getMobileNavAriaState,
  getPlanProgressBadgeClass,
  getPlanProgressStatus,
  getStatMetricConfig,
} from "./design-system-helpers.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function makePlan(overrides = {}) {
  const days = Array.from({ length: 10 }, (_, i) => ({
    dayNum: i + 1,
    chapters: [{ book: "創", chapter: i + 1, isReadR1: i < 3 }],
  }));
  return {
    startDate: "2026-01-01",
    days,
    currentRound: 1,
    ...overrides,
  };
}

describe("getPlanProgressBadgeClass", () => {
  it("returns danger when behind schedule", () => {
    const plan = makePlan();
    const badgeClass = getPlanProgressBadgeClass(plan, {
      getExpected: () => 5,
      getNextDay: () => plan.days[2],
    });
    expect(badgeClass).toBe("stat-badge--danger");
  });

  it("returns success when ahead of schedule", () => {
    const plan = makePlan();
    const badgeClass = getPlanProgressBadgeClass(plan, {
      getExpected: () => 2,
      getNextDay: () => plan.days[5],
    });
    expect(badgeClass).toBe("stat-badge--success");
  });

  it("returns brand when on schedule", () => {
    const plan = makePlan();
    const badgeClass = getPlanProgressBadgeClass(plan, {
      getExpected: () => 3,
      getNextDay: () => plan.days[3],
    });
    expect(badgeClass).toBe("stat-badge--brand");
  });

  it("returns warning for round 3", () => {
    const plan = makePlan({ currentRound: 3 });
    expect(getPlanProgressBadgeClass(plan)).toBe("stat-badge--warning");
  });
});

describe("getStatMetricConfig", () => {
  it("maps streak to fire icon and warning modifier", () => {
    expect(getStatMetricConfig("streak")).toEqual({
      icon: "fire",
      modifier: "warning",
    });
  });

  it("maps today to book icon and brand modifier", () => {
    expect(getStatMetricConfig("today")).toEqual({
      icon: "bookOpen",
      modifier: "brand",
    });
  });
});

describe("getHonorBadgeItemClasses", () => {
  it("returns unlocked and locked class strings", () => {
    expect(getHonorBadgeItemClasses(true)).toBe("honor-badge-item unlocked");
    expect(getHonorBadgeItemClasses(false)).toBe("honor-badge-item locked");
  });
});

describe("getMobileNavAriaState", () => {
  it("marks active tab with aria-current page", () => {
    const state = getMobileNavAriaState("dashboard-view", "dashboard-view");
    expect(state.ariaSelected).toBe("true");
    expect(state.ariaCurrent).toBe("page");
    expect(state.className).toContain("active");
  });

  it("marks inactive tab without aria-current", () => {
    const state = getMobileNavAriaState("dashboard-view", "plan-view");
    expect(state.ariaSelected).toBe("false");
    expect(state.ariaCurrent).toBeUndefined();
  });
});

describe("getPlanProgressStatus labels", () => {
  it("labels behind schedule as 落後", () => {
    const plan = makePlan();
    const status = getPlanProgressStatus(plan, {
      getExpected: () => 5,
      getNextDay: () => plan.days[2],
    });
    expect(status.label).toMatch(/^落後/);
  });
});

describe("static markup audit", () => {
  it("profile badges card uses profile-badges-card without slate/zinc classes", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toMatch(/class="profile-badges-card"[^>]*id="profile-badges-inner-card"/);
    expect(html).not.toMatch(/profile-badges-inner-card[^>]*slate-/);
    expect(html).not.toMatch(/profile-badges-inner-card[^>]*zinc-/);
  });

  it("plan-progress-bar uses progress fill token not success mint", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    const barRule = css.match(/\.plan-progress-bar\s*\{[^}]+\}/);
    expect(barRule).toBeTruthy();
    expect(barRule[0]).toMatch(/var\(--color-progress-fill\)/);
    expect(barRule[0]).not.toMatch(/--color-success\)/);
  });
});
