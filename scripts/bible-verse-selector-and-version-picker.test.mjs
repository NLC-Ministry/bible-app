import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const bibleData = read("js/data/bible_data.js");
const verseCountsSrc = read("js/data/bible_verse_counts.js");
const bible = read("js/modules/bible.js");
const state = read("js/state.js");
const html = read("index.html");
const css = read("index.css");

describe("bible book English-name keys line up between bible_data.js and bible_verse_counts.js", () => {
  const bookEngs = [...bibleData.matchAll(/eng:\s*"([^"]+)"/g)].map(m => m[1]);
  const countsObjSrc = verseCountsSrc.match(/const BIBLE_VERSE_COUNTS = (\{.*\});/s)[1];
  const counts = JSON.parse(countsObjSrc);
  const countKeys = new Set(Object.keys(counts));

  it("has a BIBLE_VERSE_COUNTS entry for every book, keyed by the exact book.eng name", () => {
    // A single mismatched key (e.g. "Psalm" vs "Psalms") makes every lookup
    // for that book silently miss and fall back to a hardcoded default of
    // 30 verses — Psalm 23 (6 verses) showed 30 options in the verse picker
    // because of exactly this bug.
    const missing = bookEngs.filter(eng => !countKeys.has(eng));
    expect(missing).toEqual([]);
  });

  it("keeps 詩篇/Psalms' verse counts correct, in particular the short Psalm 23 (6 verses)", () => {
    expect(verseCountsSrc).toContain('"Psalms":[');
    expect(verseCountsSrc).not.toMatch(/"Psalm":\[/);
    const psalmCounts = counts["Psalms"];
    expect(psalmCounts).toBeTruthy();
    expect(psalmCounts.length).toBe(150);
    expect(psalmCounts[22]).toBe(6); // chapter 23, 0-indexed
    expect(psalmCounts[118]).toBe(176); // chapter 119, the longest psalm
  });

  it("falls back to 30 verses only when a book/chapter genuinely has no data, not due to a key typo", () => {
    expect(bible).toContain('BIBLE_VERSE_COUNTS[book.eng]');
    expect(bible).toContain("let totalVerses = 30;");
  });
});

describe("mobile Bible version picker access", () => {
  it("hides the top navbar's redundant version pill only on narrow screens", () => {
    expect(css).toMatch(/@media \(max-width: 420px\) \{\s*\n\s*\.reader-version-btn \{\s*\n\s*display: none;/);
  });

  it("wires the directory overlay's version badge as the mobile replacement entry point into the picker modal", () => {
    // Previously #bible-nav-version-badge had no click handler at all, so on
    // phones (where .reader-version-btn is display:none) there was no way
    // left to open #bible-version-picker-modal.
    expect(bible).toContain('document.getElementById("bible-nav-version-badge")');
    expect(bible).toContain('versionBadge.addEventListener("click"');
    expect(bible).toContain("window.openBibleVersionPicker();");
    expect(html).toContain('id="bible-nav-version-badge"');
  });

  it("keeps the directory overlay's version badge label in sync with the active version", () => {
    expect(bible).toMatch(/document\.getElementById\("bible-nav-version-badge"\)[\s\S]{0,40}if \(navBadge\) navBadge\.textContent = label;/);
    expect(state).toContain('document.getElementById("bible-nav-version-badge")');
  });
});
