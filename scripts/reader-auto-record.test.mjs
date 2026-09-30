// #349 讀到底自動打卡：共用判斷 + 計畫解析 + 「最近開啟」時間戳 + 兩處自動路徑不再吃 #331 順序檢查。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTO_RECORD_REASONS,
  PLAN_LAST_OPENED_STORAGE_KEY,
  findChapterInPlan,
  getAutoRecordDecision,
  readPlanLastOpened,
  recordPlanOpened,
  selectAutoRecordPlanTask
} from "../js/data/reader-auto-record.mjs";
import { getSequentialCheckBlock } from "../js/data/current-round-progress.mjs";

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
const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value))
  };
};

describe("getAutoRecordDecision", () => {
  const base = { hasTask: true, alreadyRead: false, offline: false, expired: false, locked: false, isOldRound: false };

  it("records when nothing blocks it", () => {
    expect(getAutoRecordDecision(base)).toEqual({ ok: true, reason: null });
  });
  it("has no sequential condition: a chapter far ahead of the next one still records", () => {
    // 前面 1-4 章沒讀、直接讀第 5 章：手動勾選會擋，自動打卡不擋。
    const p = plan("p", [[chapter(1), chapter(2), chapter(3), chapter(4)], [chapter(5)]]);
    expect(getSequentialCheckBlock(p, BOOK, 5, 1, true)).not.toBeNull();
    const found = findChapterInPlan(p, BOOK, 5, { round: 1 });
    expect(found).not.toBeNull();
    expect(getAutoRecordDecision({ ...base, hasTask: Boolean(found) }).ok).toBe(true);
  });
  it("reports why it cannot record", () => {
    expect(getAutoRecordDecision({ ...base, hasTask: false }).reason).toBe(AUTO_RECORD_REASONS.NO_PLAN);
    expect(getAutoRecordDecision({ ...base, alreadyRead: true }).reason).toBe("already_read");
    expect(getAutoRecordDecision({ ...base, offline: true })).toEqual({ ok: false, reason: "offline" });
    expect(getAutoRecordDecision({ ...base, expired: true }).reason).toBe("expired");
    expect(getAutoRecordDecision({ ...base, locked: true }).reason).toBe("locked");
    expect(getAutoRecordDecision({ ...base, isOldRound: true }).reason).toBe("old_round");
  });
  it("shows already_read even when the plan has since ended", () => {
    expect(getAutoRecordDecision({ ...base, alreadyRead: true, expired: true }).reason).toBe("already_read");
  });
});

describe("selectAutoRecordPlanTask", () => {
  it("behind-schedule user reading today's chapter still resolves the plan", () => {
    const p = plan("a", [[chapter(1), chapter(2)], [chapter(3)]]);
    const found = selectAutoRecordPlanTask({ plans: [p], bookName: BOOK, chapterNum: 3 });
    expect(found.plan.id).toBe("a");
    expect(found.round).toBe(1);
  });
  it("returns null (no_plan) when no plan contains the chapter", () => {
    const p = plan("a", [[chapter(1)]]);
    expect(selectAutoRecordPlanTask({ plans: [p], bookName: BOOK, chapterNum: 9 })).toBeNull();
    expect(selectAutoRecordPlanTask({ plans: [], bookName: BOOK, chapterNum: 1 })).toBeNull();
  });
  it("only matches the plan's CURRENT round", () => {
    const p = plan("a", [[chapter(1, 1, true)], [chapter(1, 2)]], { currentRound: 2 });
    const found = selectAutoRecordPlanTask({ plans: [p], bookName: BOOK, chapterNum: 1 });
    expect(found.round).toBe(2);
    const done = plan("b", [[chapter(1, 1, true)]], { currentRound: 2 });
    expect(selectAutoRecordPlanTask({ plans: [done], bookName: BOOK, chapterNum: 1 })).toBeNull();
    // 情境計畫的舊遍數任務 → 決策上不記錄
    expect(getAutoRecordDecision({ hasTask: true, isOldRound: true }).ok).toBe(false);
  });
  it("skips plans the caller marks unusable (expired / locked)", () => {
    const a = plan("a", [[chapter(1)]]);
    const b = plan("b", [[chapter(1)]]);
    const found = selectAutoRecordPlanTask({
      plans: [a, b], bookName: BOOK, chapterNum: 1, isUsable: p => p.id !== "a"
    });
    expect(found.plan.id).toBe("b");
  });
  it("two matching plans: the most recently opened wins", () => {
    const a = plan("a", [[chapter(1)]]);
    const b = plan("b", [[chapter(1)]]);
    const found = selectAutoRecordPlanTask({
      plans: [a, b], bookName: BOOK, chapterNum: 1,
      activePlanId: "a", lastOpened: { a: 1000, b: 2000 }
    });
    expect(found.plan.id).toBe("b");
  });
  it("without timestamps falls back to the active plan, then the first match", () => {
    const a = plan("a", [[chapter(1)]]);
    const b = plan("b", [[chapter(1)]]);
    expect(selectAutoRecordPlanTask({ plans: [a, b], bookName: BOOK, chapterNum: 1, activePlanId: "b" }).plan.id).toBe("b");
    expect(selectAutoRecordPlanTask({ plans: [a, b], bookName: BOOK, chapterNum: 1 }).plan.id).toBe("a");
  });
});

