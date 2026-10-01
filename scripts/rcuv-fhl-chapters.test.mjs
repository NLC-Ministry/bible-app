import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bibleDataSource = readFileSync("js/data/bible_data.js", "utf8");
const verseCountsSource = readFileSync("js/data/bible_verse_counts.js", "utf8");

// 每個測試一個乾淨的沙盒，fetch 換成假的，避免碰到真網路與共用的章節快取。
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

const JOHN_3_RECORDS = Array.from({ length: 36 }, (_, index) => ({
  chineses: "約",
  chap: 3,
  sec: index + 1,
  bible_text: index === 15
    ? "「上帝愛世人，甚至將他獨一的兒子( [ 3.16] 「他獨一的兒子」或譯「他的獨生子」；18節同。)賜給他們，叫一切信他的人不致滅亡，反得永生。"
    : `第${index + 1}節經文`
}));

describe("cleanFhlChapterText (#379)", () => {
  const { cleanFhlChapterText } = loadBibleData(async () => jsonResponse({}));

  it("drops footnotes in both spacing styles", () => {
    expect(cleanFhlChapterText("人若不重生( [ 3.3] 「重生」或譯「從上面而生」。)，就不能見上帝的國。")).toBe(
      "人若不重生，就不能見上帝的國。"
    );
    expect(cleanFhlChapterText("經文([1.2]或譯「甲」。)後面")).toBe("經文後面");
    expect(cleanFhlChapterText("經文( [ 3.16] 註（含全形括號）說明)後面")).toBe("經文後面");
  });

  it("drops section headings, keeps underlined names, removes poetry line breaks", () => {
    expect(cleanFhlChapterText("<h2>耶穌和尼哥德慕談重生</h2> 有一個法利賽人，名叫<u>尼哥德慕</u>，是<u>猶太</u>人的官。")).toBe(
      "有一個法利賽人，名叫尼哥德慕，是猶太人的官。"
    );
    expect(cleanFhlChapterText("大衛的詩。</b><br/><h2>耶和華是我牧者<br/></h2>耶和華是我的牧者，<br/>我必不致缺乏。<br/>")).toBe(
      "大衛的詩。耶和華是我的牧者，我必不致缺乏。"
    );
  });

  it("shows merged verses as 併於上節 and keeps textual-variant verses", () => {
    expect(cleanFhlChapterText("a")).toBe("併於上節");
    expect(cleanFhlChapterText("(有古卷在此加「保羅說了這些話，猶太人議論紛紛地走了。」)")).toBe(
      "(有古卷在此加「保羅說了這些話，猶太人議論紛紛地走了。」)"
    );
  });
});

describe("fetchBibleChapter for 和合本修訂版 (#379)", () => {
  it("loads RCUVTS chapters from 信望愛 qb.php instead of bolls.life", async () => {
    const urls = [];
    const window = loadBibleData(async url => {
      urls.push(String(url));
      return jsonResponse({ status: "success", record: JOHN_3_RECORDS });
    });
    const chapter = await window.fetchBibleChapter("John", 3, "RCUVTS");

    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe("https://bible.fhl.net/json/qb.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({ chineses: "約", chap: "3", version: "rcuv", gb: "0" });
    expect(chapter.isPlaceholder).toBeUndefined();
    expect(chapter.translation).toBe("RCUVTS");
    expect(chapter.verses).toHaveLength(36);
    expect(chapter.verses[15].text).toBe("「上帝愛世人，甚至將他獨一的兒子賜給他們，叫一切信他的人不致滅亡，反得永生。");
  });

  it("never shows the built-in 新標點和合本 fallback as 修訂版 when 信望愛 fails", async () => {
    const window = loadBibleData(async () => { throw new Error("offline"); });
    const chapter = await window.fetchBibleChapter("Genesis", 1, "RCUVTS");
    expect(chapter.isPlaceholder).toBe(true);
    expect(chapter.verses.every(verse => verse.text === "（經文暫時未載入）")).toBe(true);
  });

  it("treats a failed 信望愛 status as a load failure", async () => {
    const window = loadBibleData(async () => jsonResponse({ status: "Fail: no record" }));
    const chapter = await window.fetchBibleChapter("John", 3, "RCUVTS");
    expect(chapter.isPlaceholder).toBe(true);
  });

  it("keeps the built-in fallback for 新標點和合本 unchanged", async () => {
    const window = loadBibleData(async () => { throw new Error("offline"); });
    const chapter = await window.fetchBibleChapter("Genesis", 1, "CUNP");
    expect(chapter.isPlaceholder).toBeUndefined();
    expect(chapter.verses[0].text).toContain("起初");
  });
});
