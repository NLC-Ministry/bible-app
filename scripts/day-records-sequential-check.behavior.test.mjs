// @vitest-environment jsdom
// #330 當天閱讀紀錄 + #331 照順序打卡：實際載入 plan.js，渲染當天清單、點勾選框。
process.env.TZ = "Asia/Taipei";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const BOOK = "出埃及記";

function chapter(n, round, read) {
  return { book: BOOK, chapter: n, round, key: `${BOOK}_${n}_${round}`, [`isReadR${round}`]: read, isRead: read };
}

// 第 2 遍進行中：第 1 遍 5 章都在 9/1 讀完；9/2 沒讀；第 2 遍從 9/3 開始。
function buildPlan({ planKind = "church_campaign_stage", round2Read = [1] } = {}) {
  const r2 = n => chapter(n, 2, round2Read.includes(n));
  const day = (dayNum, d, chapters) => ({ dayNum, year: 2026, month: 9, date: `9/${d}`, isoDate: `2026-09-0${d}`, chapters });
  return {
    id: "plan-1",
    name: "第一輪期末賽｜2026年9月・出埃及記",
    planKind,
    currentRound: 2,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    days: [
      day(1, 1, [1, 2, 3, 4, 5].map(n => chapter(n, 1, true))),
      day(2, 2, []),
      day(3, 3, [r2(1), r2(2)]),
      day(4, 4, [r2(3), r2(4)]),
      day(5, 5, [r2(5)])
    ]
  };
}

function buildLogs(round2Read = [1]) {
  return [
    ...[1, 2, 3, 4, 5].map(n => ({ book: BOOK, chapter: n, round: 1, plan_id: "plan-1", read_at: "2026-09-01T02:00:00Z" })),
    // 台灣 9/3 07:30（UTC 還是 9/2）
    ...round2Read.map(n => ({ book: BOOK, chapter: n, round: 2, plan_id: "plan-1", read_at: "2026-09-02T23:30:00Z" })),
    // 別的計畫、同一天：不列入
    { book: BOOK, chapter: 9, round: 1, plan_id: "other-plan", read_at: "2026-09-01T03:00:00Z" }
  ];
}

let db;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T04:00:00Z"));
  globalThis.state = { readerState: {}, activePlans: [], readingLogs: [] };
  globalThis.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  globalThis.showToast = vi.fn();
  globalThis.renderIcon = key => `<i data-test-icon="${key}"></i>`;
  globalThis.hydrateIcons = () => {};
  globalThis.getUserRoleCode = () => "member";
  globalThis.isPlanStarted = () => true;
  globalThis.isPlanExpired = () => false;
  globalThis.calculatePlanProgress = vi.fn();
  globalThis.saveReaderPreferences = vi.fn();
  globalThis.BIBLE_BOOKS = [{ id: 2, name: BOOK, eng: "Exodus", chapters: 40 }];
  globalThis.appRouter = { switchTab: vi.fn() };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.setDataVersion = vi.fn();
  db = {
    logChapterRead: vi.fn().mockResolvedValue({}),
    saveLocalUserStats: vi.fn(),
    getFeatureSetting: vi.fn().mockResolvedValue({ enabled: false })
  };
  globalThis.db = db;
  await import("../js/copy/zh-Hant.js");
  await import("../js/modules/plan.js");
});

afterAll(() => {
  vi.useRealTimers();
});

function setup(options = {}) {
  const round2Read = options.round2Read || [1];
  state.activePlan = buildPlan({ ...options, round2Read });
  state.readingLogs = buildLogs(round2Read);
  state.offlineMode = false;
  document.body.innerHTML = `
    <div id="plan-date-carousel"></div>
    <span id="plan-day-status-pill"></span>
    <div id="plan-tasks-list"></div>`;
  vi.clearAllMocks();
}

async function showDay(dayNum) {
  state.selectedPlanDay = dayNum;
  await window.renderPlanScheduleTracker(true);
  await flush();
  return {
    pill: document.getElementById("plan-day-status-pill").textContent.trim(),
    list: document.getElementById("plan-tasks-list")
  };
}

const taskRow = (list, n) => [...list.querySelectorAll(".plan-task-item")]
  .find(row => row.querySelector(".task-title").textContent.includes(`${BOOK} ${n}章`));

