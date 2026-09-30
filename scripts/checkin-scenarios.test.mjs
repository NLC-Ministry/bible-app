// #350 情境測試表（依 #357 的「完成本章」模型）：真實會友狀態 → 會不會寫入 outbox。
//
// 組裝方式跟正式 app 一樣，只把外部換成假的：
//   真的 db.logChapterRead（js/db.js）→ 真的 CheckInOutbox（記憶體、不送網路）
//   真的「完成本章」控制器（chapter-complete-button.mjs）＋共用判斷（chapter-complete.mjs）
// 目標計畫的解析照讀經頁的規則：從計畫進來 → 那個計畫；自由閱讀 → 目前這一遍含這章的計畫，由會友選。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { CheckInOutbox } from "../js/pwa/CheckInOutbox.js";
import {
  findChapterInPlan,
  findFreeReadingPlanChoices,
  getChapterTaskBlock,
  resolveChapterCompleteTarget,
  submitChapterCheckIn
} from "../js/data/chapter-complete.mjs";
import { formatRoundIncompleteMessage, getRoundCheckState } from "../js/data/current-round-progress.mjs";
import { isPlanProgressLocked } from "../js/data/plan-progress-availability.mjs";
import { createChapterCompleteController } from "../js/modules/chapter-complete-button.mjs";

const U1 = "user-1";
const BOOK = "出埃及記";

const ch = (n, round = 1, read = false) => ({ book: BOOK, chapter: n, round, [`isReadR${round}`]: read, isRead: round === 1 && read });
// 5 天、每天一章；readSet＝這一遍已完成的章
function makePlan(id, { round = 1, read = [], extra = {} } = {}) {
  const readSet = new Set(read);
  return {
    id,
    name: `速讀 ${id}`,
    planKind: "church_campaign_stage",
    currentRound: round,
    startDate: "2026-01-01",
    days: [1, 2, 3, 4, 5].map(n => ({ dayNum: n, chapters: [ch(n, round, readSet.has(n))] })),
    ...extra
  };
}

let dom;
let db;
let fakeState;
let outbox;
let sendSpy;
let online;

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
  for (const key of ["window", "document", "localStorage", "sessionStorage", "navigator", "location"]) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
  fakeState = {
    isSupabaseMode: true,
    offlineMode: false,
    supabase: { rpc: vi.fn(async () => ({ data: { ok: true, reason: null }, error: null })), from: vi.fn() },
    supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
    currentProfileId: U1,
    currentUser: { id: U1 },
    readingLogs: [],
    activePlan: null,
    activePlans: []
  };
  vi.stubGlobal("state", fakeState);
  await import("../js/db.js?checkin-scenarios");
  db = dom.window.db || globalThis.db;
  db.getCurrentDbUser = async () => ({ id: U1 });
  db.calculateStreak = () => {};
  db.saveLocalUserStats = () => {};

  online = false; // 預設不送出：打卡留在 outbox，方便檢查「有沒有寫入」
  sendSpy = vi.fn(async () => ({ ok: true, reason: null }));
  outbox = new CheckInOutbox({ send: sendSpy, getUserId: () => U1, isOnline: () => online });
  await outbox.load();
  dom.window.checkInOutbox = outbox;
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

// 讀經頁的一個畫面：這一章、從哪裡進來、會友選了哪個計畫
function openReader({ book = BOOK, chapter, fromPlan = null }) {
  let selectedPlanId = "";
  const getTarget = () => {
    const found = fromPlan ? findChapterInPlan(fromPlan, book, chapter, { round: fromPlan.currentRound }) : null;
    const contextTask = found ? { plan: fromPlan, ...found, bookName: book, chapterNum: chapter } : null;
    const choices = contextTask ? [] : findFreeReadingPlanChoices({
      plans: fakeState.activePlans,
      bookName: book,
      chapterNum: chapter,
      isUsable: plan => !isPlanProgressLocked(plan)
    });
    return resolveChapterCompleteTarget({ contextTask, choices, selectedPlanId });
  };
  const control = createChapterCompleteController({
    getTarget,
    getBlock: (task, willCheck) => getChapterTaskBlock(task, willCheck, {
      offlineMode: fakeState.offlineMode,
      isLocked: plan => isPlanProgressLocked(plan),
      db
    }),
    submit: (task, willCheck) => submitChapterCheckIn(task, willCheck, { db, state: fakeState }),
    onChoose: planId => { selectedPlanId = planId; },
    win: dom.window
  });
  dom.window.document.body.innerHTML = "";
  dom.window.document.body.appendChild(control.createElement("reader-chapter-complete"));
  control.render();
  const root = control.element;
  return {
    control,
    root,
    button: () => root.querySelector(".chapter-complete__button"),
    status: () => root.querySelector(".chapter-complete__status").textContent,
    choose: planId => root.querySelector(`.chapter-complete__choice[data-plan-id="${planId}"]`).click()
  };
}

const pending = () => outbox.pendingItems().map(({ planId, book, chapter, round, checked }) => ({ planId, book, chapter, round, checked }));

