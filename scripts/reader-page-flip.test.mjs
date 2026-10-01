// @vitest-environment jsdom
// #347 翻頁動畫：紙片位置計算、快照只複製看得到的區塊、翻頁控制器的換章／取消／收尾。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLIP_LITE_STORAGE_KEY,
  FLIP_MAX_DIM,
  FLIP_MAX_TILT_DEG,
  buildChapterPreview,
  buildViewportSnapshot,
  computeFlipDuration,
  computeFlipFrame,
  createReaderPageFlip
} from "../js/modules/reader-page-flip.mjs";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function rect(top, height, left = 0, width = 375) {
  return { top, bottom: top + height, left, right: left + width, width, height, x: left, y: top };
}

function withRect(el, r) {
  el.getBoundingClientRect = () => r;
  return el;
}

describe("computeFlipFrame", () => {
  it("next chapter: the current page slides left and uncovers the next one", () => {
    expect(computeFlipFrame(1, 0)).toEqual({ x: -0, rotate: -0, dim: FLIP_MAX_DIM });
    const half = computeFlipFrame(1, 0.5);
    expect(half.x).toBe(-0.5);
    expect(half.rotate).toBeCloseTo(-FLIP_MAX_TILT_DEG / 2);
    expect(half.dim).toBeCloseTo(FLIP_MAX_DIM / 2);
    expect(computeFlipFrame(1, 1)).toMatchObject({ x: -1, dim: 0 });
  });

  it("previous chapter (#380): the current page also moves — to the right — and uncovers the previous one", () => {
    expect(computeFlipFrame(-1, 0)).toEqual({ x: 0, rotate: 0, dim: FLIP_MAX_DIM });
    const half = computeFlipFrame(-1, 0.5);
    expect(half.x).toBe(0.5);
    expect(half.rotate).toBeCloseTo(FLIP_MAX_TILT_DEG / 2);
    expect(half.dim).toBeCloseTo(FLIP_MAX_DIM / 2);
    expect(computeFlipFrame(-1, 1)).toMatchObject({ x: 1, dim: 0 });
  });

  it("lite mode (slow phones, reduced motion) drops the tilt and the dimming", () => {
    expect(computeFlipFrame(1, 0.5, { lite: true })).toEqual({ x: -0.5, rotate: 0, dim: 0 });
  });

  it("clamps progress into 0–1", () => {
    expect(computeFlipFrame(1, 3).x).toBe(-1);
    expect(computeFlipFrame(1, -2).x).toBe(-0);
  });
});

describe("computeFlipDuration", () => {
  it("stays between 160 and 320ms and follows a fast release", () => {
    expect(computeFlipDuration(1, 0, 375)).toBe(320);
    expect(computeFlipDuration(0.1, 0, 375)).toBe(160);
    expect(computeFlipDuration(0.8, 2, 375)).toBe(160);
    expect(computeFlipDuration(0.8, 1.2, 375)).toBe(250);
  });
});

describe("buildViewportSnapshot", () => {
  it("copies only the blocks that intersect the stage, at the measured positions, without ids", () => {
    const header = withRect(document.createElement("div"), rect(-200, 60));
    header.className = "reader-header";
    const container = document.createElement("div");
    container.id = "bible-content";
    container.className = "bible-text-container";
    container.style.fontSize = "18px";
    [[-100, 50], [100, 50], [150, 50], [900, 50], [950, 50]].forEach(([top, height], i) => {
      const verse = withRect(document.createElement("div"), rect(top, height, 20, 335));
      verse.className = "bible-verse";
      verse.id = `reader-verse-${i + 1}`;
      verse.dataset.verse = String(i + 1);
      container.appendChild(verse);
    });
    const page = buildViewportSnapshot({ header, container, stageRect: rect(60, 700) });
    const shell = page.querySelector(".bible-text-container");
    expect(page.querySelector(".reader-header")).toBeNull();
    expect(shell.id).toBe("");
    expect(shell.style.fontSize).toBe("18px");
    const verses = [...shell.querySelectorAll(".bible-verse")];
    expect(verses.map(v => v.dataset.verse)).toEqual(["2", "3"]);
    expect(verses.every(v => !v.id)).toBe(true);
    expect(verses[0].style.top).toBe("40px");
    expect(verses[0].style.left).toBe("20px");
    expect(verses[0].style.width).toBe("335px");
  });
});

