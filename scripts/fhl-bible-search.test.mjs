import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  buildFhlSearchUrl,
  getFhlSearchVersion,
  isShortBibleQuery,
  mapFhlSearchRecords,
  readFhlSearchPayload,
  stripFhlMarkup
} from "../js/modules/fhl-bible-search.mjs";

const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${readFileSync("js/data/bible_data.js", "utf8")}\nwindow.__books = BIBLE_BOOKS;`, context);
const books = context.window.__books;

const bible = readFileSync("js/modules/bible.js", "utf8");
const sw = readFileSync("sw.js", "utf8");

// 信望愛 se.php 實際回傳的中文／英文縮寫（2026-10-01 實測 56 卷，其餘依信望愛縮寫表）。
const FHL_BOOKS = [
  ["創", "Gen"], ["出", "Ex"], ["利", "Lev"], ["民", "Num"], ["申", "Deut"], ["書", "Josh"], ["士", "Judg"],
  ["得", "Ruth"], ["撒上", "1 Sam"], ["撒下", "2 Sam"], ["王上", "1 Kin"], ["王下", "2 Kin"], ["代上", "1 Chr"],
  ["代下", "2 Chr"], ["拉", "Ezra"], ["尼", "Neh"], ["斯", "Esth"], ["伯", "Job"], ["詩", "Ps"], ["箴", "Prov"],
  ["傳", "Eccl"], ["歌", "Song"], ["賽", "Is"], ["耶", "Jer"], ["哀", "Lam"], ["結", "Ezek"], ["但", "Dan"],
  ["何", "Hos"], ["珥", "Joel"], ["摩", "Amos"], ["俄", "Obad"], ["拿", "Jon"], ["彌", "Mic"], ["鴻", "Nah"],
  ["哈", "Hab"], ["番", "Zeph"], ["該", "Hag"], ["亞", "Zech"], ["瑪", "Mal"], ["太", "Matt"], ["可", "Mark"],
  ["路", "Luke"], ["約", "John"], ["徒", "Acts"], ["羅", "Rom"], ["林前", "1 Cor"], ["林後", "2 Cor"], ["加", "Gal"],
  ["弗", "Eph"], ["腓", "Phil"], ["西", "Col"], ["帖前", "1 Thess"], ["帖後", "2 Thess"], ["提前", "1 Tim"],
  ["提後", "2 Tim"], ["多", "Titus"], ["門", "Philem"], ["來", "Heb"], ["雅", "James"], ["彼前", "1 Pet"],
  ["彼後", "2 Pet"], ["約一", "1 John"], ["約二", "2 John"], ["約三", "3 John"], ["猶", "Jude"], ["啟", "Rev"]
];

describe("FHL short-keyword search helpers (#366)", () => {
  it("treats only 1–2 character queries as short", () => {
    expect(isShortBibleQuery("愛")).toBe(true);
    expect(isShortBibleQuery(" 恩典 ")).toBe(true);
    expect(isShortBibleQuery("神愛世")).toBe(false);
    expect(isShortBibleQuery("")).toBe(false);
    expect(isShortBibleQuery("   ")).toBe(false);
  });

  it("maps reader versions to FHL versions and leaves the rest unsupported", () => {
    expect(getFhlSearchVersion("CUNP")).toBe("unv");
    expect(getFhlSearchVersion("cuv")).toBe("unv");
    expect(getFhlSearchVersion("RCUVTS")).toBe("rcuv");
    for (const version of ["OCCB", "ESV", "NIV", "NLT", "WEB", "", null]) {
      expect(getFhlSearchVersion(version)).toBeNull();
    }
  });

  it("builds an encoded se.php URL with limit=500", () => {
    const url = new URL(buildFhlSearchUrl(" 恩典 ", "unv"));
    expect(url.origin + url.pathname).toBe("https://bible.fhl.net/json/se.php");
    expect(url.searchParams.get("VERSION")).toBe("unv");
    expect(url.searchParams.get("q")).toBe("恩典");
    expect(url.searchParams.get("limit")).toBe("500");
  });

  it("strips Strong's tags and line breaks from revised-version text", () => {
    expect(stripFhlMarkup("因為<WH03588>，他的怒氣<WH09002><WH0639>不過是轉眼之間<WH07281>，<br/>他的恩典")).toBe(
      "因為，他的怒氣不過是轉眼之間，他的恩典"
    );
  });

  it("maps every FHL book abbreviation to the right book", () => {
    const records = FHL_BOOKS.map(([chineses, engs]) => ({ chineses, engs, chap: 1, sec: 1, bible_text: "x" }));
    const mapped = mapFhlSearchRecords(records, books);
    expect(mapped.map(item => item.book)).toEqual(books.map(book => book.id));
  });

  it("falls back to the English abbreviation and skips records it cannot place", () => {
    const mapped = mapFhlSearchRecords(
      [
        { chineses: "?", engs: "1 Kin", chap: 3, sec: 9, bible_text: "<b>經文</b>" },
        { chineses: "?", engs: "Phil", chap: 4, sec: 13, bible_text: "經文" },
        { chineses: "?", engs: "Nope", chap: 1, sec: 1, bible_text: "經文" }
      ],
      books
    );
    expect(mapped).toEqual([
      { book: 11, bookName: "列王紀上", bookEng: "1 Kings", chapter: 3, verse: 9, text: "經文" },
      { book: 50, bookName: "腓立比書", bookEng: "Philippians", chapter: 4, verse: 13, text: "經文" }
    ]);
  });

  it("reads success payloads and rejects failures", () => {
    expect(readFhlSearchPayload({ status: "success", record_count: 49, record: [{ id: 1 }] })).toEqual({
      records: [{ id: 1 }],
      totalCount: 49
    });
    expect(() => readFhlSearchPayload({ status: "Fail: record count > 500" })).toThrow();
    expect(() => readFhlSearchPayload(null)).toThrow();
  });
});

describe("reader search wiring (#366, #378)", () => {
  it("routes each reader version to its search source", () => {
    expect(bible).toContain("const plan = getBibleSearchPlan(translation);");
    expect(bible).toContain('if (plan.source === "offline") return searchOfflinePack(trimmed, plan.version);');
    expect(bible).toContain('plan.source === "fhl" ? fetchFhlSearch(trimmed, plan.version) : fetchBollsSearch(trimmed, plan.version)');
  });

  it("asks for 3 characters only on bolls.life (English) versions", () => {
    expect(bible).toContain('getBibleSearchPlan(searchVersion).source === "bolls" && isShortBibleQuery(query)');
    expect(bible).toContain('if (plan.source === "bolls" && isShortBibleQuery(trimmed)) {');
  });

  it("searches every FHL query variant and highlights all of them", () => {
    expect(bible).toContain("const { fhlVersion, queries } = getFhlSearchQueries(query, translation);");
    expect(bible).toContain("results.highlightTerms = queries;");
    expect(bible).toContain("Array.isArray(results.highlightTerms) ? results.highlightTerms : []");
  });

  it("notes when results were cut off and escapes API text before highlighting", () => {
    expect(bible).toContain("結果太多，只顯示前 ${results.length} 筆");
    expect(bible).toContain('const safeText = escapeHTML(String(item.text || "").replace(/<[^>]*>/g, ""));');
  });

  it("clears the previous results when a search fails and shows the matching message", () => {
    expect(bible).toMatch(
      /searchResultsContainer\.innerHTML = "";\s*if \(searchResultsCountEl\) searchResultsCountEl\.textContent = getBibleSearchErrorMessage\(err\);/
    );
  });

  it("treats bible.fhl.net as a public Bible API in the service worker", () => {
    expect(sw).toContain('hostname === "bible.fhl.net"');
  });
});