describe("check-in scenarios (#350 × #357)", () => {
  it("on schedule: press on today's chapter → enqueued, button shows 已記錄 + 等待同步", async () => {
    const plan = makePlan("p1", { read: [1, 2] });
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 3, fromPlan: plan });
    expect(reader.button().textContent).toContain("完成本章");
    expect(pending()).toEqual([]);

    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 3, round: 1, checked: true }]);
    expect(reader.button().getAttribute("aria-pressed")).toBe("true");
    expect(reader.button().textContent).toContain("已記錄到〈速讀 p1〉");
    expect(reader.status()).toBe("已完成（等待同步）");
  });

  it("behind schedule: pressing today's chapter is not blocked by earlier unread chapters", async () => {
    const plan = makePlan("p1", { read: [] });
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 5, fromPlan: plan });
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 5, round: 1, checked: true }]);
  });

  it("a gap before the chapter: press → enqueued (no ordering rule)", async () => {
    const plan = makePlan("p1", { read: [1, 3] });
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 4, fromPlan: plan });
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 4, round: 1, checked: true }]);
  });

  it("round 2+: enqueued with the current round", async () => {
    const plan = makePlan("p1", { round: 2, read: [1] });
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 2, fromPlan: plan });
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 2, round: 2, checked: true }]);
  });

  it("free reading, one plan has the chapter: nothing until pressed, then that plan", async () => {
    const plan = makePlan("p1");
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 2 });
    expect(reader.button().textContent).toContain("完成本章 · 記到〈速讀 p1〉");
    reader.control.pulse(); // 讀到章末
    expect(pending()).toEqual([]);
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 2, round: 1, checked: true }]);
  });

  it("free reading, two plans have the chapter: nothing is written until the member picks", async () => {
    const a = makePlan("a");
    const b = makePlan("b");
    fakeState.activePlans = [a, b];
    const reader = openReader({ chapter: 2 });
    expect(reader.root.querySelectorAll(".chapter-complete__choice")).toHaveLength(2);
    expect(reader.root.querySelector('.chapter-complete__choice[aria-checked="true"]')).toBeNull();

    const result = await reader.control.press();
    expect(result.reason).toBe("choose_plan");
    expect(pending()).toEqual([]);
    expect(reader.status()).toBe("請先選要記到哪個計畫");

    reader.choose("b");
    expect(pending()).toEqual([]); // 選計畫本身不寫入
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "b", book: BOOK, chapter: 2, round: 1, checked: true }]);
    expect(b.days[1].chapters[0].isReadR1).toBe(true);
    expect(a.days[1].chapters[0].isReadR1).toBe(false);
  });

  it("free reading of a chapter no plan contains: no button at all", () => {
    fakeState.activePlans = [makePlan("p1")];
    const reader = openReader({ chapter: 30 });
    expect(reader.root.hidden).toBe(true);
  });

  it("reaching the end without pressing → not written (the button only pulses)", () => {
    const plan = makePlan("p1");
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    expect(reader.control.pulse()).toBe(true);
    expect(reader.button().classList.contains("is-pulsing")).toBe(true);
    expect(pending()).toEqual([]);
    expect(fakeState.readingLogs).toEqual([]);
  });

  it("TTS finishing the chapter → not written (same pulse, nothing else)", () => {
    const plan = makePlan("p1");
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    reader.control.pulse(); // continueReaderAudioToNextChapter 只呼叫 pulse()
    reader.control.pulse();
    expect(pending()).toEqual([]);
  });

  it("offline reading mode: press → enqueued (sent later)", async () => {
    fakeState.offlineMode = true;
    const plan = makePlan("p1");
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 1, round: 1, checked: true }]);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("locked stage: blocked with the reason, nothing enqueued", async () => {
    const plan = makePlan("p1", { extra: { isHidden: true } }); // 尚未發布的階段
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    const result = await reader.control.press();
    expect(result.reason).toBe("locked");
    expect(reader.status()).toBe("未記錄：這個階段尚未開放");
    expect(pending()).toEqual([]);
    // 自由閱讀時鎖住的階段不列為可選
    expect(openReader({ chapter: 1 }).root.hidden).toBe(true);
  });

  it("press again = undo (enqueues the uncheck intent)", async () => {
    const plan = makePlan("p1", { read: [1] });
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    expect(reader.button().getAttribute("aria-pressed")).toBe("true");
    await reader.control.press();
    expect(pending()).toEqual([{ planId: "p1", book: BOOK, chapter: 1, round: 1, checked: false }]);
    expect(reader.button().getAttribute("aria-pressed")).toBe("false");
  });

  it("server rejection shows the reason under the button", async () => {
    online = true;
    sendSpy.mockResolvedValue({ ok: false, reason: "plan_closed" });
    const plan = makePlan("p1");
    fakeState.activePlans = [plan];
    const reader = openReader({ chapter: 1, fromPlan: plan });
    await reader.control.press();
    await outbox.flush({ force: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendSpy).toHaveBeenCalled();
    expect(reader.status()).toBe("未記錄：計畫已截止，無法再修改打卡");
  });

  it("round advance with an unfinished chapter → blocked and lists what is missing", () => {
    const plan = makePlan("p1", { read: [1, 2, 4, 5] });
    const message = formatRoundIncompleteMessage(getRoundCheckState(plan.days, plan.currentRound));
    expect(message).toBe(`還有 1 章沒完成：${BOOK} 3章`);
    const done = makePlan("p1", { read: [1, 2, 3, 4, 5] });
    expect(formatRoundIncompleteMessage(getRoundCheckState(done.days, done.currentRound))).toBeNull();
  });
});