describe("buildChapterPreview", () => {
  it("lays out the target chapter where the top of the page would be, with the new heading", () => {
    const surface = document.createElement("article");
    surface.scrollTop = 500;
    const header = withRect(document.createElement("div"), rect(-420, 60));
    header.innerHTML = '<h2 id="bible-title" class="bible-heading">創世記 1章</h2>';
    const container = document.createElement("div");
    container.id = "bible-content";
    container.className = "bible-text-container";
    const fill = vi.fn(shell => { shell.appendChild(document.createElement("p")); });
    const page = buildChapterPreview({
      header, container, surface, stageRect: rect(60, 700), headingText: "創世記 2章", fillContent: fill
    });
    const flow = page.querySelector(".reader-flip-flow");
    expect(flow.style.top).toBe("20px"); // -420 + 500 - 60
    expect(page.querySelector(".bible-heading").textContent).toBe("創世記 2章");
    expect(page.querySelector("#bible-title")).toBeNull();
    expect(fill).toHaveBeenCalledTimes(1);
    expect(page.querySelector(".bible-text-container p")).not.toBeNull();
  });
});

describe("createReaderPageFlip", () => {
  let host;

  afterEach(() => {
    host?.remove();
  });

  function setup({ storage = null, reducedMotion = false } = {}) {
    host = withRect(document.createElement("section"), rect(0, 800));
    document.body.appendChild(host);
    const onCommit = vi.fn(async () => true);
    const buildCurrentPage = vi.fn(() => {
      const page = document.createElement("div");
      page.className = "reader-flip-page current";
      return page;
    });
    const buildTargetPage = vi.fn(() => {
      const page = document.createElement("div");
      page.className = "reader-flip-page target";
      return page;
    });
    let frame = 0;
    const win = {
      matchMedia: () => ({ matches: reducedMotion }),
      requestAnimationFrame: cb => { frame += 16; cb(frame); return frame; },
      cancelAnimationFrame: () => {}
    };
    const flip = createReaderPageFlip({
      host,
      getStageRect: () => rect(60, 700),
      buildCurrentPage,
      buildTargetPage,
      onCommit,
      win,
      doc: document,
      storage
    });
    return { flip, onCommit, buildCurrentPage, buildTargetPage };
  }

  it("next: the current page moves on top of the next-chapter preview; releasing past the line changes chapter and removes the stage", async () => {
    const { flip, onCommit } = setup();
    expect(flip.begin(1)).toBe(true);
    const stage = host.querySelector(".reader-flip-stage");
    expect(stage.style.top).toBe("60px");
    expect(stage.querySelector(".reader-flip-under.target")).not.toBeNull();
    expect(stage.querySelector(".reader-flip-mover.current")).not.toBeNull();
    flip.update(0.5);
    expect(stage.querySelector(".reader-flip-mover").style.transform).toContain("translate3d(-187.5px");
    await flip.release({ direction: 1, commit: true, velocity: -1 });
    expect(onCommit).toHaveBeenCalledWith(1);
    expect(host.querySelector(".reader-flip-stage")).toBeNull();
  });

  it("previous (#380): the current page moves right over a still previous-chapter preview; the live page is fully covered", () => {
    const { flip, buildCurrentPage, buildTargetPage } = setup();
    flip.begin(-1);
    expect(buildCurrentPage).toHaveBeenCalledTimes(1);
    expect(buildTargetPage).toHaveBeenCalledWith(-1, expect.anything());
    expect(host.querySelector(".reader-flip-under.target")).not.toBeNull();
    const mover = host.querySelector(".reader-flip-mover.current");
    expect(mover).not.toBeNull();
    expect(mover.classList.contains("is-prev")).toBe(true);
    flip.update(0.5);
    expect(mover.style.transform).toContain("translate3d(187.5px");
    flip.finishNow();
  });

  it("released before the line: springs back and does not change chapter", async () => {
    const { flip, onCommit } = setup();
    flip.begin(1);
    flip.update(0.1);
    await flip.release({ direction: 1, commit: false });
    expect(onCommit).not.toHaveBeenCalled();
    expect(host.querySelector(".reader-flip-stage")).toBeNull();
  });

  it("buttons / keys: play() flips and changes chapter; a new gesture ends a running flip at once", async () => {
    const { flip, onCommit } = setup();
    await flip.play(-1);
    expect(onCommit).toHaveBeenCalledWith(-1);
    flip.begin(1);
    expect(flip.isActive()).toBe(true);
    flip.finishNow();
    expect(flip.isActive()).toBe(false);
    expect(host.querySelector(".reader-flip-stage")).toBeNull();
  });

  it("still changes chapter without animation when the pages cannot be built", async () => {
    const { flip, onCommit, buildTargetPage } = setup();
    buildTargetPage.mockImplementation(() => { throw new Error("layout"); });
    expect(flip.begin(-1)).toBe(false);
    await flip.release({ direction: -1, commit: true });
    expect(onCommit).toHaveBeenCalledWith(-1);
  });

  it("reduced motion: no pages at all, just the chapter change", async () => {
    const { flip, onCommit, buildCurrentPage } = setup({ reducedMotion: true });
    await flip.play(1);
    expect(buildCurrentPage).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith(1);
    expect(await flip.peek(1)).toBe(false);
  });

  it("switches to lite mode for good when dragging drops frames", async () => {
    const store = new Map();
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    host = withRect(document.createElement("section"), rect(0, 800));
    document.body.appendChild(host);
    let frame = 0;
    const flip = createReaderPageFlip({
      host,
      getStageRect: () => rect(60, 700),
      buildCurrentPage: () => document.createElement("div"),
      buildTargetPage: () => document.createElement("div"),
      onCommit: async () => true,
      win: { matchMedia: () => ({ matches: false }), requestAnimationFrame: cb => { frame += 50; cb(frame); return frame; }, cancelAnimationFrame: () => {} },
      doc: document,
      storage
    });
    flip.begin(1);
    for (let i = 1; i <= 10; i += 1) flip.update(i / 20);
    await flip.release({ direction: 1, commit: false });
    expect(flip.isLite()).toBe(true);
    expect(store.get(FLIP_LITE_STORAGE_KEY)).toBe("1");
  });
});

