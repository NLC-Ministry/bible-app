import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

let dom;
let renderAdminLightningQuizStats;
let downloads;

const days = [
  { questionId: "q1", status: "published", riseDate: "2026-09-24", attemptedCount: 2, completedCount: 2, correctCount: 1, totalEligible: 10, participationRate: 0.2, avgElapsedMs: 5000 }
];

const results = {
  questionId: "q1",
  status: "published",
  riseDate: "2026-09-24",
  attempts: [
    { name: "王小明", greatRegion: "北區", pastoralZone: "信義牧區", smallGroup: "A 組", regionSort: 1, zoneSort: 1, status: "correct", elapsedMs: 4200, completedAt: "2026-09-24T01:00:00Z" },
    { name: "李小華", greatRegion: "南區", pastoralZone: "前鎮牧區", smallGroup: "B 組", regionSort: 2, zoneSort: 1, status: "wrong", elapsedMs: 9100, completedAt: "2026-09-24T01:02:00Z" }
  ],
  eligible: [
    { greatRegion: "北區", pastoralZone: "信義牧區", regionSort: 1, zoneSort: 1, count: 6 },
    { greatRegion: "南區", pastoralZone: "前鎮牧區", regionSort: 2, zoneSort: 1, count: 4 }
  ]
};

const weekData = {
  weekStart: "2026-09-21",
  weekEnd: "2026-09-27",
  questions: [
    { questionId: "q1", status: "published", riseDate: "2026-09-21", completedCount: 2, correctCount: 1 },
    { questionId: "q2", status: "published", riseDate: "2026-09-23", completedCount: 1, correctCount: 1 }
  ],
  members: [
    { userId: "u1", name: "王小明", greatRegion: "北區", pastoralZone: "信義牧區", smallGroup: "A 組", regionSort: 1, zoneSort: 1, answered: 2, correct: 2, correctElapsedMs: 7000 },
    { userId: "u2", name: "李小華", greatRegion: "南區", pastoralZone: "前鎮牧區", smallGroup: "B 組", regionSort: 2, zoneSort: 1, answered: 1, correct: 0, correctElapsedMs: 0 }
  ],
  eligible: results.eligible
};

