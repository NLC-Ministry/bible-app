// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createReaderSwipeController,
  getSwipeCommitDistance,
  isInSwipeEdgeGuard,
  readerArrowKeyDirection,
  resolveAdjacentChapter,
  resolveSwipeAxis,
  swipeDirectionFromDelta
} from "../js/modules/reader-chapter-nav.mjs";

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
    const onHint = vi.fn();
    controller = createReaderSwipeController({
      surface,
      onNavigate,
      onHint,
      win: { innerWidth: 375, getSelection: () => null },
      ...overrides
    });
    return { onNavigate, onHint };
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
    const { onNavigate, onHint } = setup();
    swipe(surface.querySelector(".bible-verse"), [300, 400], [180, 405]);
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(onHint).toHaveBeenCalledWith(1, expect.objectContaining({ armed: true }));
    expect(onHint).toHaveBeenLastCalledWith(0, expect.objectContaining({ armed: false }));
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
    const { onNavigate, onHint } = setup();
    swipe(surface, [200, 500], [190, 200]);
    swipe(surface, [300, 500], [180, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onHint).not.toHaveBeenCalled();
  });

  it("ignores swipes from the screen edge and from buttons", () => {
    const { onNavigate } = setup();
    swipe(surface, [8, 400], [200, 400]);
    swipe(surface.querySelector("button"), [300, 400], [150, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does nothing at the first or last chapter", () => {
    const { onNavigate, onHint } = setup({ canNavigate: direction => direction > 0 });
    swipe(surface, [80, 400], [250, 400]);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onHint).not.toHaveBeenCalledWith(-1, expect.anything());
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

describe("reader wiring (#314)", () => {
  it("routes swipes and arrow keys through navigateToChapter", () => {
    expect(bible).toContain("initReaderChapterGestures();");
    expect(bible).toMatch(/onNavigate: direction => \{ navigateToChapter\(direction\); \}/);
    expect(bible).toMatch(/readerArrowKeyDirection\(event\)[\s\S]{0,200}navigateToChapter\(direction\)/);
  });

  it("prefetches both the next and the previous chapter", () => {
    expect(bible).toMatch(/function triggerPredictivePrefetch\(\)[\s\S]{0,300}\[1, -1\]\.forEach/);
  });

  it("shows the one-time swipe tip with guarded storage access", () => {
    expect(bible).toContain('READER_SWIPE_TIP_STORAGE_KEY = "bible_reader_swipe_tip_seen"');
    expect(bible).toMatch(/function maybeShowReaderSwipeTip\(\)[\s\S]*?try \{[\s\S]*?localStorage\.getItem/);
  });

  it("renders the edge hint and keeps the reader chrome out of swipe handling", () => {
    expect(html).toContain('id="reader-swipe-hint"');
    expect(html).toMatch(/id="reader-top-navbar" data-swipe-ignore/);
    expect(html).toMatch(/id="selection-bottom-bar-root" data-swipe-ignore/);
    expect(css).toContain('.reader-swipe-hint[data-direction="next"][data-armed]');
  });
});
