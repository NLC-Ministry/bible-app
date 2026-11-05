// #673 的 parity 測試用：實際跑 js/db.js 和 js/modules/plan-stats.js（組員總覽、組織統計樹、兩份 CSV），
// 只有 plan.js 換成替身（它只提供下拉選單與路由常數）。兩條路徑（舊的逐筆、新的彙總）走完全相同的畫面程式碼，
// 這裡把畫面上看得到的東西全部收起來，給呼叫端逐人逐欄比對。
import { JSDOM } from "jsdom";
import { vi } from "vitest";

const FIXED_EXPORT_TIME = new Date("2026-11-05T00:00:00Z");

const PAGE = `<!doctype html><body>
  <div id="stats-group-section"></div>
  <div id="ranking-title"></div>
  <input id="member-search-input" value="" />
  <div id="ranking-participants-list"></div>
  <div id="admin-org-stats-tree"></div>
  <button id="admin-org-stats-export-zones-btn"></button>
</body>`;

// 舊算法的日程來源：沒有活動定義的計畫用 plan.days（同 getCanonicalStageScheduleDays 的退路）。
export function createRosterApp({ bibleBooks }) {
  let dom;
  let loaded = null;

  async function load() {
    if (loaded) return loaded;
    vi.doMock("../../js/modules/plan.js", () => ({
      PLAN_ROUTE: { LIST: "LIST", DETAIL: "DETAIL", GROUP: "GROUP", ORG_STATS: "ORG_STATS" },
      getLeadershipAssignmentNodeNames: () => "",
      getPlanProgressStatus: () => ({}),
      logMatchesPlan: () => true,
      populateStatsSelector: () => {},
      prepareReadingTeamSubview: async () => true,
      setupCascadingSelectors: () => {}
    }));
    dom = new JSDOM(PAGE, { url: "https://example.test/" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("getUserRoleCode", () => "admin");
    vi.stubGlobal("hasWholeChurchPlanScope", () => true);
    vi.stubGlobal("BIBLE_BOOKS", bibleBooks);
    vi.stubGlobal("escapeHTML", value => String(value ?? ""));
    vi.stubGlobal("hydrateIcons", () => {});
    vi.stubGlobal("firstPaint", () => false);
    vi.stubGlobal("showToast", () => {});
    vi.stubGlobal("appRouter", { currentTab: "plan-view" });
    vi.stubGlobal("requestAnimationFrame", callback => { callback(); return 1; });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabase: null,
      currentUser: { id: "viewer", name: "看統計的人" },
      activePlan: null,
      readingLogs: [],
      globalPlans: [],
      orgStructure: { regions: [], zones: {}, groups: {} }
    });
    await import("../../js/db.js?plan-stats-roster-parity");
    globalThis.db = dom.window.db || globalThis.db;
    const planStats = await import("../../js/modules/plan-stats.js?plan-stats-roster-parity");
    loaded = { db: globalThis.db, planStats };
    return loaded;
  }

  // 走一次畫面：回傳名單的原始 users＋logsByUserId、組員總覽每一列、組織統計樹、兩份 CSV。
  async function render({ client, filter, statsPlan, globalPlans = [], orgStructure, pastoralZone = "" }) {
    const { db, planStats } = await load();
    const win = dom.window;
    globalThis.state.supabase = client;
    globalThis.state.globalPlans = globalPlans;
    globalThis.state.orgStructure = orgStructure;
    // 看的人自己沒有在這個計畫：每一列都走「別人」那條路
    globalThis.state.activePlan = { id: "viewer-own-plan", globalPlanId: "viewer-own-global", name: "看的人自己的計畫", days: [] };
    globalThis.state.adminManagementPlan = statsPlan;
    win.currentPlanViewState = "ORG_STATS";
    win._currentStatsTab = "group";
    win._statsTabScope = null;
    db.invalidateMergedUsersCache();

    // 資料層：照畫面實際帶的參數查一次（同一份快取）
    const rosterSchedule = statsPlan
      ? (await import("../../js/data/plan-stats-roster-summary.mjs")).buildPlanStatsRosterSchedule(statsPlan.days, statsPlan.startDate)
      : undefined;
    const merged = await db.fetchMergedUsersWithLogs(filter, { maxAgeMs: Infinity, pastoralZone, rosterSchedule, ignorePlanFilter: !filter });
    if (!statsPlan || pastoralZone) return { merged, rows: null, participantsCsv: null, orgTree: null, zoneCsv: null };

    await planStats.renderPlanStatsView();
    const rows = win._grpScopedProcessedMembers;
    const participantsCsv = win.convertParticipantsOverviewToCSV(rows, "全教會", FIXED_EXPORT_TIME);
    const orgTree = win.document.getElementById("admin-org-stats-tree").innerHTML;

    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(win.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const button = win.document.getElementById("admin-org-stats-export-zones-btn");
    // CSV 第一行是匯出時間，比對前拿掉
    let zoneCsv = "";
    if (button.dataset.listenerBound === "true") {
      button.click();
      await vi.waitFor(() => { if (!createUrl.mock.calls.length) throw new Error("waiting for the export"); });
      zoneCsv = (await createUrl.mock.calls[0][0].text()).split("\n").slice(1).join("\n");
    }
    createUrl.mockRestore();
    revoke.mockRestore();
    return { merged, rows, participantsCsv, orgTree, zoneCsv };
  }

  function close() {
    vi.doUnmock("../../js/modules/plan.js");
    vi.unstubAllGlobals();
    if (dom) dom.window.close();
    loaded = null;
  }

  return { render, close };
}
