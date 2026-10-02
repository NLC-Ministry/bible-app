import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// #370：統計、排行、組員狀況（含 Chart.js 載入）拆成 plan-stats lazy chunk，用到時才下載。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const app = read("js/app.js");
const plan = read("js/modules/plan.js");
const planStats = read("js/modules/plan-stats.js");

const VIEWS = ["renderPlanStatsView", "renderPlanRankingView", "renderPlanMembersView", "populateMembersSelector"];

describe("plan-stats lazy chunk", () => {
  it("app.js 以字面值 import() 登記，並在載入 plan.js 時把載入函式交給它", () => {
    expect(app).toContain("'plan-stats': () => import('./modules/plan-stats.js'),");
    const start = app.indexOf("async function loadModule(name) {");
    const body = app.slice(start, app.indexOf("\n}\n", start));
    expect(body).toContain("if (name === 'plan' && typeof mod.registerPlanStatsLoader === 'function') {");
    expect(body).toContain("mod.registerPlanStatsLoader(() => loadModule('plan-stats'));");
  });

  it("plan.js 不靜態 import plan-stats，也不再碰 Chart.js", () => {
    expect(plan).not.toMatch(/from\s+["']\.\/plan-stats\.js["']/);
    expect(plan).not.toContain("chart-loader.mjs");
    expect(plan).not.toContain("new Chart(");
    expect(plan).not.toContain("function renderOrUpdateChart(");
  });

  it("plan.js 的四個同名函式只是載入 plan-stats 後轉呼叫", () => {
    expect(plan).toContain("export function registerPlanStatsLoader(load) {");
    for (const name of VIEWS) {
      const start = plan.indexOf(`async function ${name}() {`);
      expect(start).toBeGreaterThan(-1);
      const body = plan.slice(start, plan.indexOf("\n}\n", start));
      expect(body).toContain(`(await loadPlanStats()).${name}()`);
    }
    // admin.js 以同步 try/catch 呼叫 populateMembersSelector：載入失敗要在包裝裡接住。
    const populate = plan.slice(plan.indexOf("async function populateMembersSelector() {"));
    expect(populate.slice(0, populate.indexOf("\n}\n"))).toContain("catch (e)");
  });

  it("plan-stats.js 有真正的實作並匯出四個畫面函式", () => {
    for (const name of VIEWS) {
      expect(planStats).toMatch(new RegExp(`^(async )?function ${name}\\(`, "m"));
    }
    expect(planStats).toMatch(/export \{\s*populateMembersSelector,\s*renderPlanMembersView,\s*renderPlanRankingView,\s*renderPlanStatsView\s*\};/);
    expect(planStats).toContain('import { ensureChartLib } from "./chart-loader.mjs";');
  });

  it("首頁的統計彈窗留在 plan.js，不必先下載 plan-stats", () => {
    expect(plan).toContain("window.showPlanStatsModal = function () {");
    expect(planStats).not.toContain("window.showPlanStatsModal");
  });
});
