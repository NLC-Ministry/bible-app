import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeBibleSearchText, rankBibleSearchResults } from "../js/modules/bible-search-ranker.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");

const corpus = [
  { book: 43, chapter: 3, verse: 16, text: "神愛世人，甚至將他的獨生子賜給他們。" },
  { book: 62, chapter: 4, verse: 8, text: "沒有愛心的，就不認識神，因為神就是愛。" },
  { book: 45, chapter: 5, verse: 8, text: "惟有基督在我們還作罪人的時候為我們死。" }
];

describe("ranked fuzzy Bible search", () => {
  it("normalizes punctuation, spacing, width and case", () => {
    expect(normalizeBibleSearchText(" Ｇｏｄ， 愛！ ")).toBe("god愛");
  });

  it("places exact phrase matches before fuzzy matches", () => {
    const results = rankBibleSearchResults(corpus, "神愛世人");
    expect(results[0]).toMatchObject({ book: 43, chapter: 3, verse: 16 });
  });

  it("finds a close result with one typo but avoids fuzzy matching very short input", () => {
    expect(rankBibleSearchResults(corpus, "神愛世仁")[0]).toMatchObject({ verse: 16 });
    expect(rankBibleSearchResults(corpus, "神仁")).toEqual([]);
  });

  it("caps results and keeps one debounced network request path", () => {
    expect(rankBibleSearchResults(Array(200).fill(corpus[0]), "神愛", { limit: 12 })).toHaveLength(12);
    expect(bible).toContain('setTimeout(async () =>');
    expect(bible).toContain('}, 400)');
    expect(bible).toContain('window.__BIBLE_SEARCH_REQUEST_CACHE');
    expect(bible).toContain('rankBibleSearchResults(mapped, query, { includeFuzzy: true, limit: 120 })');
  });
});
