// #357「完成本章」：共用判斷（記到哪個計畫、會不會被擋、按鈕顯示什麼）＋ 自動寫入路徑都拿掉了。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAPTER_COMPLETE_REASONS,
  describeCheckInError,
  findChapterInPlan,
  findFreeReadingPlanChoices,
  formatChapterCompleteBlock,
  getChapterCheckInBlock,
  getChapterCompleteView,
  getChapterTaskBlock,
  getPendingCheckIn,
  isChapterTaskRead,
  resolveChapterCompleteTarget
} from "../js/data/chapter-complete.mjs";

const BOOK = "出埃及記";
const chapter = (n, round = 1, read = false) => ({
  book: BOOK, chapter: n, round, [`isReadR${round}`]: read, isRead: round === 1 && read
});
function plan(id, chapters, extra = {}) {
  return {
    id,
    name: `計畫 ${id}`,
    planKind: "church_campaign_stage",
    currentRound: 1,
    days: chapters.map((list, index) => ({ dayNum: index + 1, chapters: list })),
    ...extra
  };
}

describe("getChapterCheckInBlock", () => {
  it("allows a check when nothing blocks it", () => {
    expect(getChapterCheckInBlock({ hasTask: true })).toBeNull();
  });
  it("returns the reason, old round and expiry first", () => {
    expect(getChapterCheckInBlock({})).toBe(CHAPTER_COMPLETE_REASONS.NO_PLAN);
    expect(getChapterCheckInBlock({ hasTask: true, isOldRound: true, locked: true })).toBe("old_round");
    expect(getChapterCheckInBlock({ hasTask: true, expired: true })).toBe("expired");
    expect(getChapterCheckInBlock({ hasTask: true, locked: true })).toBe("locked");
    expect(getChapterCheckInBlock({ hasTask: true, offline: true })).toBe("offline");
  });
  it("a locked stage still lets the member take back a mistaken check", () => {
    expect(getChapterCheckInBlock({ hasTask: true, locked: true, willCheck: false })).toBeNull();
  });
  it("getChapterTaskBlock wires expiry, lock, old round and the offline queue", () => {
    const p = plan("a", [[chapter(1)]], { currentRound: 2 });
    const task = { plan: p, chapter: p.days[0].chapters[0], round: 1 };
    expect(getChapterTaskBlock(task, true)).toBe("old_round");
    const current = { ...task, round: 2 };
    expect(getChapterTaskBlock(current, true, { isLocked: () => true })).toBe("locked");
    const db = { canQueueCheckIn: () => true };
    expect(getChapterTaskBlock(current, true, { offlineMode: true, db })).toBeNull();
    expect(getChapterTaskBlock(current, true, { offlineMode: true, db: {} })).toBe("offline");
  });
});

describe("findFreeReadingPlanChoices / resolveChapterCompleteTarget", () => {
  it("finds the chapter only in the plan's current round", () => {
    const p = plan("a", [[chapter(1, 1, true)], [chapter(1, 2)]], { currentRound: 2 });
    const found = findChapterInPlan(p, BOOK, 1, { round: 2 });
    expect(found.day.dayNum).toBe(2);
    expect(findChapterInPlan(p, BOOK, 9, { round: 2 })).toBeNull();
  });

  it("lists every usable plan that has the chapter, in the original order, without picking", () => {
    const a = plan("a", [[chapter(3)]]);
    const b = plan("b", [[chapter(3)]]);
    const ended = plan("c", [[chapter(3)]]);
    const other = plan("d", [[chapter(9)]]);
    const choices = findFreeReadingPlanChoices({
      plans: [a, ended, other, b], bookName: BOOK, chapterNum: 3, isUsable: p => p.id !== "c"
    });
    expect(choices.map(choice => choice.plan.id)).toEqual(["a", "b"]);
    expect(choices[0]).toMatchObject({ bookName: BOOK, chapterNum: 3, round: 1 });
  });

  it("context > single > choose > none", () => {
    const a = { plan: plan("a", []), round: 1 };
    const b = { plan: plan("b", []), round: 1 };
    expect(resolveChapterCompleteTarget({ contextTask: a, choices: [b] })).toMatchObject({ mode: "context", task: a });
    expect(resolveChapterCompleteTarget({ choices: [] })).toMatchObject({ mode: "none", task: null });
    expect(resolveChapterCompleteTarget({ choices: [b] })).toMatchObject({ mode: "single", task: b });
    expect(resolveChapterCompleteTarget({ choices: [a, b] })).toMatchObject({ mode: "choose", task: null });
    expect(resolveChapterCompleteTarget({ choices: [a, b], selectedPlanId: "b" }).task).toBe(b);
    expect(resolveChapterCompleteTarget({ choices: [a, b], selectedPlanId: "gone" }).task).toBeNull();
  });
});

