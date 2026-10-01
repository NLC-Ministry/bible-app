import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  BIBLE_SEARCH_ERROR,
  buildOfflineSearchCorpus,
  createBibleSearchError,
  getBibleSearchErrorMessage,
  getBibleSearchPlan
} from "../js/modules/bible-search-sources.mjs";
import { CUNP_NAME_ALIASES, getFhlSearchQueries, normalizeQueryForFhlVersion } from "../js/modules/fhl-bible-search.mjs";
import { rankBibleSearchResults } from "../js/modules/bible-search-ranker.mjs";

const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${readFileSync("js/data/bible_data.js", "utf8")}\nwindow.__books = BIBLE_BOOKS;`, context);
const books = context.window.__books;

describe("search source per reader version (#378)", () => {
  it("sends the three Chinese Union versions to 信望愛 regardless of length", () => {
    expect(getBibleSearchPlan("CUNP")).toEqual({ source: "fhl", version: "CUNP", fhlVersion: "unv" });
    expect(getBibleSearchPlan("cuv")).toEqual({ source: "fhl", version: "CUV", fhlVersion: "unv" });
    expect(getBibleSearchPlan("RCUVTS")).toEqual({ source: "fhl", version: "RCUVTS", fhlVersion: "rcuv" });
  });

  it("searches 當代譯本 in the offline pack and English versions on bolls.life", () => {
    expect(getBibleSearchPlan("OCCB")).toEqual({ source: "offline", version: "OCCB" });
    for (const version of ["ESV", "NIV", "NLT", "WEB"]) {
      expect(getBibleSearchPlan(version)).toEqual({ source: "bolls", version });
    }
    expect(getBibleSearchPlan(null).source).toBe("fhl");
  });

  it("maps error codes to member-facing messages", () => {
    expect(getBibleSearchErrorMessage(createBibleSearchError(BIBLE_SEARCH_ERROR.QUERY_TOO_SHORT))).toBe("請至少輸入 3 個字");
    expect(getBibleSearchErrorMessage(createBibleSearchError(BIBLE_SEARCH_ERROR.OFFLINE_PACK_REQUIRED))).toBe(
      "要先到 個人 → 偏好設定 → 離線聖經 下載當代譯本才能搜尋"
    );
    expect(getBibleSearchErrorMessage(new Error("network"))).toBe("搜尋失敗，請稍後再試");
  });
});

describe("FHL query variants (#378)", () => {
  it("uses 裡／毘 for unv and 裏／毗 for rcuv", () => {
    expect(normalizeQueryForFhlVersion("心裏 毗珥", "unv")).toBe("心裡 毘珥");
    expect(normalizeQueryForFhlVersion("心裡 毘珥", "rcuv")).toBe("心裏 毗珥");
    expect(normalizeQueryForFhlVersion(" 恩典 ", "unv")).toBe("恩典");
  });

  it("adds the 和合本 spelling of renamed people only for 新標點和合本", () => {
    expect(getFhlSearchQueries("尼哥德慕", "CUNP")).toEqual({ fhlVersion: "unv", queries: ["尼哥德慕", "尼哥底母"] });
    expect(getFhlSearchQueries("呂便的兒子", "CUNP").queries).toEqual(["呂便的兒子", "流便的兒子"]);
    expect(getFhlSearchQueries("尼哥德慕", "CUV").queries).toEqual(["尼哥德慕"]);
    expect(getFhlSearchQueries("心裏", "CUNP").queries).toEqual(["心裡"]);
    expect(getFhlSearchQueries("心裡", "RCUVTS")).toEqual({ fhlVersion: "rcuv", queries: ["心裏"] });
    expect(getFhlSearchQueries("love", "ESV")).toEqual({ fhlVersion: null, queries: [] });
  });

  it("replaces longer names before shorter ones", () => {
    expect(getFhlSearchQueries("亞她利雅和她瑪", "CUNP").queries[1]).toBe("亞他利雅和他瑪");
  });

  it("keeps the alias table free of 毗／毘 entries handled by character normalization", () => {
    for (const name of Object.keys(CUNP_NAME_ALIASES)) expect(name).not.toMatch(/[毗毘裏裡]/);
  });
});

describe("offline pack search corpus (#378)", () => {
  const rows = [
    { key: "OCCB_John_3", translation: "OCCB", book: "John", chapter: 3, verses: ["第一節", "「因為上帝愛世人，甚至將祂獨一的兒子賜給他們」"] },
    { key: "OCCB_Nope_1", translation: "OCCB", book: "Nope", chapter: 1, verses: ["略過"] }
  ];

  it("turns pack rows into verse items and skips unknown books", () => {
    expect(buildOfflineSearchCorpus(rows, books)).toEqual([
      { book: 43, bookName: "約翰福音", bookEng: "John", chapter: 3, verse: 1, text: "第一節" },
      { book: 43, bookName: "約翰福音", bookEng: "John", chapter: 3, verse: 2, text: "「因為上帝愛世人，甚至將祂獨一的兒子賜給他們」" }
    ]);
  });

  it("finds one-character and phrase matches with the shared ranker", () => {
    const corpus = buildOfflineSearchCorpus(rows, books);
    expect(rankBibleSearchResults(corpus, "愛", { includeFuzzy: false, limit: corpus.length })).toHaveLength(1);
    expect(rankBibleSearchResults(corpus, "上帝愛世人", { includeFuzzy: false, limit: corpus.length })[0].verse).toBe(2);
  });
});
