import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildAudioTimingUrl,
  createAudioTimingStore,
  findVerseAtTime,
  formatHumanAudioVerseLabel,
  getVerseStartTime,
  normalizeChapterTimings,
  readBookTimings
} from "../js/modules/reader-audio-timing.mjs";
import { createHumanAudioPlayer } from "../js/modules/reader-human-audio.mjs";
import { packTimings } from "./human-audio-timing/pack.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");

const PS_117 = { v: 1, book: 19, chapters: { "117": [[1, 3.53], [2, 17.39]] } };

function jsonResponse(payload, ok = true) {
  return { ok, json: async () => payload };
}

function createFakeAudio() {
  const listeners = {};
  return {
    src: "",
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    paused: true,
    playCalls: 0,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    load() {},
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    dispatch(type) { (listeners[type] || []).forEach(fn => fn()); }
  };
}

describe("逐節時間表格式（#637）", () => {
  it("一卷一個同網域靜態檔", () => {
    expect(buildAudioTimingUrl(19)).toBe("/assets/audio-timing/19.json");
  });

  it("整理成依節排序的 [{ verse, start }]；節重複、秒數倒退、格式不對都當作沒有時間表", () => {
    expect(normalizeChapterTimings([[2, 17.39], [1, 3.53]])).toEqual([{ verse: 1, start: 3.53 }, { verse: 2, start: 17.39 }]);
    expect(normalizeChapterTimings([[1, 3], [1, 5]])).toBeNull();
    expect(normalizeChapterTimings([[1, 9], [2, 5]])).toBeNull();
    expect(normalizeChapterTimings([[0, 1]])).toBeNull();
    expect(normalizeChapterTimings([[1, -1]])).toBeNull();
    expect(normalizeChapterTimings([])).toBeNull();
    expect(normalizeChapterTimings(undefined)).toBeNull();
  });

  it("書卷檔要對得上版本和書卷編號", () => {
    expect(readBookTimings(PS_117, 19)).toBe(PS_117.chapters);
    expect(readBookTimings(PS_117, 18)).toBeNull();
    expect(readBookTimings({ ...PS_117, v: 2 }, 19)).toBeNull();
    expect(readBookTimings(null, 19)).toBeNull();
  });
});

describe("念到第幾節（#637）", () => {
  const timings = normalizeChapterTimings([[1, 4.67], [2, 7.88], [3, 16.45]]);

  it("取最後一個開始時間 ≤ 現在的節", () => {
    expect(findVerseAtTime(timings, 4.67)).toEqual({ verse: 1, lastVerse: 1, index: 0, total: 3 });
    expect(findVerseAtTime(timings, 10)).toEqual({ verse: 2, lastVerse: 2, index: 1, total: 3 });
    expect(findVerseAtTime(timings, 999)).toEqual({ verse: 3, lastVerse: 3, index: 2, total: 3 });
  });

  it("併節（信望愛把民 1:21 併進 1:20）同一個秒數：回第一節到最後一節，共幾節照算", () => {
    const merged = normalizeChapterTimings([[19, 90], [20, 100], [21, 100], [22, 120]]);
    expect(findVerseAtTime(merged, 110)).toEqual({ verse: 20, lastVerse: 21, index: 1, total: 4 });
    expect(getVerseStartTime(merged, 21)).toBe(100);
    expect(formatHumanAudioVerseLabel({ status: "speaking", verse: 20, lastVerse: 21, total: 54 })).toBe("朗讀中・第 20–21 節／共 54 節");
  });

  it("章首報章名（第 1 節之前）不算任何一節", () => {
    expect(findVerseAtTime(timings, 2)).toBeNull();
    expect(findVerseAtTime(null, 2)).toBeNull();
  });

  it("從標記的節開始：查那一節的開始秒數；查不到回 null", () => {
    expect(getVerseStartTime(timings, 3)).toBe(16.45);
    expect(getVerseStartTime(timings, 9)).toBeNull();
  });

  it("進度文字是「第 N 節／共 M 節」，沿用朗讀中／已暫停／已完成", () => {
    expect(formatHumanAudioVerseLabel({ status: "speaking", verse: 3, total: 31 })).toBe("朗讀中・第 3 節／共 31 節");
    expect(formatHumanAudioVerseLabel({ status: "paused", verse: 3, total: 31 })).toBe("已暫停・第 3 節／共 31 節");
    expect(formatHumanAudioVerseLabel({ status: "completed", verse: 31, total: 31 })).toBe("已完成・第 31 節／共 31 節");
  });
});

describe("時間表讀取（#637）", () => {
  it("同一卷只抓一次，各章從同一個檔取", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PS_117));
    const store = createAudioTimingStore({ fetchImpl });
    store.prefetch(19);
    expect(await store.getChapter(19, 117)).toEqual([{ verse: 1, start: 3.53 }, { verse: 2, start: 17.39 }]);
    expect(await store.getChapter(19, 1)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/assets/audio-timing/19.json");
  });

  it("檔案不在或網路錯誤：回 null（退回整章播放），不丟錯", async () => {
    const missing = createAudioTimingStore({ fetchImpl: async () => jsonResponse(null, false) });
    expect(await missing.getChapter(1, 1)).toBeNull();
    const offline = createAudioTimingStore({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    expect(await offline.getChapter(1, 1)).toBeNull();
  });
});