const weeks = [
  { weekStart: "2026-09-21", weekEnd: "2026-09-27", questionCount: 2, participants: 2, allAnswered: 1, completedAttempts: 3, correctAttempts: 2, avgElapsedMs: 5000, totalEligible: 10 }
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 用 index.html 裡真正的快問快答區塊（作答明細是它裡面的完整頁面，#317）
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sectionHtml = indexHtml.slice(
  indexHtml.indexOf('<div id="admin-section-lightning-quiz"'),
  indexHtml.indexOf('<div id="admin-section-settings"')
);

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM(`<!doctype html><body><section class="view-pane active">${sectionHtml}</section></body>`, { url: "https://example.test" });
  downloads = [];
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("state", { currentUser: { role: "admin" }, activePlan: null });
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  vi.stubGlobal("db", {
    adminGetLightningQuizTrend: vi.fn(async () => ({ success: true, data: { days } })),
    adminGetLightningQuizResults: vi.fn(async () => ({ success: true, data: results })),
    adminGetLightningQuizWeek: vi.fn(async () => ({ success: true, data: weekData })),
    adminGetLightningQuizWeeks: vi.fn(async () => ({ success: true, data: { weeks } }))
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  // 攔截 CSV 下載：記下 Blob 內容與檔名，不真的觸發瀏覽器下載
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { downloads.push({ blob }); return "blob:test"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads[downloads.length - 1].filename = this.getAttribute("download"); };
  ({ renderAdminLightningQuizStats } = await import("../js/modules/admin.js?admin-lightning-quiz-analytics"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom.window.close();
});

describe("快問快答 作答明細", () => {
  it("opens overview, zone and region tables for a question and exports each as CSV", async () => {
    await renderAdminLightningQuizStats();
    document.querySelector('[data-lq-stats-tab="daily"]').click();
    document.querySelector('[data-lightning-quiz-detail="q1"]').click();
    await flush();

    expect(db.adminGetLightningQuizResults).toHaveBeenCalledWith("q1");
    // 作答明細是完整頁面：快問快答主畫面先隱藏
    const page = document.getElementById("admin-lightning-quiz-results");
    expect(page.classList.contains("hidden")).toBe(false);
    expect(document.querySelector(".admin-lq").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("admin-lightning-quiz-results-title").textContent).toContain("作答明細");
    const detail = document.getElementById("admin-lightning-quiz-results-body");
    // 名次（#316）：答對的有名次，答錯的顯示「—」
    const rows = [...detail.querySelectorAll("[data-lq-overview-body] tr")].map(row => [...row.cells].slice(0, 2).map(cell => cell.textContent));
    expect(rows).toEqual([["1", "王小明"], ["—", "李小華"]]);
    expect(document.querySelector("[data-lightning-quiz-leaderboard]")).toBeNull();
    expect(detail.textContent).toContain("牧區分析");
    expect(detail.textContent).toContain("大區分析");
    expect(detail.textContent).toContain("全教會合計");

    // 篩選「答錯」後匯出，只匯出篩選後的名單
    const status = detail.querySelector("[data-lq-overview-status]");
    status.value = "wrong";
    status.dispatchEvent(new dom.window.Event("change"));
    expect(detail.querySelector("[data-lq-overview-body]").textContent).not.toContain("王小明");

    detail.querySelector('[data-lq-export="overview"]').click();
    detail.querySelector('[data-lq-export="zone"]').click();
    detail.querySelector('[data-lq-export="region"]').click();
    expect(downloads.map(d => d.filename)).toEqual([
      "快問快答_作答總覽_2026-09-24.csv",
      "快問快答_牧區分析_2026-09-24.csv",
      "快問快答_大區分析_2026-09-24.csv"
    ]);
    const overviewCsv = await downloads[0].blob.text();
    expect(overviewCsv).toContain("李小華");
    expect(overviewCsv).not.toContain("王小明");
    expect(overviewCsv).toContain('"名次","姓名"');

    document.querySelector("#admin-lightning-quiz-results [data-lq-subpage-back]").click();
    await flush();
    expect(page.classList.contains("hidden")).toBe(true);
    expect(document.querySelector(".admin-lq").classList.contains("hidden")).toBe(false);
  });

  it("opens on the weekly view: summary, leaderboard, org tables, per-question detail and CSV exports", async () => {
    await renderAdminLightningQuizStats();
    await flush();

    const panel = document.querySelector('[data-lq-stats-panel="week"]');
    expect(panel.classList.contains("hidden")).toBe(false);
    expect(document.querySelector('[data-lq-stats-panel="daily"]').classList.contains("hidden")).toBe(true);
    expect(db.adminGetLightningQuizWeek).toHaveBeenCalledTimes(1);
    expect(db.adminGetLightningQuizWeek.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = panel.textContent;
    expect(text).toContain("本週");
    expect(text).toContain("2 / 10 人（20.0%）");
    expect(text).toContain("2 題全答");
    expect(text).toContain("1. 王小明");
    expect(text).not.toContain("2. 李小華"); // 沒答對的人不上榜
    expect(text).toContain("大區分析");
    expect(text).toContain("牧區分析");

    panel.querySelector('[data-lq-week-question="q1"]').click();
    await flush();
    expect(db.adminGetLightningQuizResults).toHaveBeenCalledWith("q1");
    expect(document.getElementById("admin-lightning-quiz-results").classList.contains("hidden")).toBe(false);
    document.querySelector("#admin-lightning-quiz-results [data-lq-subpage-back]").click();
    await flush();

    panel.querySelector('[data-lq-week-export="members"]').click();
    panel.querySelector('[data-lq-week-export="region"]').click();
    panel.querySelector('[data-lq-week-export="zone"]').click();
    expect(downloads.map(d => d.filename)).toEqual([
      "快問快答_週名單_2026-09-21週.csv",
      "快問快答_週大區分析_2026-09-21週.csv",
      "快問快答_週牧區分析_2026-09-21週.csv"
    ]);
    expect(await downloads[0].blob.text()).toContain('"1","王小明"');
  });

  it("moves between weeks; the next button stops at this week", async () => {
    await renderAdminLightningQuizStats();
    await flush();
    const panel = document.querySelector('[data-lq-stats-panel="week"]');
    const thisWeek = db.adminGetLightningQuizWeek.mock.calls[0][0];
    expect(panel.querySelector("[data-lq-week-next]").disabled).toBe(true);

    panel.querySelector("[data-lq-week-prev]").click();
    await flush();
    const prevWeek = db.adminGetLightningQuizWeek.mock.calls[1][0];
    expect(new Date(thisWeek) - new Date(prevWeek)).toBe(7 * 24 * 3600 * 1000);
    expect(panel.querySelector("[data-lq-week-next]").disabled).toBe(false);

    panel.querySelector("[data-lq-week-today]").click();
    await flush();
    expect(db.adminGetLightningQuizWeek.mock.calls[2][0]).toBe(thisWeek);
  });

  it("switches to the 週趨勢 tab and exports the weekly trend CSV even if Chart.js cannot load", async () => {
    await renderAdminLightningQuizStats();
    document.querySelector('[data-lq-stats-tab="trend"]').click();
    await flush();
    await flush();

    const trend = document.querySelector('[data-lq-stats-panel="trend"]');
    expect(trend.classList.contains("hidden")).toBe(false);
    expect(db.adminGetLightningQuizWeeks).toHaveBeenCalledTimes(1);
    expect(trend.querySelector("[data-lq-trend-from]").value).toBe("2026-09-21");
    expect(trend.textContent).toContain("9/21～9/27");
    expect(trend.textContent).toContain("20.0%");
    expect(trend.textContent).toContain("66.7%");

    trend.querySelector("[data-lq-trend-export]").click();
    expect(downloads[0].filename).toMatch(/^快問快答_週趨勢_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await downloads[0].blob.text()).toContain('"2026-09-21","2","2","10","20.0%","1","2","3","66.7%","5.0"');
  });
});
