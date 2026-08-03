import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const html = readFileSync("index.html", "utf8");

describe("reader verse selection bottom bar", () => {
  it("keeps one active bottom bar tied to the selected verse", () => {
    expect(bible).toContain("let selectionBottomBarCleanup = null;");
    expect(bible).toContain("let selectionBottomBarBindTimer = null;");
    expect(bible).toContain("function closeSelectionBottomBar({ clearSelection = true } = {})");
    expect(bible).toContain("const isSelected = setReaderStartSelection(verseDiv);");
    expect(bible).toContain("if (!isSelected) {");
    expect(bible).toContain("closeSelectionBottomBar({ clearSelection: false });");
    expect(bible).toContain("clearTimeout(selectionBottomBarBindTimer)");
  });

  it("does not let collapsed browser text-selection events hide the bar", () => {
    expect(bible).not.toContain("selectionchange");
    expect(bible).not.toContain("setReaderStartSelection(null)");
  });

  it("closes stale selection UI when the reader reloads a chapter", () => {
    const resetIndex = bible.indexOf("state.readerState.selectedVerseNum = null;");
    const closeIndex = bible.indexOf("closeSelectionBottomBar();", resetIndex);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(resetIndex);
  });

  it("bumps the app shell so mobile PWAs fetch the fixed reader module", () => {
    expect(html).toContain("js/app.js?v=20260803_reader_selection_bar");
  });
});