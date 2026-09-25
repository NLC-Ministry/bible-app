import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

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

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM(`<!doctype html><body><div id="admin-lightning-quiz-stats-body"></div></body>`, { url: "https://example.test" });
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
    adminGetLightningQuizResults: vi.fn(async () => ({ success: true, data: results }))
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
    document.querySelector('[data-lightning-quiz-detail="q1"]').click();
    await flush();

    expect(db.adminGetLightningQuizResults).toHaveBeenCalledWith("q1");
    const detail = document.getElementById("admin-lightning-quiz-detail");
    expect(detail.classList.contains("hidden")).toBe(false);
    expect(detail.querySelector("[data-lq-overview-body]").textContent).toContain("王小明");
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
  });

  it("switches to the 歷史趨勢 tab and exports the trend CSV even if Chart.js cannot load", async () => {
    await renderAdminLightningQuizStats();
    document.querySelector('[data-lq-stats-tab="trend"]').click();
    await flush();

    const trend = document.querySelector('[data-lq-stats-panel="trend"]');
    expect(trend.classList.contains("hidden")).toBe(false);
    expect(document.querySelector('[data-lq-stats-panel="daily"]').classList.contains("hidden")).toBe(true);
    expect(trend.querySelector("[data-lq-trend-from]").value).toBe("2026-09-24");
    expect(trend.textContent).toContain("20.0%");
    expect(trend.textContent).toContain("50.0%");

    trend.querySelector("[data-lq-trend-export]").click();
    expect(downloads[0].filename).toMatch(/^快問快答_歷史趨勢_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await downloads[0].blob.text()).toContain('"2026-09-24","2","10","20.0%","1","50.0%","5.0"');
  });
});
