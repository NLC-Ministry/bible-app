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

  it("recognizes only the actual bottom of the reading surface", () => {
    expect(isReaderSurfaceAtBottom(surface())).toBe(true);
    expect(isReaderSurfaceAtBottom(surface({ scrollTop: 480 }))).toBe(false);
  });

  it("waits one full second at the bottom before completing", () => {
    const onComplete = vi.fn();
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });
    controller.handleScroll(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(999);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("day-1-genesis-1");
  });

  it("cancels completion when the reader leaves the bottom before one second", () => {
    const onComplete = vi.fn();
    const controller = createReaderBottomDwellController({ dwellMs: 1000, onComplete });
    controller.handleScroll(surface(), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(500);
    controller.handleScroll(surface({ scrollTop: 450 }), { eligible: true, targetKey: "day-1-genesis-1" });
    vi.advanceTimersByTime(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("auto-marks only a matching unread chapter opened from a plan", () => {
    expect(bible).toContain("state.readerState.fromPlan");
    expect(bible).toContain("getCurrentPlanReaderTask()");
    expect(bible).toContain("!isCurrentPlanReaderTaskRead(taskContext)");
    expect(bible).toContain("dwellMs: 1000");
    expect(bible).toContain('showToast("已自動記錄為已讀")');
  });
});