describe("day reading records (#330)", () => {
  beforeEach(() => setup());

  it("shows what was actually read on a day before the current round, instead of a rest day", async () => {
    const { pill, list } = await showDay(1);
    expect(pill).toBe("已讀 5 章");
    expect(list.textContent).not.toContain("休息日");
    expect(list.querySelectorAll(".plan-task-item")).toHaveLength(0);
    const records = list.querySelector(".plan-day-records");
    expect(records.textContent).toContain("當天閱讀紀錄");
    expect(records.textContent).toContain("第1遍");
    expect([...records.querySelectorAll(".plan-day-records__range")].map(b => b.textContent)).toEqual([`${BOOK} 1–5章`]);
  });

  it("shows 無紀錄 for a day before the current round with nothing read", async () => {
    const { pill, list } = await showDay(2);
    expect(pill).toBe("無紀錄");
    expect(list.textContent).toContain("這天沒有閱讀紀錄");
  });

  it("does not repeat a chapter that is already in the day's task list", async () => {
    const { list } = await showDay(3);
    // 第 2 遍第 1 章在台灣時間 9/3 打卡，已經是當天任務 → 不另列紀錄
    expect(list.querySelector(".plan-day-records")).toBeNull();
  });

  it("opens a record in the plain reader (no plan context, so no auto check-off)", async () => {
    const { list } = await showDay(1);
    state.readerState.fromPlan = true;
    state.readerState.planRound = 1;
    list.querySelector(".plan-day-records__range").click();
    expect(state.readerState.fromPlan).toBe(false);
    expect(state.readerState.planRound).toBeNull();
    expect(state.readerState.returnTab).toBe("plan-view");
    expect(state.readerState.chapter).toBe(1);
    expect(appRouter.switchTab).toHaveBeenCalledWith("reader-view");
  });

  it("colors calendar cells with the same rule as the day list", async () => {
    window.renderHorizontalDateStrip();
    const cell = n => document.querySelector(`.plan-day-cell[data-day-num="${n}"]`);
    expect(cell(1).classList.contains("completed")).toBe(true);   // 有紀錄
    expect(cell(2).classList.contains("completed")).toBe(false);  // 沒紀錄、沒任務
    expect(cell(2).classList.contains("past-unread")).toBe(false);
    expect(cell(4).classList.contains("past-unread")).toBe(true); // 本遍任務沒讀
  });
});

describe("sequential check-off (#331)", () => {
  it("marks the next chapter and locks later ones", async () => {
    setup();
    let { list } = await showDay(3);
    expect(taskRow(list, 2).classList.contains("plan-task-item--next")).toBe(true);
    expect(taskRow(list, 2).textContent).toContain("下一章");
    ({ list } = await showDay(4));
    const locked = taskRow(list, 3);
    expect(locked.classList.contains("plan-task-item--locked")).toBe(true);
    expect(locked.querySelector(".task-read-toggle").getAttribute("aria-disabled")).toBe("true");
    expect(locked.querySelector('[data-test-icon="lock"]')).not.toBeNull();
  });

  it("refuses to check a chapter out of order and says which one comes first", async () => {
    setup();
    const { list } = await showDay(4);
    taskRow(list, 3).querySelector(".task-read-toggle").click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(`請照順序打卡，先讀完 ${BOOK} 2章`);
    expect(db.logChapterRead).not.toHaveBeenCalled();
  });

  it("checks the next chapter", async () => {
    setup();
    const { list } = await showDay(3);
    taskRow(list, 2).querySelector(".task-read-toggle").click();
    await flush();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 2, true, 2);
  });

  it("only lets the last checked chapter be unchecked", async () => {
    setup({ round2Read: [1, 2] });
    const { list } = await showDay(3);
    taskRow(list, 1).querySelector(".task-read-toggle").click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(`只能取消最後勾的那一章（${BOOK} 2章）`);
    expect(db.logChapterRead).not.toHaveBeenCalled();

    taskRow(list, 2).querySelector(".task-read-toggle").click();
    await flush();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 2, false, 2);
  });

  it("advancing with a legacy gap points to the first unread chapter instead of a missed-chapter list", async () => {
    setup({ round2Read: [1, 3, 4, 5] }); // 舊版 app 跳著勾留下的缺口
    const { list } = await showDay(5);
    const advance = list.querySelector("#btn-plan-round-advance");
    expect(advance).not.toBeNull();
    expect(list.textContent).not.toContain("漏勾");
    advance.click();
    expect(showToast).toHaveBeenCalledWith(`還有 1 章沒讀，請從 ${BOOK} 2章 開始`);
    expect(document.getElementById("missed-chapters-modal")).toBeNull();
  });

  it("does not restrict plans outside the speed-reading series", async () => {
    setup({ planKind: null }); // 自訂計畫：沒有 plan_kind
    const { list } = await showDay(4);
    expect(list.querySelector(".plan-task-item--locked")).toBeNull();
    expect(list.querySelector(".plan-task-item--next")).toBeNull();
    taskRow(list, 3).querySelector(".task-read-toggle").click();
    await flush();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 3, true, 2);
  });
});
