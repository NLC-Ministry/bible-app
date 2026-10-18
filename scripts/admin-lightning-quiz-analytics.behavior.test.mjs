import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

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

// #429 首頁公布前三名：9/21 有 5 人答對、9/23 有 1 人
const rankingData = {
  weekStart: "2026-09-21",
  weekEnd: "2026-09-27",
  allEnded: true,
  days: [
    { questionId: "q1", riseDate: "2026-09-21", ended: true, candidates: [
      { userId: "u1", name: "甲", pastoralZone: "中永和", elapsedMs: 5000 },
      { userId: "u2", name: "乙", pastoralZone: "文山", elapsedMs: 6000 },
      { userId: "u3", name: "丙", pastoralZone: "", elapsedMs: 7000 },
      { userId: "u4", name: "丁", pastoralZone: "新莊2", elapsedMs: 8000 },
      { userId: "u5", name: "戊", pastoralZone: "中山1", elapsedMs: 9000 }
    ] },
    { questionId: "q2", riseDate: "2026-09-23", ended: true, candidates: [
      { userId: "u1", name: "甲", pastoralZone: "中永和", elapsedMs: 4000 }
    ] }
  ],
  publication: null
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 用 index.html 裡真正的雲柱測驗區塊（作答明細是它裡面的完整頁面，#317）
const indexHtml = readLegacyIndexHtml();
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
    adminGetLightningQuizWeeks: vi.fn(async () => ({ success: true, data: { weeks } })),
    adminGetLightningQuizWeekRanking: vi.fn(async () => ({ success: true, data: rankingData })),
    adminPublishLightningQuizWeekRanking: vi.fn(async () => ({ success: true, data: { displayUntil: "2026-09-29" } })),
    adminRevokeLightningQuizWeekRanking: vi.fn(async () => ({ success: true, data: { revoked: true } })),
    adminListLightningQuizVouchers: vi.fn(async () => ({ success: true, data: { vouchers: [] } })),
    adminSetLightningQuizVoucherRedeemed: vi.fn(async () => ({ success: true, data: {} }))
  });
  dom.window.showConfirmDialog = vi.fn(async () => true);
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

describe("雲柱測驗 作答明細", () => {
  it("opens overview, zone and region tables for a question and exports each as CSV", async () => {
    await renderAdminLightningQuizStats();
    document.querySelector('[data-lq-stats-tab="daily"]').click();
    document.querySelector('[data-lightning-quiz-detail="q1"]').click();
    await flush();

    expect(db.adminGetLightningQuizResults).toHaveBeenCalledWith("q1");
    // 作答明細是完整頁面：雲柱測驗主畫面先隱藏
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
      "雲柱測驗_作答總覽_2026-09-24.csv",
      "雲柱測驗_牧區分析_2026-09-24.csv",
      "雲柱測驗_大區分析_2026-09-24.csv"
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
      "雲柱測驗_週名單_2026-09-21週.csv",
      "雲柱測驗_週大區分析_2026-09-21週.csv",
      "雲柱測驗_週牧區分析_2026-09-21週.csv"
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
    expect(downloads[0].filename).toMatch(/^雲柱測驗_週趨勢_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await downloads[0].blob.text()).toContain('"2026-09-21","2","2","10","20.0%","1","2","3","66.7%","5.0"');
  });
});

describe("雲柱測驗 首頁公布前三名（#429）", () => {
  const winnersOf = (section, index) => [...section.querySelectorAll(".admin-lq-ranking__day")[index].querySelectorAll(".admin-lq-ranking__row")]
    .map(row => `${row.querySelector(".admin-lq-ranking__rank").textContent}|${row.querySelector(".admin-lq-ranking__name").textContent}`);

  it("lists each day's correct answers fastest first; excluding someone moves the next one up on that day only", async () => {
    await renderAdminLightningQuizStats();
    await flush();
    const section = document.querySelector("[data-lq-week-ranking]");
    expect(db.adminGetLightningQuizWeekRanking).toHaveBeenCalledWith("2026-09-21");
    expect(section.textContent).toContain("尚未公布。");
    expect(winnersOf(section, 0)).toEqual(["第一名|甲", "第二名|乙", "第三名|丙", "|丁", "|戊"]);

    section.querySelector('[data-lq-ranking-toggle][data-date="2026-09-21"][data-user="u1"]').click();
    expect(winnersOf(section, 0)).toEqual(["已排除|甲", "第一名|乙", "第二名|丙", "第三名|丁", "|戊"]);
    // 以天為單位：9/23 的甲不受影響
    expect(winnersOf(section, 1)).toEqual(["第一名|甲"]);

    // 取消排除就回到原本的名次
    section.querySelector('[data-lq-ranking-toggle][data-date="2026-09-21"][data-user="u1"]').click();
    expect(winnersOf(section, 0)[0]).toBe("第一名|甲");
  });

  it("publishes the exclusions per day with the chosen number of days (default 1, limited to 1–7)", async () => {
    await renderAdminLightningQuizStats();
    await flush();
    const section = document.querySelector("[data-lq-week-ranking]");
    expect(section.querySelector("[data-lq-ranking-days]").value).toBe("1");

    section.querySelector('[data-lq-ranking-toggle][data-date="2026-09-21"][data-user="u2"]').click();
    section.querySelector("[data-lq-ranking-days]").value = "8";
    section.querySelector("[data-lq-ranking-publish]").click();
    await flush();
    expect(db.adminPublishLightningQuizWeekRanking).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("公布天數只能是 1～7 天。");

    section.querySelector("[data-lq-ranking-days]").value = "3";
    section.querySelector("[data-lq-ranking-publish]").click();
    await flush();
    await flush();
    expect(window.showConfirmDialog).toHaveBeenCalled();
    expect(db.adminPublishLightningQuizWeekRanking).toHaveBeenCalledWith(
      "2026-09-21",
      { "2026-09-21": ["u2"], "2026-09-23": [] },
      3
    );
  });

  it("can't publish while a question this week hasn't ended", async () => {
    db.adminGetLightningQuizWeekRanking.mockResolvedValueOnce({ success: true, data: { ...rankingData, allEnded: false } });
    await renderAdminLightningQuizStats();
    await flush();
    const section = document.querySelector("[data-lq-week-ranking]");
    expect(section.querySelector("[data-lq-ranking-publish]").disabled).toBe(true);
    expect(section.textContent).toContain("這週還有題目沒結束，全部結束後才能公布。");
  });

  it("re-publishing starts from the saved exclusions and can be revoked", async () => {
    db.adminGetLightningQuizWeekRanking.mockResolvedValueOnce({ success: true, data: {
      ...rankingData,
      publication: { excluded: { "2026-09-21": ["u1"] }, displayDays: 2, displayUntil: "2026-09-29", revoked: false, showing: true }
    } });
    await renderAdminLightningQuizStats();
    await flush();
    const section = document.querySelector("[data-lq-week-ranking]");
    expect(section.textContent).toContain("首頁公布中，顯示到 9/29（二） 23:59。");
    expect(winnersOf(section, 0)[0]).toBe("已排除|甲");
    expect(section.querySelector("[data-lq-ranking-days]").value).toBe("2");
    expect(section.querySelector("[data-lq-ranking-publish]").textContent).toBe("重新公布");

    section.querySelector("[data-lq-ranking-revoke]").click();
    await flush();
    await flush();
    expect(db.adminRevokeLightningQuizWeekRanking).toHaveBeenCalledWith("2026-09-21");
  });
});

