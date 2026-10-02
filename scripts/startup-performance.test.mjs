import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("js/app.js", "utf8");
const home = readFileSync("js/modules/home.js", "utf8");
const db = readFileSync("js/db.js", "utf8");
const authJs = readFileSync("js/auth.js", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const examHtml = readFileSync("exam.html", "utf8");
const gradeHtml = readFileSync("grade.html", "utf8");
const planModule = readFileSync("js/modules/plan.js", "utf8");
// #370：統計、排行（含 Chart.js 圖表）搬到 plan-stats.js。
const planStatsModule = readFileSync("js/modules/plan-stats.js", "utf8");
const chartLoader = readFileSync("js/modules/chart-loader.mjs", "utf8");

describe("startup performance contract", () => {
  it("keeps React issue-report UI out of the initial app bundle", () => {
    expect(app).not.toContain("import React from 'react'");
    expect(app).not.toContain("from 'react-dom/client'");
    expect(app).not.toContain("../components/issue-report/IssueReportFab.tsx");
    expect(app).toContain("loadIssueReportUi");
    // Lazy via a literal dynamic import, so esbuild splits it into its own chunk
    // (bundle.test.mjs asserts React is absent from the built entry file).
    expect(app).toContain("'issue-report-ui': () => import('./modules/issue-report-ui.js')");
  });

  it("uses the injected production build id instead of cache-busting every launch", () => {
    expect(app).toContain('const buildVersion = "__BUILD_VERSION__";');
    expect(app).toContain("const appBuildId = /^\\d{14}$/.test(buildVersion) ? buildVersion : null;");
    expect(app).not.toContain('buildVersion.includes("__BUILD_VERSION__")');
  });

  it("schedules the issue report UI before PWA initialization can delay it", () => {
    const reportSchedule = app.lastIndexOf("scheduleIssueReportUiLoad({ includeAdmin: false })");
    const pwaInitialization = app.indexOf("await initializePwa()");

    expect(reportSchedule).toBeGreaterThan(-1);
    expect(pwaInitialization).toBeGreaterThan(-1);
    expect(reportSchedule).toBeLessThan(pwaInitialization);
    expect(app).toContain("window.setTimeout(() => {");
    expect(app).toContain("window.requestIdleCallback(load, { timeout: 5000 })");
    expect(app).toContain("}, 3000)");
  });

  it("keeps registration helper modules lazy until their surfaces need them", () => {
    expect(app).not.toContain("import './modules/campaign-rule-editor.js");
    expect(app).not.toContain("import './modules/team-registration.js");
    expect(app).toContain("ensurePlanFeatureModulesLoaded");
    expect(app).toContain("ensureAdminFeatureModulesLoaded");
  });

  it("renders plan management before loading secondary admin bundles", () => {
    const adminBranch = app.slice(
      app.indexOf('} else if (tabId === "admin-view")'),
      app.indexOf("// ── 6. updateNavigationChrome", app.indexOf('} else if (tabId === "admin-view")'))
    );
    const planRender = adminBranch.indexOf("await mod.renderAdminPlanManagement()");
    const secondaryLoad = adminBranch.indexOf("void Promise.all([");

    expect(planRender).toBeGreaterThan(-1);
    expect(secondaryLoad).toBeGreaterThan(planRender);
    expect(adminBranch).not.toContain("await loadIssueReportUi({ includeAdmin: true })");
    expect(adminBranch).not.toContain("await ensureAdminFeatureModulesLoaded()");
  });

  it("does not block first dashboard render on care reminder fetches", () => {
    const forcedReminder = app.lastIndexOf("refreshCareReminderBadge({ force: true })");
    // lastIndexOf: picks the default dashboard-view branch's marker, which
    // sits after quick-launch bible's own earlier "first-tab-rendered" mark
    // (see the sibling test file's comment for why quick-launch renders
    // before load — irrelevant here since forcedReminder sits after both).
    const firstTab = app.lastIndexOf('window.__bootMark?.("first-tab-rendered");');

    expect(forcedReminder).toBeGreaterThan(-1);
    expect(firstTab).toBeGreaterThan(-1);
    expect(forcedReminder).toBeGreaterThan(firstTab);
  });

  it("does not block first dashboard render on organization-directory loading", () => {
    const firstTab = app.lastIndexOf('window.__bootMark?.("first-tab-rendered");');
    const orgLoad = app.lastIndexOf("db.loadOrgStructure()");

    expect(firstTab).toBeGreaterThan(-1);
    expect(orgLoad).toBeGreaterThan(firstTab);
  });

  it("defers secondary dashboard widgets after the core dashboard card renders", () => {
    expect(home).toContain("scheduleDashboardSecondaryWork");
    expect(home).not.toContain("calculateAndRenderPersonalRankings();\n  renderPastoralZoneRankingList();\n  loadTodayDevotional();");
  });
});

// NOTE: A1 (lazy @supabase/supabase-js) was reverted — the real client with the
// anon key is the graceful-degradation read path for public tables (announcements,
// org structure, role_definitions) when the Logto session is dead. Removing it
// black-screened production for users with an expired session. The static
// <script> in index.html / exam.html / grade.html is intentional; do not remove.
describe("@supabase/supabase-js stays on the critical path (A1 reverted)", () => {
  it("every HTML entry point still loads the supabase CDN bundle synchronously, pinned to an exact version (A5)", () => {
    for (const html of [indexHtml, examHtml, gradeHtml]) {
      expect(html).toMatch(/<script[^>]+cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+/);
      expect(html).not.toMatch(/@supabase\/supabase-js@2["']/);
    }
  });

  it("createSupabaseClient is synchronous and db.init builds it unconditionally", () => {
    expect(db).toContain("createSupabaseClient(externalJwt = null) {");
    expect(db).not.toContain("ensureSupabaseLib");
    const initSlice = db.slice(db.indexOf("state.supabaseConfig = { url: sbUrl"), db.indexOf("state.supabaseConfig = { url: sbUrl") + 300);
    expect(initSlice).toContain("state.supabase = this.createSupabaseClient();");
  });
});

describe("Chart.js is off the critical path (A2)", () => {
  it("index.html no longer loads Chart.js with a static <script>", () => {
    expect(indexHtml).not.toMatch(/<script[^>]+cdn\.jsdelivr\.net\/npm\/chart\.js/);
  });

  it("chart-loader.mjs lazy-loads Chart.js via ensureChartLib, pinned to an exact version", () => {
    expect(chartLoader).toContain("export function ensureChartLib()");
    expect(chartLoader).toMatch(/cdn\.jsdelivr\.net\/npm\/chart\.js@\d+\.\d+\.\d+/);
    expect(chartLoader).not.toMatch(/cdn\.jsdelivr\.net\/npm\/chart\.js["']/);
    expect(planStatsModule).toContain('import { ensureChartLib } from "./chart-loader.mjs";');
  });

  it("renderOrUpdateChart self-heals when Chart is not loaded yet", () => {
    const fn = planStatsModule.slice(planStatsModule.indexOf("function renderOrUpdateChart("), planStatsModule.indexOf("function renderOrUpdateChart(") + 700);
    expect(fn).toContain('if (typeof Chart === "undefined") {');
    expect(fn).toContain("ensureChartLib()");
    expect(fn).toContain("renderOrUpdateChart(key, canvasEl, config)");
  });

  it("warms the Chart.js fetch when a chart-bearing sub-view opens", () => {
    expect(planStatsModule).toMatch(/async function renderPlanStatsView\(\)\s*\{\s*\n\s*ensureChartLib\(\)/);
    expect(planStatsModule).toMatch(/async function renderPlanRankingView\(\)\s*\{\s*\n\s*ensureChartLib\(\)/);
    // updateStatsView was removed 2026-09-16 (dead code — its "stats-view" tab
    // no longer exists in the tab bar; see plan.js's removal comment).
  });
});

describe("html2canvas is off the critical path (A3)", () => {
  const home = readFileSync("js/modules/home.js", "utf8");

  it("index.html no longer loads html2canvas with a static <script>", () => {
    expect(indexHtml).not.toMatch(/<script[^>]+html2canvas/);
  });

  it("home.js lazy-loads html2canvas via ensureHtml2CanvasLib, pinned to an exact version", () => {
    expect(home).toContain("function ensureHtml2CanvasLib()");
    expect(home).toMatch(/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas\/\d+\.\d+\.\d+\/html2canvas\.min\.js/);
  });

  it("shareAsImage awaits the lazy loader before calling html2canvas, and stays inside the existing try/catch", () => {
    const fn = home.slice(home.indexOf("async function shareAsImage("), home.indexOf("function fallbackDownload("));
    const awaitIdx = fn.indexOf("await ensureHtml2CanvasLib()");
    const callIdx = fn.indexOf("await html2canvas(card");
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(awaitIdx);
    // both must sit after the `try {` so a load failure hits the "分享失敗" catch
    expect(fn.indexOf("try {")).toBeGreaterThan(-1);
    expect(fn.indexOf("try {")).toBeLessThan(awaitIdx);
  });
});

describe("a stale NLC session must never black-screen the first render", () => {
  it("boot loads role definitions + user data with allSettled, not all", () => {
    const slice = app.slice(app.indexOf("// Load all user data in one shot"), app.indexOf('await appRouter.switchTab(resumePlan ? "plan-view"'));
    expect(slice).toContain("Promise.allSettled([");
    expect(slice).toContain("db.fetchRoleDefinitions()");
    expect(slice).toContain("db.loadUserData(true)");
    expect(slice).not.toContain("await Promise.all([\n      db.fetchRoleDefinitions()");
    // switchTab still runs after, so the dashboard (or the login gate on top of it) always paints.
    expect(app).toMatch(/userDataResult\.status === "fulfilled" && userDataResult\.value === true/);
  });

  it("fetchRoleDefinitions degrades to compatibility labels even when the shim throws", () => {
    const fn = db.slice(db.indexOf("async fetchRoleDefinitions()"), db.indexOf("async fetchMergedUsersList("));
    expect(fn).toContain("try {");
    expect(fn).toMatch(/catch \(err\) \{[\s\S]*state\.roleDefinitions = fallback;[\s\S]*return fallback;/);
  });
});

describe("web fonts: no unused Light (300) face downloaded (C)", () => {
  const css = readFileSync("index.css", "utf8");

  it("Google Fonts request drops the 300 weight for every family in every entry HTML", () => {
    for (const html of [indexHtml, examHtml, gradeHtml]) {
      const link = html.match(/fonts\.googleapis\.com\/css2\?[^"'\s]+/);
      expect(link, "google fonts link").toBeTruthy();
      expect(link[0]).not.toMatch(/wght@300\b/);
      expect(link[0]).toMatch(/Inter:wght@400;500;600;700/);
      expect(link[0]).toMatch(/Noto\+Sans\+TC:wght@400;500;700/);
      expect(link[0]).toMatch(/Outfit:wght@400;500;600;700/);
    }
  });

  it("no stylesheet rule asks for the now-unloaded weight 300", () => {
    expect(css).not.toMatch(/font-weight:\s*300\b/);
  });

  it("plan.js / plan-stats.js chart tick labels no longer request the unloaded weight 300", () => {
    expect(planModule).not.toMatch(/weight:\s*['"]300['"]/);
    expect(planStatsModule).not.toMatch(/weight:\s*['"]300['"]/);
  });
});
