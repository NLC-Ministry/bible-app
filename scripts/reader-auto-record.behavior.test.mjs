// @vitest-environment jsdom
// #349 實際載入 bible.js：章末到過後換章 → 記錄離開的那一章；章末狀態列；無計畫的章不顯示。
import { beforeAll, describe, expect, it, vi } from "vitest";
const flush = () => new Promise(r => setTimeout(r, 0));
let bible; const logs = []; let ioCb = null;
beforeAll(async () => {
  globalThis.BIBLE_BOOKS = [{ id: 1, name: "創世記", eng: "Genesis", chapters: 50, abbrev: "創" }, { id: 2, name: "出埃及記", eng: "Exodus", chapters: 40, abbrev: "出" }];
  const mk = (n, read) => ({ book: "出埃及記", chapter: n, round: 1, isReadR1: read, isRead: read });
  const plan = { id: "p1", name: "計畫一", planKind: "church_campaign_stage", currentRound: 1, days: [{ dayNum: 1, chapters: [mk(1, false), mk(2, false), mk(3, false)] }] };
  globalThis.state = { readerState: { bookId: 2, chapter: 3, fromPlan: false, version: "CUNP", planContextId: null }, activePlans: [plan], activePlan: plan, offlineMode: false, readingLogs: [], highlights: {}, verseNotes: {} };
  window.state = state;
  globalThis.isPlanExpired = () => false;
  globalThis.calculatePlanProgress = () => {}; globalThis.showToast = vi.fn();
  globalThis.db = { logChapterRead: vi.fn(async (b, c) => { logs.push([b, c]); }), getVerseNotesForChapter: async () => ({}) };
  globalThis.saveReaderPreferences = () => {};
  globalThis.ComponentSkeletonLoader = { show() {} };
  globalThis.fetchBibleChapter = async (eng, ch) => ({ verses: [{ verse: 1, text: "太初" }] });
  globalThis.IntersectionObserver = class { constructor(cb) { ioCb = cb; } observe(el) { this.el = el; } disconnect() {} };
  window.APP_COPY = { plan: { autoRecordDone: "✓ 已記錄到〈{plan}〉", autoRecordPending: "待記錄", autoRecordNotRecorded: "未記錄：{reason}" } };
  document.body.innerHTML = '<div id="reader-view"><div class="reader-reading-surface"><h2 id="bible-title"></h2><div id="bible-content"></div></div></div>';
  bible = await import("../js/modules/bible.js");
});
describe("reader auto-record (runtime, #349)", () => {
  it("no end reached -> navigating does not record; fallback status pending", async () => {
    await bible.renderReaderText();
    const el = document.getElementById("reader-record-status");
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("待記錄");
    await bible.navigateToChapter(-1);
    await flush();
    expect(logs).toEqual([]);
  });
  it("end reached then navigate -> old chapter (2) recorded, status for new chapter", async () => {
    // now on chapter 2
    expect(state.readerState.chapter).toBe(2);
    const sentinel = document.getElementById("reader-end-sentinel");
    ioCb([{ target: sentinel, isIntersecting: true }]);
    await bible.navigateToChapter(1);
    await flush(); await flush();
    expect(logs).toEqual([["出埃及記", 2]]);
    expect(state.readerState.chapter).toBe(3);
    expect(state.activePlan.days[0].chapters[1].isReadR1).toBe(true);
    expect(state.activePlan.days[0].chapters[2].isReadR1).toBe(false);
    expect(document.getElementById("reader-record-status").textContent).toBe("待記錄");
  });
  it("free chapter not in any plan -> status hidden", async () => {
    state.readerState.chapter = 9; await bible.renderReaderText();
    expect(document.getElementById("reader-record-status").hidden).toBe(true);
  });
  it("offline -> not recorded status", async () => {
    state.readerState.chapter = 3; state.offlineMode = true; await bible.renderReaderText();
    expect(document.getElementById("reader-record-status").textContent).toBe("未記錄：離線中");
  });
});
