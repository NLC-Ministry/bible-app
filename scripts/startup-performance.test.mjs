import { afterEach, describe, expect, it, vi } from "vitest";
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
    const reportSchedule = app.lastIndexOf("scheduleIssueReportUiLoad()");
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
  });

  // #551：管理分頁只載入組長用的 pastoral.js；系統管理（admin.js、plan-admin.js、
  // campaign-rule-editor.js、回報管理）在管理後台，會友 App 一支都不載入。
  it("the 管理 tab loads only the leader view, never the system-admin bundles", () => {
    const adminBranch = app.slice(
      app.indexOf('} else if (tabId === "admin-view")'),
      app.indexOf("// ── 6. updateNavigationChrome", app.indexOf('} else if (tabId === "admin-view")'))
    );
    expect(adminBranch).toContain("await loadModule('pastoral')");
    expect(adminBranch).toContain("await pastoral.renderPastoralView()");
    expect(adminBranch).not.toMatch(/loadModule\('(admin|plan-admin|campaign-rule-editor)'\)|includeAdmin/);
    expect(app).not.toMatch(/import\(['"][^'"]*modules\/(admin|plan-admin|campaign-rule-editor)\.js['"]\)/);
    expect(app).toContain("pastoral: () => import('./modules/pastoral.js')");
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
// Since #418 the build rewrites that pinned CDN tag to a same-origin hashed copy of
// vendor/supabase-js/<version>/supabase.js (still synchronous, still on the critical
// path) — see scripts/bundle.test.mjs. The source tag stays the single place the version lives.
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

// #670：中文改用系統字型。Noto Sans TC 佔 Google 字型 CSS 的 96%（擋住首次繪製），
// 而 Android 內建的 Noto Sans CJK TC 就是同一套設計，不再從 Google 下載。
describe("web fonts: Chinese uses system fonts, no Noto Sans TC download (#670)", () => {
  const css = readFileSync("index.css", "utf8");

  it("no entry HTML requests Noto Sans TC from Google Fonts", () => {
    for (const html of [indexHtml, examHtml, gradeHtml]) {
      const link = html.match(/fonts\.googleapis\.com\/css2\?[^"'\s]+/);
      expect(link, "google fonts link").toBeTruthy();
      expect(link[0]).not.toMatch(/Noto/);
    }
  });

  it("every Inter body font stack falls back to system CJK fonts in order", () => {
    const stacks = css.match(/font-family:\s*'Inter'[^;]*;/g) || [];
    expect(stacks.length).toBeGreaterThan(0);
    for (const stack of stacks) {
      expect(stack).toMatch(
        /'Inter',\s*'PingFang TC',\s*'Noto Sans CJK TC',\s*'Noto Sans TC',\s*'Microsoft JhengHei',\s*sans-serif/,
      );
    }
  });
});

// #668：同一天再開 App，背景圖在解析 HTML 時就開始下載，不等 app.js／home chunk。
describe("verse card image preload", () => {
  const IMAGE_URL = "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=800&q=80";
  const preloadScript = (() => {
    const open = indexHtml.indexOf('<script id="verse-card-preload">');
    if (open < 0) return "";
    const start = indexHtml.indexOf(">", open) + 1;
    return indexHtml.slice(start, indexHtml.indexOf("</script>", start));
  })();

  afterEach(() => vi.useRealTimers());

  // 回傳這次開機被加進 <head> 的 preload link（沒有預抓就是空陣列）
  function run({ pathname = "/", search = "", hash = "", store = {}, now = "2026-11-05T04:00:00Z", storage } = {}) {
    vi.useFakeTimers({ now: new Date(now), toFake: ["Date"] });
    const appended = [];
    const document = {
      createElement: (tag) => {
        const attrs = { tag };
        return { setAttribute: (key, value) => { attrs[key] = value; }, attrs };
      },
      head: { appendChild: (el) => appended.push(el.attrs) },
    };
    const localStorage = storage || { getItem: (key) => (key in store ? store[key] : null) };
    new Function("location", "localStorage", "document", preloadScript)({ pathname, search, hash }, localStorage, document);
    return appended;
  }

  const sameDay = { daily_verse_saved_date: "2026-11-05", daily_verse_bg: IMAGE_URL };

  it("preloads today's saved image at high priority when it is the same day", () => {
    for (const pathname of ["/", "/index.html"]) {
      expect(run({ pathname, store: sameDay })).toEqual([
        { tag: "link", rel: "preload", as: "image", href: IMAGE_URL, fetchpriority: "high" },
      ]);
    }
  });

  it("compares against the Taipei date, in the same format fetchRandomVerse saves", () => {
    // UTC 11/05 16:30 已經是台北 11/06
    const now = "2026-11-05T16:30:00Z";
    expect(run({ now, store: sameDay })).toEqual([]);
    expect(run({ now, store: { ...sameDay, daily_verse_saved_date: "2026-11-06" } })).toHaveLength(1);
    // 兩邊格式一分歧，同一天也永遠比對不到，預抓就默默失效。
    const dateExpression = "new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\\//g, '-')";
    const saved = home.slice(home.indexOf("async function fetchRandomVerse"));
    expect(saved).toContain(dateExpression);
    expect(preloadScript).toContain(dateExpression);
  });

  it("does not fetch anything on a new day, so the day's random pick stays one request", () => {
    expect(run({ store: { ...sameDay, daily_verse_saved_date: "2026-11-04" } })).toEqual([]);
    expect(run({ store: { daily_verse_saved_date: "2026-11-05" } })).toEqual([]);
    expect(run({ store: {} })).toEqual([]);
  });

  it("does not preload on deep links, return URLs or quick launch", () => {
    expect(run({ pathname: "/read", store: sameDay })).toEqual([]);
    expect(run({ search: "?from=notification", store: sameDay })).toEqual([]);
    expect(run({ hash: "#/plan", store: sameDay })).toEqual([]);
    expect(run({ store: { ...sameDay, quick_launch_bible_enabled: "true" } })).toEqual([]);
  });

  it("does nothing when localStorage cannot be read", () => {
    const storage = { getItem: () => { throw new Error("blocked"); } };
    expect(run({ storage })).toEqual([]);
  });

  it("runs before anything that can make the parser wait", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    const script = head.indexOf('id="verse-card-preload"');
    expect(script).toBeGreaterThan(head.indexOf('id="quick-launch-redirect"'));
    expect(script).toBeLessThan(head.indexOf('rel="stylesheet"'));
    expect(script).toBeLessThan(head.indexOf("<script src="));
  });

  it("preconnects to the image host without crossorigin, because the images load as no-cors", () => {
    expect(indexHtml).toContain('<link rel="preconnect" href="https://images.unsplash.com">');
  });

  it("marks #card-bg as high priority", () => {
    expect(indexHtml).toMatch(/<img id="card-bg"[^>]*\sfetchpriority="high"/);
  });
});