describe("雲柱測驗 英雄榜兌換券（#445）", () => {
  const vouchers = [
    { id: "v1", code: "ERAJP5", amount: 100, riseDate: "2026-09-21", rank: 1, name: "甲", pastoralZone: "中永和", expiresOn: "2026-10-30", status: "available" },
    { id: "v2", code: "K7M2QX", amount: 100, riseDate: "2026-09-21", rank: 2, name: "乙", pastoralZone: "文山", expiresOn: "2026-10-30", status: "redeemed", redeemedAt: "2026-10-05T06:30:00Z", redeemedVia: "self" },
    { id: "v3", code: "ZZZ222", amount: 100, riseDate: "2026-09-21", rank: 3, name: "丙", pastoralZone: "", expiresOn: "2026-10-30", status: "void" }
  ];

  it("lists this week's vouchers with counts; admin can mark or undo a redemption", async () => {
    db.adminListLightningQuizVouchers.mockResolvedValue({ success: true, data: { vouchers } });
    await renderAdminLightningQuizStats();
    await flush();
    const section = document.querySelector("[data-lq-week-vouchers]");
    expect(db.adminListLightningQuizVouchers).toHaveBeenCalledWith("2026-09-21");
    expect(section.querySelector(".admin-lq-vouchers__summary").textContent.replace(/\s+/g, " ").trim())
      .toBe("發出 2 張 已兌換 1 可使用 1 已過期 0 已作廢 1");
    const rows = [...section.querySelectorAll(".admin-lq-vouchers__row")];
    expect(rows[1].querySelector(".admin-lq-vouchers__note").textContent).toBe("10/5 14:30 兌換・本人確認");
    // 作廢的券不能操作
    expect(rows[2].querySelector("button")).toBeNull();

    section.querySelector('[data-lq-voucher-redeem="v1"]').click();
    await flush();
    await flush();
    expect(db.adminSetLightningQuizVoucherRedeemed).toHaveBeenCalledWith("v1", true);

    section.querySelector('[data-lq-voucher-undo="v2"]').click();
    await flush();
    await flush();
    expect(db.adminSetLightningQuizVoucherRedeemed).toHaveBeenCalledWith("v2", false);
  });

  it("exports the week's vouchers as CSV", async () => {
    db.adminListLightningQuizVouchers.mockResolvedValue({ success: true, data: { vouchers } });
    await renderAdminLightningQuizStats();
    await flush();
    document.querySelector("[data-lq-vouchers-export]").click();
    const download = downloads[downloads.length - 1];
    expect(download.filename).toBe("雲柱測驗_英雄榜兌換券_2026-09-21.csv");
    expect(await download.blob.text()).toContain('"2026-09-21","第一名","甲","中永和","ERAJP5","100","可使用"');
  });

  it("reloads the voucher list after publishing", async () => {
    await renderAdminLightningQuizStats();
    await flush();
    expect(db.adminListLightningQuizVouchers).toHaveBeenCalledTimes(1);
    document.querySelector("[data-lq-week-ranking] [data-lq-ranking-publish]").click();
    await flush();
    await flush();
    expect(db.adminPublishLightningQuizWeekRanking).toHaveBeenCalled();
    expect(db.adminListLightningQuizVouchers).toHaveBeenCalledTimes(2);
    expect(window.showConfirmDialog.mock.calls[0][0].message).toContain("克勞斯 100 元抵用券");
  });
});