describe("打包腳本（#637）", () => {
  it("只留節和秒數，秒數取到小數兩位；沒對到的節（併節）用前一節的秒數", () => {
    const { books, skipped } = packTimings([
      { book: 19, chapter: 117, verses: [[1, 3.534, 0.9], [2, 17.391, 0.8]] },
      { book: 19, chapter: 3, verses: [[1, 3.5, 0.9], [2, null, 0]] }
    ]);
    expect(skipped).toEqual([]);
    expect(books.get(19)).toEqual({ v: 1, book: 19, chapters: { "117": [[1, 3.53], [2, 17.39]], "3": [[1, 3.5], [2, 3.5]] } });
  });

  it("一章的時間倒退就整章不放，App 那章退回整章播放", () => {
    const { books, skipped } = packTimings([{ book: 1, chapter: 1, verses: [[1, 9, 1], [2, 5, 1]] }]);
    expect(books.size).toBe(0);
    expect(skipped).toEqual(["1:1"]);
  });
});

describe("播放器從某一秒開始（#637）", () => {
  it("startAt：換 src 後就設好開始位置，play() 不等音檔長度", async () => {
    const audio = createFakeAudio();
    const player = createHumanAudioPlayer({
      createAudio: () => audio,
      fetchImpl: async () => jsonResponse({ status: "success", mp3: "https://media.fhl.net/unv1/19/19_117.mp3" })
    });
    await player.start({ bookId: 19, chapter: 117, rate: 1, startAt: 17.39 });
    expect(audio.currentTime).toBe(17.39);
    expect(audio.playCalls).toBe(1);
  });

  it("瀏覽器在拿到長度前忽略了開始位置：loadedmetadata 時補跳", async () => {
    const audio = createFakeAudio();
    const player = createHumanAudioPlayer({
      createAudio: () => audio,
      fetchImpl: async () => jsonResponse({ status: "success", mp3: "https://media.fhl.net/unv1/19/19_117.mp3" })
    });
    await player.start({ bookId: 19, chapter: 117, rate: 1, startAt: 17.39 });
    audio.currentTime = 0; // 模擬舊版 iOS Safari 把它重設回 0
    audio.dispatch("loadedmetadata");
    expect(audio.currentTime).toBe(17.39);
  });

  it("沒有 startAt 就從頭播", async () => {
    const audio = createFakeAudio();
    const player = createHumanAudioPlayer({
      createAudio: () => audio,
      fetchImpl: async () => jsonResponse({ status: "success", mp3: "https://media.fhl.net/unv1/19/19_117.mp3" })
    });
    await player.start({ bookId: 19, chapter: 117, rate: 1 });
    audio.dispatch("loadedmetadata");
    expect(audio.currentTime).toBe(0);
  });
});

describe("真人朗讀接上時間表（#637）", () => {
  it("開始播之前先拿這一章的時間表，有標記的節就從那一節的秒數開始", () => {
    const start = bible.indexOf("async function startHumanReaderAudio(");
    const fn = bible.slice(start, bible.indexOf("\n}", start));
    expect(fn).toContain("loadHumanAudioTimings(bookId, chapter)");
    expect(fn).toContain("getVerseStartTime(timings, selectedVerseNum)");
    expect(fn).toContain("startAt: startAt ?? 0");
  });

  it("時間表等太久就當作沒有，不讓按下朗讀卡住", () => {
    expect(bible).toMatch(/const HUMAN_AUDIO_TIMING_WAIT_MS = \d+;/);
    const start = bible.indexOf("async function loadHumanAudioTimings(");
    const fn = bible.slice(start, bible.indexOf("\n}", start));
    expect(fn).toContain("Promise.race");
  });

  it("接下一章時時間表不擋聲音：先 player.start 再載時間表", () => {
    const start = bible.indexOf("async function continueHumanAudioToNextChapter(sessionId)");
    const fn = bible.slice(start, bible.indexOf("\n}", start));
    expect(fn.indexOf("player.start(")).toBeGreaterThan(-1);
    expect(fn.indexOf("loadHumanAudioTimings(next.book.id, next.chapter)")).toBeGreaterThan(fn.indexOf("player.start("));
    expect(fn).not.toContain("await loadHumanAudioTimings");
  });

  it("只有畫面和聲音是同一章時才標示節", () => {
    const start = bible.indexOf("function getActiveHumanAudioTimings(");
    const fn = bible.slice(start, bible.indexOf("\n}", start));
    expect(fn).toContain("humanAudioPlayer.isLoaded(bookId, chapter)");
    expect(fn).toContain("humanAudioTimingKeyOf(bookId, chapter)");
  });
});
