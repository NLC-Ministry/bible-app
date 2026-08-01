import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createReaderBottomDwellController,
  isReaderSurfaceAtBottom
} from "../js/modules/reader-bottom-dwell.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const css = readFileSync("index.css", "utf8");

function surface({ scrollTop = 500, clientHeight = 500, scrollHeight = 1000 } = {}) {
  return { scrollTop, clientHeight, scrollHeight };
}

describe("immersive plan reader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hides the issue-report FAB and bottom bars while keeping chapter navigation smart", () => {
    expect(css).toContain("body.reader-page .issue-report-fab");
    expect(css).not.toContain("body.reader-page #reader-view .reader-floating-nav,");
    expect(bible).toContain("initSmartFloatingReaderNav()");
    expect(css).toContain("body.reader-page .mobile-nav-bar");
    expect(css).toContain("#reader-view .reader-bottom-action-bar");
    expect(css).toMatch(/reader-bottom-action-bar[\s\S]*?display: none !important/);
  });

  it("recognizes the actual bottom with a small layout-rounding tolerance", () => {
    expect(isReaderSurfaceAtBottom(surface())).toBe(true);
    expect(isReaderSurfaceAtBottom(surface({ scrollTop: 480 }))).toBe(true);
    expect(isReaderSurfaceAtBottom(surface({ scrollTop: 470 }))).toBe(false);
  });

  it("can check after async content rendering without requiring a scroll event", () => {
    const onComplete = vi.fn();
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });
    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(999);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("cancels completion when the reader leaves the bottom before one second", () => {
    const onComplete = vi.fn();
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });
    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(500);
    controller.check(surface({ scrollTop: 450 }), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("allows a retry when persistence reports failure", async () => {
    const onComplete = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });

    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    await vi.advanceTimersByTimeAsync(1000);
    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate a completion while its write is still in flight", async () => {
    let finishWrite;
    const onComplete = vi.fn(() => new Promise(resolve => { finishWrite = resolve; }));
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });

    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    await vi.advanceTimersByTimeAsync(1000);
    controller.check(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onComplete).toHaveBeenCalledOnce();

    finishWrite(true);
    await Promise.resolve();
  });

  it("keeps the plan identity and rechecks after the final scripture render", () => {
    expect(bible).toContain("state.readerState?.planContextId");
    expect(bible).toContain("window.findPlanByContextId");
    expect(bible).toContain("scheduleReaderBottomDwellCheck()");
    expect(bible).toContain('addEventListener("scrollend", handleReaderScroll');
    expect(bible).toContain("return false;");
    expect(bible).toContain("dwellMs: 1000");
  });
});
