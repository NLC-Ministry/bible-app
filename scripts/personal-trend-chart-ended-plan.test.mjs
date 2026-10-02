import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
// #370：統計、排行、組員狀況搬到 plan-stats.js。
const plan = read("js/modules/plan-stats.js");

// renderPersonalTrendChart()'s week/30-day/12-month windows used to be built
// from `new Date()` (real "today") no matter what. For an ended plan, every
// day that passes after the plan's own end date slides that window forward
// again, so the plan's actual reading days eventually fall outside the
// visible range and the chart renders as if nothing was ever read — the
// records get pushed out of view. Fix: anchor the window to the plan's own
// endDate once the plan has expired, so it stops drifting and keeps showing
// the real history.
describe("personal stats trend chart freezes its date window once the plan has ended", () => {
  const start = plan.indexOf("function renderPersonalTrendChart()");
  const end = plan.indexOf("// Render Chart.js", start);

  it("computes a single referenceDate clamped to the plan's endDate when isPlanExpired(), instead of letting each range branch call new Date() directly", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = plan.slice(start, end);

    expect(body).toMatch(/const referenceDate = \(typeof isPlanExpired === "function" && isPlanExpired\(state\.activePlan\) && state\.activePlan\.endDate\)/);
    expect(body).toContain('new Date(`${state.activePlan.endDate}T00:00:00`)');

    // Every branch (week / year / default 30-day) must read off referenceDate,
    // not call new Date() for "today" directly — a single leftover
    // `const today = new Date();` would silently re-introduce the drift for
    // that one range.
    const weekBranch = body.slice(body.indexOf('if (range === "week")'), body.indexOf('} else if (range === "year")'));
    const yearBranch = body.slice(body.indexOf('} else if (range === "year")'), body.indexOf('} else {'));
    const defaultBranch = body.slice(body.indexOf('} else {\n    // 30 days'));

    [weekBranch, yearBranch, defaultBranch].forEach(branch => {
      expect(branch).toContain("const today = referenceDate;");
      expect(branch).not.toMatch(/const today = new Date\(\);/);
    });
  });
});
