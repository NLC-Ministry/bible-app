// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  computeSwipeVelocity,
  createReaderSwipeController,
  getSwipeCommitDistance,
  shouldCommitSwipe,
  isInSwipeEdgeGuard,
  readerArrowKeyDirection,
  resolveAdjacentChapter,
  resolveSwipeAxis,
  swipeDirectionFromDelta
} from "../js/modules/reader-chapter-nav.mjs";
import { buildChapterEndNav } from "../js/modules/reader-verse-dom.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

const BOOKS = [
  { id: 1, name: "創世記", eng: "Genesis", chapters: 50 },
  { id: 2, name: "出埃及記", eng: "Exodus", chapters: 40 },
  { id: 40, name: "馬太福音", eng: "Matthew", chapters: 28 },
  { id: 41, name: "馬可福音", eng: "Mark", chapters: 16 },
  { id: 66, name: "啟示錄", eng: "Revelation", chapters: 22 }
];

describe("reader chapter swipe helpers (#314)", () => {
  it("maps swipe left to next chapter and swipe right to previous chapter", () => {
    expect(swipeDirectionFromDelta(-80)).toBe(1);
    expect(swipeDirectionFromDelta(80)).toBe(-1);
    expect(swipeDirectionFromDelta(0)).toBe(0);
  });

  it("keeps the commit distance between 56px and 96px", () => {
    expect(getSwipeCommitDistance(200)).toBe(56);
    expect(getSwipeCommitDistance(375)).toBeCloseTo(82.5);
    expect(getSwipeCommitDistance(1200)).toBe(96);
  });

  it("leaves swipes starting at the screen edge to the OS back gesture", () => {
    expect(isInSwipeEdgeGuard(10, 375)).toBe(true);
    expect(isInSwipeEdgeGuard(365, 375)).toBe(true);
    expect(isInSwipeEdgeGuard(180, 375)).toBe(false);
  });

  it("only treats clearly horizontal movement as a swipe", () => {
    expect(resolveSwipeAxis(4, 3)).toBe("pending");
    expect(resolveSwipeAxis(40, 5)).toBe("horizontal");
    expect(resolveSwipeAxis(40, 30)).toBe("vertical");
    expect(resolveSwipeAxis(3, 40)).toBe("vertical");
  });

  it("commits a swipe on distance, or on a fast flick in the same direction", () => {
    expect(shouldCommitSwipe({ dx: -90, velocity: 0, commitDistance: 82 })).toBe(true);
    expect(shouldCommitSwipe({ dx: -30, velocity: -0.8, commitDistance: 82 })).toBe(true);
    expect(shouldCommitSwipe({ dx: -30, velocity: -0.2, commitDistance: 82 })).toBe(false);
    expect(shouldCommitSwipe({ dx: -10, velocity: -1.5, commitDistance: 82 })).toBe(false);
    // 往左拖了一段、最後往回撥：方向不一致不算
    expect(shouldCommitSwipe({ dx: -30, velocity: 0.8, commitDistance: 82 })).toBe(false);
  });

  it("measures swipe velocity over the last moments and ignores same-frame bursts", () => {
    expect(computeSwipeVelocity([{ x: 300, t: 0 }, { x: 250, t: 50 }])).toBe(-1);
    expect(computeSwipeVelocity([{ x: 300, t: 0 }, { x: 250, t: 2 }])).toBe(0);
    expect(computeSwipeVelocity([{ x: 300, t: 0 }, { x: 290, t: 400 }, { x: 240, t: 450 }])).toBe(-1);
    expect(computeSwipeVelocity([])).toBe(0);
  });

  it("resolves adjacent chapters across book boundaries and stops at both ends", () => {
    expect(resolveAdjacentChapter(BOOKS, 1, 5, 1)).toEqual({ book: BOOKS[0], chapter: 6 });
    expect(resolveAdjacentChapter(BOOKS, 40, 28, 1)).toEqual({ book: BOOKS[3], chapter: 1 });
    expect(resolveAdjacentChapter(BOOKS, 41, 1, -1)).toEqual({ book: BOOKS[2], chapter: 28 });
    expect(resolveAdjacentChapter(BOOKS, 1, 1, -1)).toBeNull();
    expect(resolveAdjacentChapter(BOOKS, 66, 22, 1)).toBeNull();
  });

  it("handles arrow keys only when not typing and without modifiers", () => {
    const input = document.createElement("input");
    expect(readerArrowKeyDirection({ key: "ArrowLeft", target: document.body })).toBe(-1);
    expect(readerArrowKeyDirection({ key: "ArrowRight", target: document.body })).toBe(1);
    expect(readerArrowKeyDirection({ key: "ArrowRight", target: input })).toBe(0);
    expect(readerArrowKeyDirection({ key: "ArrowRight", target: document.body, repeat: true })).toBe(0);
    expect(readerArrowKeyDirection({ key: "ArrowRight", target: document.body, altKey: true })).toBe(0);
    expect(readerArrowKeyDirection({ key: "ArrowUp", target: document.body })).toBe(0);
  });
});