describe("getChapterCompleteView", () => {
  const p = plan("a", [[chapter(1)]]);
  const task = { plan: p, chapter: p.days[0].chapters[0], round: 1, bookName: BOOK, chapterNum: 1 };

  it("is hidden when no plan has the chapter", () => {
    expect(getChapterCompleteView({ target: resolveChapterCompleteTarget() }).visible).toBe(false);
  });
  it("names the plan on the button in free reading with one match", () => {
    const view = getChapterCompleteView({ target: resolveChapterCompleteTarget({ choices: [task] }) });
    expect(view).toMatchObject({ visible: true, pressed: false, label: "完成本章 · 記到〈計畫 a〉" });
  });
  it("pressed shows where it was recorded; pending shows 等待同步", () => {
    const target = resolveChapterCompleteTarget({ contextTask: task });
    expect(getChapterCompleteView({ target, read: true }).label).toBe("已記錄到〈計畫 a〉");
    expect(getChapterCompleteView({ target, read: true, pending: true })).toMatchObject({
      status: "已完成（等待同步）", statusKind: "pending"
    });
  });
  it("asks to choose when several plans match and none is selected", () => {
    const other = { ...task, plan: plan("b", []) };
    const view = getChapterCompleteView({ target: resolveChapterCompleteTarget({ choices: [task, other] }) });
    expect(view).toMatchObject({ needsChoice: true, label: "完成本章", status: "請先選要記到哪個計畫" });
    expect(view.choices.map(choice => [choice.id, choice.selected])).toEqual([["a", false], ["b", false]]);
  });
  it("a notice (blocked / rejected) wins over other status text", () => {
    const target = resolveChapterCompleteTarget({ contextTask: task });
    expect(getChapterCompleteView({ target, notice: { text: "未記錄：離線中" } })).toMatchObject({
      status: "未記錄：離線中", statusKind: "blocked"
    });
  });
});

describe("small helpers", () => {
  it("formats block reasons and hides technical errors", () => {
    expect(formatChapterCompleteBlock("locked")).toBe("未記錄：這個階段尚未開放");
    expect(formatChapterCompleteBlock("choose_plan")).toBe("請先選要記到哪個計畫");
    expect(describeCheckInError(Object.assign(new Error("計畫已截止"), { code: "CHECK_IN_REJECTED" }))).toBe("計畫已截止");
    expect(describeCheckInError(Object.assign(new Error("fetch failed"), { status: 500 }))).toBe("進度沒同步成功，等一下再試試");
  });
  it("reads the round flag and the outbox's latest intent for the chapter", () => {
    expect(isChapterTaskRead({ chapter: chapter(1, 2, true), round: 2 })).toBe(true);
    expect(isChapterTaskRead({ chapter: chapter(1, 2, false), round: 2 })).toBe(false);
    const outbox = {
      pendingItems: ({ planId }) => [
        { planId, book: BOOK, chapter: 1, round: 1, checked: true },
        { planId, book: BOOK, chapter: 2, round: 1, checked: false }
      ]
    };
    const p = plan("a", []);
    expect(getPendingCheckIn({ plan: p, round: 1, bookName: BOOK, chapterNum: 1 }, outbox, BOOK)).toBe(true);
    expect(getPendingCheckIn({ plan: p, round: 1, bookName: BOOK, chapterNum: 2 }, outbox, BOOK)).toBe(false);
    expect(getPendingCheckIn({ plan: p, round: 1, bookName: BOOK, chapterNum: 3 }, outbox, BOOK)).toBeNull();
    expect(getPendingCheckIn({ plan: p, round: 1 }, null)).toBeNull();
  });
});

describe("automatic write paths are gone (#357 decisions 1B / 2A / 3A / 5B)", () => {
  const bible = readFileSync(new URL("../js/modules/bible.js", import.meta.url), "utf8");
  const plansSrc = readFileSync(new URL("../js/modules/plan.js", import.meta.url), "utf8");
  const between = (source, start, end) => {
    const from = source.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const to = source.indexOf(end, from);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("no dwell, leaving-the-chapter or most-recently-opened plan logic remains", () => {
    for (const source of [bible, plansSrc]) {
      expect(source).not.toMatch(/recordLeavingReaderChapter|autoMarkCurrentPlanReaderTaskRead|autoMarkInlineReaderTaskRead/);
      expect(source).not.toMatch(/plan_last_opened_at|recordPlanOpened|readPlanLastOpened|selectAutoRecordPlanTask/);
      expect(source).not.toMatch(/getSequentialCheckBlock|formatSequentialCheckMessage/);
    }
  });
  it("navigation and TTS finishing never write a reading log", () => {
    const nav = between(bible, "export async function navigateToChapter", "let newChapter");
    expect(nav).not.toContain("logChapterRead");
    const tts = between(bible, "async function continueReaderAudioToNextChapter", "navigateToChapter(1");
    expect(tts).toContain("readerChapterComplete.pulse()");
    expect(tts).not.toContain("logChapterRead");
  });
  it("the only reader write is the button's submit", () => {
    const writes = bible.match(/logChapterRead\(/g) || [];
    expect(writes).toHaveLength(0); // bible.js 走 submitChapterCheckIn（js/data/chapter-complete.mjs）
    expect(bible).toContain("submitChapterCheckIn(task, willCheck");
  });
});
