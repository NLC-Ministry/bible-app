// #704：和合本（CUV）從 bolls 抓，bolls 用 "a" 表示併節，要顯示成「併於上節」，跟修訂版一致。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bibleDataSource = readFileSync("js/data/bible_data.js", "utf8");
const verseCountsSource = readFileSync("js/data/bible_verse_counts.js", "utf8");

function loadBibleData(fakeFetch) {
  const context = { console: { ...console, warn: () => {} }, fetch: fakeFetch, URLSearchParams, URL, AbortSignal };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(verseCountsSource, context);
  vm.runInContext(bibleDataSource, context);
  return context.window;
}

function jsonResponse(body) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

// bolls get-chapter/CUV/4/1/ 的形狀；第 21 節是併節。
const NUMBERS_1_BOLLS = Array.from({ length: 54 }, (_, index) => ({
  pk: index + 1,
  verse: index + 1,
  text: index === 20 ? "a" : `第${index + 1}節經文`
}));

describe("和合本併節 (#704)", () => {
  it("bolls 的 CUV 併節 \"a\" 顯示成「併於上節」", async () => {
    const urls = [];
    const window = loadBibleData(async url => {
      urls.push(String(url));
      return jsonResponse(NUMBERS_1_BOLLS);
    });
    const chapter = await window.fetchBibleChapter("Numbers", 1, "CUV");
    expect(urls[0]).toContain("bolls.life/get-chapter/CUV/4/1/");
    expect(chapter.verses).toHaveLength(54);
    expect(chapter.verses[20]).toEqual({ verse: 21, text: "併於上節" });
    expect(chapter.verses[19].text).toBe("第20節經文");
  });

  it("前後有空白的 \"a\" 也算併節；一般經文不受影響", async () => {
    const window = loadBibleData(async () => jsonResponse(
      NUMBERS_1_BOLLS.map(v => (v.verse === 23 ? { ...v, text: " a " } : v))
    ));
    const chapter = await window.fetchBibleChapter("Numbers", 1, "CUV");
    expect(chapter.verses[22].text).toBe("併於上節");
    expect(chapter.verses[0].text).toBe("第1節經文");
  });

  it("修訂版（信望愛）的併節仍是「併於上節」", () => {
    const window = loadBibleData(async () => jsonResponse({}));
    expect(window.cleanFhlChapterText("a")).toBe("併於上節");
  });
});