describe("chapter-end links in the real reader (#347)", () => {
  it("renders 上一章｜下一章 after the record status and changes chapter when tapped", async () => {
    globalThis.BIBLE_BOOKS = [
      { id: 1, name: "創世記", eng: "Genesis", chapters: 50, abbrev: "創" },
      { id: 2, name: "出埃及記", eng: "Exodus", chapters: 40, abbrev: "出" }
    ];
    globalThis.state = {
      readerState: { bookId: 1, chapter: 1, fromPlan: false, version: "CUNP", planContextId: null },
      activePlans: [], activePlan: null, offlineMode: false, readingLogs: [], highlights: {}, verseNotes: {}
    };
    window.state = globalThis.state;
    globalThis.isPlanExpired = () => false;
    globalThis.calculatePlanProgress = () => {};
    globalThis.showToast = vi.fn();
    globalThis.db = { logChapterRead: vi.fn(async () => {}), getVerseNotesForChapter: async () => ({}) };
    globalThis.saveReaderPreferences = () => {};
    globalThis.ComponentSkeletonLoader = { show() {} };
    globalThis.fetchBibleChapter = async () => ({ verses: [{ verse: 1, text: "起初" }, { verse: 2, text: "地是空虛混沌" }] });
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
    document.body.innerHTML = '<div id="reader-view"><article class="reader-reading-surface"><div class="reader-header"><h2 id="bible-title" class="bible-heading"></h2></div><div id="bible-content"></div></article><div id="reader-chapter-announcer"></div></div>';
    const bible = await import("../js/modules/bible.js");

    await bible.renderReaderText();
    const nav = document.querySelector("#bible-content .reader-chapter-end-nav");
    expect(nav).not.toBeNull();
    const [prev, next] = nav.querySelectorAll("[data-chapter-nav]");
    // 創世記 1 章：沒有上一章
    expect(prev.hidden).toBe(true);
    expect(nav.querySelector(".reader-chapter-end-sep").hidden).toBe(true);
    expect(next.hidden).toBe(false);
    expect(next.textContent).toContain("下一章");

    next.click();
    await flush(); await flush(); await flush();
    expect(state.readerState.chapter).toBe(2);
    expect(document.getElementById("bible-title").textContent).toBe("創世記 2章");
    expect(document.getElementById("reader-chapter-announcer").textContent).toBe("已切換到 創世記 2章");
    const prevNow = document.querySelector("#bible-content [data-chapter-nav='-1']");
    expect(prevNow.hidden).toBe(false);

    // 點經文仍然是切換選取（事件委派）
    const verse = document.querySelector("#bible-content .bible-verse[data-verse='1']");
    verse.click();
    expect(verse.getAttribute("aria-pressed")).toBe("true");
  });
});
