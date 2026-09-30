// @vitest-environment jsdom
// #357 實際載入 bible.js：章末「完成本章」按鈕。讀到底／換章不寫入；按下才寫入；自由閱讀多計畫要先選。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const BOOK = "出埃及記";
let bible;
let ioCallback = null;
const mk = (n, read = false) => ({ book: BOOK, chapter: n, round: 1, isReadR1: read, isRead: read });
const makePlan = (id, name) => ({ id, name, planKind: "church_campaign_stage", currentRound: 1, days: [{ dayNum: 1, chapters: [mk(1), mk(2), mk(3)] }] });

beforeAll(async () => {
  globalThis.BIBLE_BOOKS = [{ id: 1, name: "創世記", eng: "Genesis", chapters: 50, abbrev: "創" }, { id: 2, name: BOOK, eng: "Exodus", chapters: 40, abbrev: "出" }];
  globalThis.state = { readerState: { bookId: 2, chapter: 3, fromPlan: false, version: "CUNP", planContextId: null }, activePlans: [], activePlan: null, offlineMode: false, readingLogs: [], highlights: {}, verseNotes: {} };
  window.state = state;
  globalThis.isPlanExpired = () => false;
  globalThis.calculatePlanProgress = () => {};
  globalThis.showToast = vi.fn();
  globalThis.renderIcon = key => `<i data-test-icon="${key}"></i>`;
  globalThis.db = { logChapterRead: vi.fn(async () => ({ queued: true })), getVerseNotesForChapter: async () => ({}) };
  globalThis.saveReaderPreferences = () => {};
  globalThis.ComponentSkeletonLoader = { show() {} };
  globalThis.fetchBibleChapter = async () => ({ verses: [{ verse: 1, text: "太初" }] });
  globalThis.IntersectionObserver = class { constructor(cb) { ioCallback = cb; } observe(el) { this.el = el; } disconnect() {} };
  await import("../js/copy/zh-Hant.js");
  document.body.innerHTML = '<div id="reader-view"><div class="reader-reading-surface"><h2 id="bible-title"></h2><div id="bible-content"></div></div></div>';
  bible = await import("../js/modules/bible.js");
});

beforeEach(() => {
  db.logChapterRead.mockClear();
});

const control = () => document.getElementById("reader-chapter-complete");
const button = () => control().querySelector(".chapter-complete__button");

describe("reader chapter-complete button (runtime, #357)", () => {
  it("from a plan: reaching the end only pulses, navigating away writes nothing", async () => {
    const plan = makePlan("p1", "計畫一");
    state.activePlans = [plan];
    state.activePlan = plan;
    window.findPlanByContextId = () => plan;
    Object.assign(state.readerState, { chapter: 2, fromPlan: true, planContextId: "p1", planRound: 1 });
    await bible.renderReaderText();
    expect(control().hidden).toBe(false);
    expect(button().textContent).toContain("完成本章");

    ioCallback([{ target: document.getElementById("reader-end-sentinel"), isIntersecting: true }]);
    expect(button().classList.contains("is-pulsing")).toBe(true);
    await bible.navigateToChapter(1);
    await flush();
    expect(db.logChapterRead).not.toHaveBeenCalled();
    expect(state.readerState.chapter).toBe(3);
    expect(plan.days[0].chapters[1].isReadR1).toBe(false);
  });

  it("pressing records to the plan the reader came from, with haptics, and shows 已記錄", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    button().click();
    await flush();
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 3, true, 1, state.activePlan);
    expect(state.activePlan.days[0].chapters[2].isReadR1).toBe(true);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().textContent).toContain("已記錄到〈計畫一〉");
  });

  it("free reading with two matching plans: nothing until the member picks one", async () => {
    const a = makePlan("a", "計畫甲");
    const b = makePlan("b", "計畫乙");
    state.activePlans = [a, b];
    state.activePlan = a;
    Object.assign(state.readerState, { chapter: 1, fromPlan: false, planContextId: null });
    await bible.renderReaderText();
    const choices = control().querySelectorAll(".chapter-complete__choice");
    expect([...choices].map(choice => choice.textContent)).toEqual(["計畫甲", "計畫乙"]);
    button().click();
    await flush();
    expect(db.logChapterRead).not.toHaveBeenCalled();

    control().querySelector('.chapter-complete__choice[data-plan-id="b"]').click();
    button().click();
    await flush();
    expect(db.logChapterRead).toHaveBeenCalledWith(BOOK, 1, true, 1, b);
    expect(a.days[0].chapters[0].isReadR1).toBe(false);
  });

  it("a chapter outside every plan shows no button", async () => {
    Object.assign(state.readerState, { chapter: 9, fromPlan: false });
    await bible.renderReaderText();
    expect(control().hidden).toBe(true);
  });
});
