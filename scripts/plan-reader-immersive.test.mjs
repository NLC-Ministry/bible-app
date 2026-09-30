import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { observeReaderEndSentinel } from "../js/modules/reader-end-sentinel.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const css = readFileSync("index.css", "utf8");

describe("immersive plan reader", () => {
  it("hides the issue-report FAB and bottom bars while keeping chapter navigation smart", () => {
    expect(css).toContain("body.reader-page .issue-report-fab");
    expect(css).not.toContain("body.reader-page #reader-view .reader-floating-nav,");
    expect(bible).toContain("initSmartFloatingReaderNav()");
    expect(css).toContain("body.reader-page .mobile-nav-bar");
    expect(css).toContain("#reader-view .reader-bottom-action-bar");
    expect(css).toMatch(/reader-bottom-action-bar[\s\S]*?display: none !important/);
  });

  it("observes a rendered end sentinel so mobile sticky chrome cannot hide the bottom", () => {
    const changes = [];
    const observed = [];
    class FakeIntersectionObserver {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
      }
      observe(target) { observed.push(target); }
      disconnect() {}
    }
    const root = { id: "reader-surface" };
    const sentinel = { id: "reader-end" };
    const binding = observeReaderEndSentinel({
      root,
      sentinel,
      onChange: value => changes.push(value),
      Observer: FakeIntersectionObserver
    });

    expect(observed).toEqual([sentinel]);
    expect(binding.observer.options.root).toBe(root);
    binding.observer.callback([{ target: sentinel, isIntersecting: true }]);
    binding.observer.callback([{ target: sentinel, isIntersecting: false }]);
    expect(changes).toEqual([true, false]);
  });

  it("is a no-op without IntersectionObserver or a sentinel", () => {
    expect(observeReaderEndSentinel({ sentinel: null, Observer: class {} }).observer).toBeNull();
    expect(observeReaderEndSentinel({ sentinel: {}, Observer: undefined }).observer).toBeNull();
  });

  // #357 決定 1B：章末只提醒，沒有 1 秒停留自動打卡了。
  it("keeps the plan identity; the chapter end only reminds, the dwell auto check-off is gone", () => {
    expect(bible).toContain("state.readerState?.planContextId");
    expect(bible).toContain("window.findPlanByContextId");
    expect(bible).toContain('id = "reader-end-sentinel"');
    expect(bible).toContain("observeReaderEndSentinel");
    expect(bible).toContain("const root = getReaderScrollSurface()");
    expect(bible).toContain("readerChapterComplete.pulse()");
    expect(bible).not.toContain("createReaderBottomDwellController");
    expect(bible).not.toContain("dwellMs");
    expect(bible).not.toContain("updatePlanCheckboxState(");
    expect(bible).toContain('typeof window.handleRoundCompletion === "function"');
    expect(existsSync("js/modules/reader-bottom-dwell.mjs")).toBe(false);
  });
});
