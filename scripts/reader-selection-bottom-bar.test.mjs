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
    expect(html).toMatch(/js\/app\.js\?v=2026\d{4}_/);
  });

  it("keeps the redesigned selection toolbar compact and scrollable on narrow screens", () => {
    const highlightSectionRule = css.match(/\.youversion-action-bar \.yv-highlight-section \{([\s\S]*?)\}/)?.[1] || "";
    const actionGroupRule = css.match(/\.youversion-action-bar \.yv-action-group \{([\s\S]*?)\}/)?.[1] || "";
    expect(bible).toContain('data-icon="share"');
    expect(bible).toContain("hydrateIcons(barDiv)");
    expect(css).toMatch(/\.youversion-action-bar \.yv-content-row \{[\s\S]*flex-direction: row;[\s\S]*overflow-x: auto;[\s\S]*scrollbar-width: none;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-content-row::-webkit-scrollbar \{[\s\S]*display: none;/);
    expect(highlightSectionRule).toContain("min-width: max-content;");
    expect(actionGroupRule).toContain("display: flex;");
    expect(actionGroupRule).toContain("flex: 0 0 auto;");
    expect(highlightSectionRule).not.toContain("flex-direction: column;");
    expect(css).not.toMatch(/\.youversion-action-bar[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });

  it("shows the four primary actions in order and reveals highlight tools on demand", () => {
    const start = bible.indexOf("function openIntegratedSelectionBottomBar(options)");
    const end = bible.indexOf("function openVerseNoteEditor", start);
    const toolbar = bible.slice(start, end);
    const copyIndex = toolbar.indexOf('data-action="copy"');
    const highlightIndex = toolbar.indexOf('data-action="toggle-highlight"');
    const noteIndex = toolbar.indexOf('data-action="note"');
    const shareIndex = toolbar.indexOf('data-action="share"');

    expect(copyIndex).toBeGreaterThan(-1);
    expect(highlightIndex).toBeGreaterThan(copyIndex);
    expect(noteIndex).toBeGreaterThan(highlightIndex);
    expect(shareIndex).toBeGreaterThan(noteIndex);
    expect(toolbar).toContain('class="yv-highlight-section yv-highlight-popover hidden" data-highlight-palette');
    expect(toolbar).toContain('aria-expanded="false"');
    expect(toolbar).toContain("setHighlightPaletteOpen(Boolean(shouldOpen))");
    expect(toolbar).toContain('const shouldOpen = highlightPalette?.classList.contains("hidden")');
    expect(toolbar).toMatch(/highlightToggle\?\.addEventListener\("click"[\s\S]*setHighlightPaletteOpen\(Boolean\(shouldOpen\)\)/);
    expect(toolbar).toContain('highlightPalette.style.setProperty("--yv-highlight-anchor-x"');
    expect(css).toMatch(/\.youversion-action-bar \.yv-highlight-popover \{[\s\S]*position: absolute;[\s\S]*bottom: calc\(100% \+ 0\.625rem\);/);
    expect(toolbar).toContain('data-action="clear"');
    expect(toolbar).toContain('data-icon="noColor"');
    expect(toolbar).toContain('aria-label="取消螢光標註"');
    expect(toolbar).not.toContain('data-icon="eraser"');
    expect(toolbar.indexOf('data-action="clear"')).toBeLessThan(toolbar.indexOf('data-color="#fef08a"'));
    expect(toolbar).toContain('data-color="#fecdd3"');
    expect(toolbar).toContain('data-color="#ddd6fe"');
    expect(toolbar).toContain('data-custom-highlight-color');
    expect(toolbar).toContain("applyHighlightColor(e.target.value)");
    expect(toolbar).toContain('verseDiv.style.setProperty("--verse-highlight-color"');
    expect(css).toContain("var(--verse-highlight-color, #fef08a)");
    expect(toolbar).not.toContain('data-action="play"');
    expect(toolbar).not.toContain('<span class="yv-tile-label">朗讀</span>');
  });

  it("keeps the selection tools compact and closes them from the surrounding reading area", () => {
    const start = bible.indexOf("function openIntegratedSelectionBottomBar(options)");
    const end = bible.indexOf("function openVerseNoteEditor", start);
    const toolbar = bible.slice(start, end);
    expect(toolbar).not.toContain('data-action="close"');
    expect(toolbar).not.toContain('data-action="close-highlight-palette"');
    expect(toolbar).not.toContain('class="yv-popover-header"');
    expect(toolbar).toContain('document.addEventListener("click", onDocClick)');
    expect(toolbar).toContain("setHighlightPaletteOpen(false)");
  });

  it("puts a round icon-only cancel control first in multi-selection actions", () => {
    const start = bible.indexOf("function openMultiSelectBottomBar()");
    const end = bible.indexOf("function startMultiSelection", start);
    const toolbar = bible.slice(start, end);
    const cancelIndex = toolbar.indexOf('class="yv-multi-cancel-button" data-action="ms-cancel"');
    const copyIndex = toolbar.indexOf('data-action="ms-copy"');
    const shareIndex = toolbar.indexOf('data-action="ms-share"');
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeLessThan(copyIndex);
    expect(copyIndex).toBeLessThan(shareIndex);
    expect(toolbar).toContain('aria-label="取消多節選取"');
    expect(toolbar).not.toContain('<span class="yv-tile-label">取消</span>');
    expect(css).toMatch(/\.youversion-action-bar \.yv-multi-cancel-button \{[\s\S]*border-radius: 50%;/);
  });
});
