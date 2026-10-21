// #606：經文純文字化的單一規則，以及顯示出口一律純文字。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { toPlainVerseText } from "../js/data/verse-text.mjs";
import { createVerseElement } from "../js/modules/reader-verse-dom.mjs";
import { stripFhlMarkup } from "../js/modules/fhl-bible-search.mjs";
import { normalizeBibleSearchText } from "../js/modules/bible-search-ranker.mjs";
import { plainVerseText } from "../js/data/passage-commentary.mjs";

const CORPUS = [
  "<scr<b>ipt>alert(1)</scr</b>ipt>",
  "<<b>b>",
  "a < b",
  "a > b",
  "<h2>標題</h2>經文",
  "起初<br/>神創造天地",
  "<WH03588>起初",
  "<S>1234</S>In the beginning<sup>1</sup>",
  "<a href=\"x\">link</a>",
  "<img src=x onerror=alert(1)>",
  "<<<img src=x onerror=alert(1)>>>",
  "",
  null,
  undefined,
  "純文字經文",
];

describe("toPlainVerseText", () => {
  it("拼接式標籤不會重新組成標籤", () => {
    const out = toPlainVerseText("<scr<b>ipt>alert(1)</scr</b>ipt>");
    expect(out).not.toMatch(/[<>]/);
    expect(toPlainVerseText("<<b>b>")).toBe("b");
  });

  it("移除一般標籤、保留文字", () => {
    expect(toPlainVerseText("<h2>標題</h2>經文")).toBe("標題經文");
    expect(toPlainVerseText("起初<br/>神")).toBe("起初神");
    expect(toPlainVerseText("<WH03588>起初")).toBe("起初");
  });

  it("沒有標籤的中文原樣保留，null／undefined 當空字串", () => {
    expect(toPlainVerseText("起初，神創造天地。")).toBe("起初，神創造天地。");
    expect(toPlainVerseText(null)).toBe("");
    expect(toPlainVerseText(undefined)).toBe("");
  });

  it("結果不含任何 < 或 >", () => {
    for (const raw of CORPUS) expect(toPlainVerseText(raw)).not.toMatch(/[<>]/);
  });

  it("bible_data.js 內的副本與 verse-text.mjs 輸出一致", () => {
    const context = { console, fetch: () => {}, URLSearchParams, URL, AbortSignal };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(readFileSync("js/data/bible_data.js", "utf8"), context);
    for (const raw of CORPUS) {
      expect(context.window.toPlainVerseText(raw)).toBe(toPlainVerseText(raw));
    }
  });

  it("bible_data.js 的 normalizeVerses／cleanFhlChapterText 也擋得住拼接", () => {
    const context = { console, fetch: () => {}, URLSearchParams, URL, AbortSignal };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(readFileSync("js/data/bible_data.js", "utf8"), context);
    const cleaned = context.window.cleanFhlChapterText("<scr<b>ipt>alert(1)</scr</b>ipt>神");
    expect(cleaned).not.toMatch(/[<>]/);
    expect(cleaned).toContain("神");
    const mapped = context.window.mapFhlChapterRecords([{ sec: 1, bible_text: "<<b>b>經文" }]);
    expect(mapped).toEqual([{ verse: 1, text: "b經文" }]);
  });

  it("搜尋、比對、注釋引用共用同一規則", () => {
    expect(stripFhlMarkup("<scr<b>ipt>x</scr</b>ipt>")).not.toMatch(/[<>]/);
    expect(normalizeBibleSearchText("<scr<b>ipt>X")).not.toMatch(/[<>]/);
    expect(plainVerseText("<scr<b>ipt>x")).not.toMatch(/[<>]/);
  });
});

describe("createVerseElement 一律純文字", () => {
  it("含 <img onerror> 字樣的經文不會產生 img 節點", () => {
    const { document } = new JSDOM("<!doctype html><body></body>").window;
    const el = createVerseElement(document, { verse: 3, text: "<img src=x onerror=alert(1)>神愛世人" });
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".verse-text").textContent).toBe("<img src=x onerror=alert(1)>神愛世人");
    expect(el.querySelector(".verse-num").textContent).toBe("3");
    expect(el.dataset.verse).toBe("3");
  });

  it("highlightColor 照舊套用", () => {
    const { document } = new JSDOM("<!doctype html><body></body>").window;
    const el = createVerseElement(document, { verse: 1, text: "經文" }, { highlightColor: "#ff0" });
    expect(el.getAttribute("data-highlight")).toBe("#ff0");
  });
});
