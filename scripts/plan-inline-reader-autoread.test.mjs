// 計畫內嵌閱讀器（#357）：章末用共用的「完成本章」按鈕；讀到底、換章都不寫入。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const plan = readFileSync("js/modules/plan.js", "utf8");
const css = readFileSync("index.css", "utf8");

const between = (source, start, end) => {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
};

describe("plan inline reader chapter-complete integration", () => {
  it("renders the shared button before the end sentinel and only pulses at the end", () => {
    expect(plan).toContain('import { observeReaderEndSentinel } from "./reader-end-sentinel.mjs"');
    expect(plan).toContain('import { createChapterCompleteController } from "./chapter-complete-button.mjs"');
    const render = between(plan, "async function renderInlineScriptureText", "window.navigateInlineChapter");
    const button = render.indexOf('inlineChapterComplete.createElement("plan-inline-chapter-complete")');
    expect(button).toBeGreaterThan(-1);
    expect(button).toBeLessThan(render.indexOf('id = "plan-inline-reader-end-sentinel"'));
    const observer = between(plan, "function bindInlineReaderEndObserver", "window.openPlanInlineReader");
    expect(observer).toContain("inlineChapterComplete.pulse()");
    expect(observer).not.toContain("logChapterRead");
    expect(plan).not.toContain("window.scrollTo({ top: 0");
  });

  it("has no automatic write path left (dwell, leaving the chapter)", () => {
    expect(plan).not.toContain("createReaderBottomDwellController");
    expect(plan).not.toContain("autoMarkInlineReaderTaskRead");
    expect(plan).not.toContain("inlineReaderReachedEndKey");
    expect(plan).not.toContain("state.inlineReader.autoMarked");
    const nav = between(plan, "window.navigateInlineChapter", "// ====");
    expect(nav).not.toContain("logChapterRead");
  });

  it("closes the reader and runs the round-completion flow after the last chapter is completed", () => {
    const submit = between(plan, "async function submitInlineReaderChapterCheckIn", "const inlineChapterComplete");
    expect(submit).toContain("submitChapterCheckIn(task, willCheck");
    expect(submit).toMatch(/await window\.closePlanInlineReader\(\);[\s\S]*await handleRoundCompletion/);
  });

  it("hides support and global navigation while retaining inline chapter controls", () => {
    expect(plan).toContain('document.body.classList.add("plan-inline-reader-open")');
    expect(css).toContain("body.plan-inline-reader-open .issue-report-fab");
    expect(css).toContain("body.plan-inline-reader-open .mobile-nav-bar");
    expect(css).not.toContain("body.plan-inline-reader-open .plan-inline-footer");
  });
});
