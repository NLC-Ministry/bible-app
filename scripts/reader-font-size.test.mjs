import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");
const bible = readFileSync("js/modules/bible.js", "utf8");
const state = readFileSync("js/state.js", "utf8");

describe("reader font size slider", () => {
  it("offers five accessible sizes from 16px through 24px", () => {
    expect(html).toContain('id="reader-font-size-slider"');
    expect(html).toMatch(/id="reader-font-size-slider"[\s\S]*min="16" max="24" step="2" value="20"/);
    for (const size of [16, 18, 20, 22, 24]) {
      expect(html).toContain(`data-reader-font-size="${size}"`);
    }
  });

  it("uses 20px by default and snaps old values to a supported size", () => {
    expect(css).toContain("--reader-font-size: 20px");
    expect(css).toContain("var(--reader-font-size, 20px)");
    expect(state).toContain("fontSize: 20");
    expect(state).toContain("const readerFontSizes = [16, 18, 20, 22, 24]");
    expect(bible).toContain("const READER_FONT_SIZES = [16, 18, 20, 22, 24]");
    expect(bible).toContain("normalizeReaderFontSize");
  });

  it("previews slider changes and synchronizes its visible value", () => {
    expect(bible).toContain('updateFontSizeDraftDisplay(readerFontSizeSlider.value)');
    expect(bible).toContain('function updateFontSizeDraftDisplay(value)');
    expect(bible).toContain('document.getElementById("reader-font-size-value")');
    expect(bible).toContain('slider.setAttribute("aria-valuetext", `${size}px`)');
    expect(css).toContain(".reader-font-size-tick.active");
  });

  it("applies the selected size directly on Android reader text nodes", () => {
    expect(bible).toContain('readerView.style.setProperty("--reader-font-size", size + "px")');
    expect(bible).toContain('bibleContent.style.setProperty("font-size", size + "px", "important")');
    expect(bible).toContain('querySelectorAll(".verse-text, .verse-num")');
    expect(bible).toContain('element.style.setProperty("font-size", size + "px", "important")');
    expect(css).toMatch(/#reader-view \.verse-text,[\s\S]*#reader-view \.verse-num \{[\s\S]*font-size: var\(--reader-font-size, 20px\) !important;/);
    expect(css).toContain("-webkit-text-size-adjust: 100%");
  });

  it("commits and saves the font size only from the explicit apply button", () => {
    const applyBlock = bible.slice(
      bible.indexOf('settingsApplyBtn.addEventListener("click"'),
      bible.indexOf('if (settingsBackdrop)')
    );
    const sliderBlock = bible.slice(
      bible.indexOf('const readerFontSizeSlider = document.getElementById'),
      bible.indexOf('document.querySelectorAll(".theme-option")')
    );
    expect(applyBlock).toContain('state.readerState.fontSize = normalizeReaderFontSize(slider.value)');
    expect(applyBlock).toContain('updateReaderFontSize()');
    expect(sliderBlock).not.toContain('state.readerState.fontSize =');
    expect(sliderBlock).not.toContain('updateReaderFontSize()');
  });
});