describe("plan last-opened storage", () => {
  it("records and reads a JSON map under one key", () => {
    const storage = memoryStorage();
    expect(recordPlanOpened({ id: "a" }, { storage, now: 5 })).toBe(true);
    recordPlanOpened({ presetKey: "k" }, { storage, now: 9 });
    expect(readPlanLastOpened(storage)).toEqual({ a: 5, k: 9 });
    expect(Object.keys(JSON.parse(storage.getItem(PLAN_LAST_OPENED_STORAGE_KEY)))).toHaveLength(2);
  });
  it("never throws when storage is broken or holds garbage", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(readPlanLastOpened(broken)).toEqual({});
    expect(recordPlanOpened({ id: "a" }, { storage: broken })).toBe(false);
    const garbage = memoryStorage();
    garbage.setItem(PLAN_LAST_OPENED_STORAGE_KEY, "not json");
    expect(readPlanLastOpened(garbage)).toEqual({});
    expect(recordPlanOpened({}, { storage: garbage })).toBe(false);
  });
});

describe("auto paths no longer apply the #331 sequential rule", () => {
  const bible = readFileSync(new URL("../js/modules/bible.js", import.meta.url), "utf8");
  const plansSrc = readFileSync(new URL("../js/modules/plan.js", import.meta.url), "utf8");
  const between = (source, start, end) => {
    const from = source.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const to = source.indexOf(end, from);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("reader auto-mark uses the shared decision, not getSequentialCheckBlock", () => {
    const body = between(bible, "async function autoMarkCurrentPlanReaderTaskRead", "function initImmersivePlanReader");
    expect(body).toContain("getReaderTaskDecision");
    expect(body).not.toContain("getSequentialCheckBlock");
  });
  it("inline reader auto-mark uses the shared decision, not getSequentialCheckBlock", () => {
    const body = between(plansSrc, "async function autoMarkInlineReaderTaskRead", "function checkInlineReaderBottomDwell");
    expect(body).toContain("getInlineReaderTaskDecision");
    expect(body).not.toContain("getSequentialCheckBlock");
  });
  it("manual paths keep the in-order rule", () => {
    expect(bible).toContain("const sequentialBlock = getSequentialCheckBlock(state.activePlan");
    expect(plansSrc).toContain("const sequentialBlock = getSequentialCheckBlock(state.activePlan");
  });
  it("navigation and TTS completion record the chapter being left, before readerState changes", () => {
    const nav = between(bible, "export async function navigateToChapter", "let newChapter");
    expect(nav).toContain("recordLeavingReaderChapter()");
    const tts = between(bible, "async function continueReaderAudioToNextChapter", "navigateToChapter(1");
    expect(tts).toContain("recordLeavingReaderChapter({ force: true })");
    // 寫入用離開前的快照章號，不讀（可能已被改掉的）readerState.chapter
    const mark = between(bible, "async function autoMarkCurrentPlanReaderTaskRead", "function initImmersivePlanReader");
    expect(mark).toContain("db.logChapterRead(taskContext.book.name, chapterNum,");
    const inline = between(plansSrc, "window.navigateInlineChapter", "Window scroll listener");
    const at = inline.indexOf("autoMarkInlineReaderTaskRead(leavingKey)");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(inline.indexOf("currentIndex = newIndex"));
  });
  it("records the last-opened plan when a joined plan is opened", () => {
    expect(between(plansSrc, "async function openJoinedPlanProgress", "state.planDetailOpen")).toContain("recordPlanOpened(plan)");
  });
});
