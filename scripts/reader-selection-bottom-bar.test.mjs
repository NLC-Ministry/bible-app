import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

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
    expect(html).toContain("js/app.js?v=20260803_reader_audio_fix");
  });

  it("keeps the redesigned selection toolbar compact and scrollable on narrow screens", () => {
    expect(bible).toContain('data-icon="close"');
    expect(bible).toContain("hydrateIcons(barDiv)");
    expect(css).toMatch(/\.youversion-action-bar \.yv-content-row \{[\s\S]*flex-direction: row;[\s\S]*overflow-x: auto;[\s\S]*scrollbar-width: none;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-content-row::-webkit-scrollbar \{[\s\S]*display: none;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-highlight-section \{[\s\S]*min-width: max-content;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-action-group \{[\s\S]*display: flex;[\s\S]*flex: 0 0 auto;/);
    expect(css).not.toMatch(/\.youversion-action-bar \.yv-highlight-section \{[\s\S]*flex-direction: column;/);
    expect(css).not.toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
  });
});