describe("createReaderSwipeController (#314)", () => {
  let surface;
  let controller;

  afterEach(() => {
    controller?.destroy();
    surface?.remove();
  });

  function setup(overrides = {}) {
    surface = document.createElement("section");
    surface.innerHTML = `<div class="bible-verse" role="button">經文</div><button type="button">按鈕</button>`;
    document.body.appendChild(surface);
    const onNavigate = vi.fn();
    const onDrag = vi.fn();
    const onDragStart = vi.fn();
    controller = createReaderSwipeController({
      surface,
      onNavigate,
      onDrag,
      onDragStart,
      win: { innerWidth: 375, getSelection: () => null },
      ...overrides
    });
    return { onNavigate, onDrag, onDragStart };
  }

  function touch(type, target, points) {
    const event = new Event(type, { bubbles: true });
    event.touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
    target.dispatchEvent(event);
  }

  function swipe(target, from, to, steps = 4) {
    touch("touchstart", target, [from]);
    for (let i = 1; i <= steps; i++) {
      touch("touchmove", target, [[
        from[0] + ((to[0] - from[0]) * i) / steps,
        from[1] + ((to[1] - from[1]) * i) / steps
      ]]);
    }
    touch("touchend", target, []);
  }

  it("navigates to the next chapter on a long enough left swipe that starts on a verse", () => {
    const { onNavigate, onDrag, onDragStart } = setup();
    swipe(surface.querySelector(".bible-verse"), [300, 400], [180, 405]);
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledWith(1);
    // 頁面跟著手指：progress＝位移佔螢幕寬的比例（120 / 375）
    expect(onDrag).toHaveBeenLastCalledWith(1, expect.objectContaining({ dx: -120, progress: 0.32 }));
  });

  it("navigates to the previous chapter on a right swipe", () => {
    const { onNavigate } = setup();
    swipe(surface, [80, 400], [200, 400]);
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("does not navigate when released before the threshold", () => {
    const { onNavigate } = setup();
    swipe(surface, [300, 400], [260, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("ignores vertical scrolling and diagonal drags", () => {
    const { onNavigate, onDrag } = setup();
    swipe(surface, [200, 500], [190, 200]);
    swipe(surface, [300, 500], [180, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("ignores swipes from the screen edge and from buttons", () => {
    const { onNavigate } = setup();
    swipe(surface, [8, 400], [200, 400]);
    swipe(surface.querySelector("button"), [300, 400], [150, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does nothing at the first or last chapter", () => {
    const { onNavigate, onDrag, onDragStart } = setup({ canNavigate: direction => direction > 0 });
    swipe(surface, [80, 400], [250, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("flips on a short but fast flick, and not on the same distance dragged slowly", () => {
    let clock = 0;
    const { onNavigate } = setup({ now: () => clock });
    const flick = stepMs => {
      touch("touchstart", surface, [[300, 400]]);
      [285, 270, 255].forEach(x => { clock += stepMs; touch("touchmove", surface, [[x, 400]]); });
      touch("touchend", surface, []);
    };
    flick(20);   // 30px in 40ms ≈ 0.75 px/ms
    expect(onNavigate).toHaveBeenCalledWith(1);
    onNavigate.mockClear();
    flick(200);  // 30px in 400ms ≈ 0.08 px/ms
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("reports drag start / end so the page can follow the finger, and cancels when dragged back", () => {
    const onDragEnd = vi.fn();
    setup({ onDragEnd });
    touch("touchstart", surface, [[300, 400]]);
    touch("touchmove", surface, [[200, 400]]);
    touch("touchmove", surface, [[290, 400]]);
    touch("touchend", surface, []);
    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ direction: 1, commit: false }));
    onDragEnd.mockClear();
    swipe(surface, [300, 400], [150, 400]);
    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ direction: 1, commit: true }));
  });

  it("hands a drag that crosses back over the start to the other direction", () => {
    const onDragEnd = vi.fn();
    const { onDragStart } = setup({ onDragEnd });
    touch("touchstart", surface, [[200, 400]]);
    touch("touchmove", surface, [[150, 400]]);
    touch("touchmove", surface, [[300, 400]]);
    touch("touchend", surface, []);
    expect(onDragStart.mock.calls.map(call => call[0])).toEqual([1, -1]);
    expect(onDragEnd).toHaveBeenNthCalledWith(1, expect.objectContaining({ direction: 1, commit: false, immediate: true }));
    expect(onDragEnd).toHaveBeenLastCalledWith(expect.objectContaining({ direction: -1, commit: true }));
  });

  it("does nothing while disabled (dialogs open, another tab)", () => {
    const { onNavigate } = setup({ isEnabled: () => false });
    swipe(surface, [300, 400], [150, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("cancels on multi-touch (pinch zoom)", () => {
    const { onNavigate } = setup();
    touch("touchstart", surface, [[300, 400]]);
    touch("touchmove", surface, [[200, 400], [100, 400]]);
    touch("touchend", surface, []);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not navigate while adjusting a long-press text selection", () => {
    const { onNavigate } = setup({
      win: { innerWidth: 375, getSelection: () => ({ isCollapsed: false, toString: () => "起初" }) }
    });
    swipe(surface, [300, 400], [150, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("reader wiring (#314, #347)", () => {
  it("routes swipes through the page flip, and buttons, keys and chapter-end links through the same flip", () => {
    expect(bible).toContain("initReaderChapterGestures();");
    expect(bible).toMatch(/onDragStart: direction => \{[\s\S]{0,250}getReaderPageFlip\(\)\?\.begin\(direction\);/);
    expect(bible).toContain("flip.release({ direction, commit, velocity, immediate })");
    expect(bible).toContain("onCommit: direction => navigateToChapter(direction)");
    expect(bible).toMatch(/readerArrowKeyDirection\(event\)[\s\S]{0,200}flipToReaderChapter\(direction\)/);
    expect(bible).toMatch(/const bindFloatingButton[\s\S]{0,300}flipToReaderChapter\(direction\)/);
    expect(bible).toMatch(/\[data-chapter-nav\][\s\S]{0,300}flipToReaderChapter\(Number\(navButton\.dataset\.chapterNav\)\)/);
  });

  it("locks vertical scrolling during a flip, restores it on cancel and starts the new chapter at the top (#380)", () => {
    expect(bible).toMatch(/onDragStart: direction => \{[\s\S]{0,400}lockReaderScrollForFlip\(\);/);
    expect(bible).toContain('surface?.classList.add("reader-flip-scroll-locked");');
    expect(bible).toMatch(/const startScrollTop = unlockReaderScrollForFlip\(\);[\s\S]{0,300}surface\.scrollTop = startScrollTop;/);
    expect(bible).toContain('if (commit) Promise.resolve(done).then(moved => { if (moved !== false) setReaderScrollTop(0, "auto"); });');
    expect(css).toMatch(/\.reader-reading-surface\.reader-flip-scroll-locked,[\s\S]{0,80}overflow-y: hidden !important;/);
    expect(css).toMatch(/\.reader-flip-mover\.is-prev \{\s*transform-origin: right center;/);
  });

  it("prefetches both the next and the previous chapter", () => {
    expect(bible).toMatch(/function triggerPredictivePrefetch\(\)[\s\S]{0,300}\[1, -1\]\.forEach/);
  });

  it("repeats the swipe tip (max 3 times, once per session) until the member has swiped once", () => {
    expect(bible).toContain('READER_SWIPE_TIP_STORAGE_KEY = "bible_reader_swipe_tip_seen"');
    expect(bible).toContain('READER_SWIPED_STORAGE_KEY = "bible_reader_swiped"');
    expect(bible).toContain("READER_SWIPE_TIP_MAX_SHOWS = 3");
    expect(bible).toMatch(/function maybeShowReaderSwipeTip\(\)[\s\S]*?try \{[\s\S]*?localStorage\.getItem\(READER_SWIPED_STORAGE_KEY\)/);
    expect(bible).toMatch(/if \(commit\) \{\s*markReaderSwiped\(\);/);
  });

  it("drops the old edge hint, keeps reader chrome out of swipe handling, hides floating buttons on touch", () => {
    expect(html).not.toContain('id="reader-swipe-hint"');
    expect(css).not.toContain(".reader-swipe-hint");
    expect(html).toMatch(/id="reader-top-navbar" data-swipe-ignore/);
    expect(html).toMatch(/id="selection-bottom-bar-root" data-swipe-ignore/);
    expect(css).toMatch(/@media \(hover: none\) and \(pointer: coarse\) \{\s*#reader-view \.reader-floating-nav \{\s*display: none !important;/);
    expect(html).toContain('id="reader-chapter-announcer"');
  });

  it("puts a 上一章｜下一章 link row at the chapter end, hiding the side that does not exist", () => {
    expect(bible).toContain("function buildChapterEndNav(bookId, chapter)");
    // 與 /read 共用 js/modules/reader-verse-dom.mjs（#423）
    expect(bible).toContain("return buildSharedChapterEndNav({");
    expect(bible).toContain("container.appendChild(buildChapterEndNav(bookId, chapter));");
    const doc = document;
    const labels = nav => [...nav.querySelectorAll("[data-chapter-nav]")].map(b => `${b.dataset.chapterNav}:${b.textContent}:${b.hidden}`);
    expect(labels(buildChapterEndNav({ doc, books: BOOKS, bookId: 1, chapter: 1 }))).toEqual(["-1:上一章:true", "1:下一章:false"]);
    const middle = buildChapterEndNav({ doc, books: BOOKS, bookId: 1, chapter: 50 });
    expect(labels(middle)).toEqual(["-1:上一章:false", "1:下一章:false"]);
    expect(middle.querySelector(".reader-chapter-end-sep").hidden).toBe(false);
    expect(css).toMatch(/\.reader-chapter-end-link \{[^}]*min-height: 44px;/);
  });
});
