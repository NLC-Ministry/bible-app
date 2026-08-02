import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const plan = readFileSync("js/modules/plan.js", "utf8");
const bible = readFileSync("js/modules/bible.js", "utf8");
const css = readFileSync("index.css", "utf8");

describe("plan inline reader auto-read integration", () => {
  it("binds the one-second dwell controller to the actual plan scroll surface", () => {
    expect(plan).toContain('import { createReaderBottomDwellController, observeReaderEndSentinel }');
    expect(plan).toContain('const scrollSurface = document.querySelector(".main-content")');
    expect(plan).toContain("dwellMs: 1000");
    expect(plan).toContain("initInlineReaderBottomDwell()");
    expect(plan).toContain("scheduleInlineReaderBottomDwellCheck()");
    expect(plan).toContain('id = "plan-inline-reader-end-sentinel"');
    expect(plan).toContain("observeReaderEndSentinel");
    expect(plan).toContain('addEventListener("scrollend", handleInlineReaderScroll');
    expect(plan).not.toContain("window.scrollTo({ top: 0");
  });

  it("persists the correct round, notifies once, and skips chapters already marked read", () => {
    expect(plan).toContain("isInlineReaderTaskRead(task)");
    expect(plan).toContain("state.inlineReader.autoMarked");
    expect(plan).toContain("state.inlineReader.autoMarkInFlight");
    expect(plan).toContain("await db.logChapterRead(task.chapter.book, task.chapter.chapter, true, task.round, task.plan)");
    expect(plan).toContain('console.info("[AutoRead] Inline reading log persisted"');
    expect(plan).not.toContain("自動已讀測試");
    expect(plan).toMatch(/await window\.closePlanInlineReader\(\);[\s\S]*await handleRoundCompletion/);
    expect(bible).toContain("true, taskContext.round, taskContext.plan");
    expect(bible).toContain("taskContext.chapter[readKey] = true");
  });

  it("hides support and global navigation while retaining inline chapter controls", () => {
    expect(plan).toContain('document.body.classList.add("plan-inline-reader-open")');
    expect(css).toContain("body.plan-inline-reader-open .issue-report-fab");
    expect(css).toContain("body.plan-inline-reader-open .mobile-nav-bar");
    expect(css).not.toContain("body.plan-inline-reader-open .plan-inline-footer");
  });
});
