// @vitest-environment jsdom
// #330 當天閱讀紀錄 + #363 打卡不限順序：實際載入 plan.js，渲染當天清單、點勾選框。
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

describe("check-off in any order (#363)", () => {
  it("suggests the next chapter but locks nothing", async () => {
    setup();
    let { list } = await showDay(3);
    expect(taskRow(list, 2).classList.contains("plan-task-item--next")).toBe(true);
    expect(taskRow(list, 2).textContent).toContain("下一章");
    ({ list } = await showDay(4));
    const later = taskRow(list, 3);
    expect(list.querySelector(".plan-task-item--locked")).toBeNull();
    expect(later.querySelector(".task-read-toggle").hasAttribute("aria-disabled")).toBe(false);
    expect(later.querySelector('[data-test-icon="lock"]')).toBeNull();
  });

  it("checks a chapter out of order", async () => {
    setup();
    const { list } = await showDay(4);
    taskRow(list, 3).querySelector(".task-read-toggle").click();
    await flush();
    expect(showToast).not.toHaveBeenCalled();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 3, true, 2);
  });

  it("unchecks any checked chapter, not only the last one", async () => {
    setup({ round2Read: [1, 2] });
    const { list } = await showDay(3);
    taskRow(list, 1).querySelector(".task-read-toggle").click();
    await flush();
    expect(showToast).not.toHaveBeenCalled();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 1, false, 2);
  });

  it("shows the skipped chapters above the day's list and opens one with the plan context", async () => {
    setup({ round2Read: [1, 3, 4] });
    window.openPlanChapterInReader = vi.fn();
    const { list } = await showDay(4);
    const notice = list.querySelector(".plan-round-gap-notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("第 2 遍前面還有 1 章沒勾");
    const link = notice.querySelector(".plan-round-gap-notice__link");
    expect(link.textContent).toBe(`${BOOK} 2章`);
    link.click();
    expect(window.openPlanChapterInReader).toHaveBeenCalledWith(BOOK, 2, 3, 2);
  });

  it("does not show the notice when the member is simply reading in order", async () => {
    setup({ round2Read: [1, 2] });
    const { list } = await showDay(4);
    expect(list.querySelector(".plan-round-gap-notice")).toBeNull();
  });

  it("hides 進入下一遍 while a chapter is still unchecked, even when the last day is done (#374)", async () => {
    setup({ round2Read: [1, 3, 4, 5] });
    const { list } = await showDay(5);
    expect(list.querySelector("#btn-plan-round-advance")).toBeNull();
    // 缺哪一章由清單上方的提示告訴會友
    expect(list.querySelector(".plan-round-gap-notice").textContent).toContain(`${BOOK} 2章`);
    expect(document.getElementById("missed-chapters-modal")).toBeNull();
  });

  it("shows 進入下一遍 only once the whole round is checked, and it advances (#374)", async () => {
    setup({ round2Read: [1, 2, 3, 4, 5] });
    window.triggerPlanUpgradeFlow = vi.fn();
    let { list } = await showDay(4);
    expect(list.querySelector("#btn-plan-round-advance")).toBeNull(); // 不是最後一個閱讀日
    ({ list } = await showDay(5));
    const advance = list.querySelector("#btn-plan-round-advance");
    expect(advance).not.toBeNull();
    advance.click();
    expect(showToast).not.toHaveBeenCalled();
    expect(window.triggerPlanUpgradeFlow).toHaveBeenCalledTimes(1);
  });

  it("still blocks and lists the chapters if the data changes after the button appeared (#374)", async () => {
    setup({ round2Read: [1, 2, 3, 4, 5] });
    window.triggerPlanUpgradeFlow = vi.fn();
    const { list } = await showDay(5);
    const advance = list.querySelector("#btn-plan-round-advance");
    // 例如另一台裝置剛取消了第 2 章、同步進來
    state.activePlan.days[2].chapters[1].isReadR2 = false;
    advance.click();
    expect(showToast).toHaveBeenCalledWith(`這一遍還有 1 章沒勾：${BOOK} 2章`);
    expect(window.triggerPlanUpgradeFlow).not.toHaveBeenCalled();
  });

  it("does not suggest a next chapter or show the notice for plans outside the speed-reading series", async () => {
    setup({ planKind: null, round2Read: [1, 3] }); // 自訂計畫：沒有 plan_kind
    const { list } = await showDay(4);
    expect(list.querySelector(".plan-task-item--next")).toBeNull();
    expect(list.querySelector(".plan-round-gap-notice")).toBeNull();
    taskRow(list, 4).querySelector(".task-read-toggle").click();
    await flush();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 4, true, 2);
  });
});
