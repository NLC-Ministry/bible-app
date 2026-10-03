// @vitest-environment jsdom
// #423：聖經目錄抽成共用模組，主 App 讀經頁和 /read 讀經頁用同一份程式與面板。
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BIBLE_NAV_OVERLAY_HTML,
  createBibleNavDirectory,
  ensureBibleNavOverlay,
  readerBookAbbreviation
} from "../js/modules/bible-nav-directory.mjs";

const indexHtml = readFileSync("index.html", "utf8");
let BOOKS;
let COUNTS;

beforeAll(async () => {
  await import("../js/data/bible_data.js");
  await import("../js/data/bible_verse_counts.js");
  BOOKS = window.BIBLE_BOOKS;
  COUNTS = window.BIBLE_VERSE_COUNTS;
});

function normalize(el) {
  return el.outerHTML.replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

function mountDirectory({ version = "CUNP", position = { bookId: 43, chapter: 3 } } = {}) {
  document.body.innerHTML = "";
  const onSelect = vi.fn();
  const onVersionBadge = vi.fn();
  const openLayer = vi.fn(el => el.classList.remove("hidden"));
  const closeLayer = vi.fn(el => el.classList.add("hidden"));
  const directory = createBibleNavDirectory({
    doc: document,
    books: BOOKS,
    getVerseCounts: () => COUNTS,
    getVersion: () => version,
    getPosition: () => position,
    onSelect,
    openLayer,
    closeLayer,
    onVersionBadge
  });
  directory.open();
  return { directory, onSelect, onVersionBadge, closeLayer };
}

const $ = id => document.getElementById(id);

describe("one panel for both pages", () => {
  it("the module's template is exactly the panel in index.html", () => {
    const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
    const fromIndex = parsed.getElementById("bible-nav-overlay");
    const template = document.createElement("template");
    template.innerHTML = BIBLE_NAV_OVERLAY_HTML.trim();
    expect(normalize(template.content.firstElementChild)).toBe(normalize(fromIndex));
  });

  it("reuses an existing panel instead of adding a second one", () => {
    document.body.innerHTML = "";
    const first = ensureBibleNavOverlay(document);
    expect(ensureBibleNavOverlay(document)).toBe(first);
    expect(document.querySelectorAll("#bible-nav-overlay")).toHaveLength(1);
  });
});

describe("directory behaviour", () => {
  it("opens on the book tab with Old/New Testament sections and the current book active", () => {
    mountDirectory();
    expect($("bible-nav-title").textContent).toBe("選擇書卷");
    const titles = [...document.querySelectorAll(".bible-nav-section-title")].map(el => el.textContent);
    expect(titles).toEqual(["舊約聖經", "新約聖經"]);
    expect(document.querySelectorAll(".grid-item-book")).toHaveLength(66);
    expect(document.querySelector(".grid-item-book.active .full-title").textContent).toBe("約翰福音");
  });

  it("book → chapter → verse, then hands the choice to the page", () => {
    const { onSelect } = mountDirectory();
    [...document.querySelectorAll(".grid-item-book")].find(el => el.textContent.includes("羅馬書")).click();
    expect($("bible-nav-title").textContent).toBe("羅馬書");
    expect(document.querySelectorAll(".chapter-nav-grid .grid-item-number")).toHaveLength(16);
    [...document.querySelectorAll(".chapter-nav-grid .grid-item-number")].find(el => el.textContent === "8").click();
    expect($("bible-nav-title").textContent).toBe("羅馬書 8章");
    expect(document.querySelectorAll(".verse-nav-grid .grid-item-number")).toHaveLength(39);
    [...document.querySelectorAll(".verse-nav-grid .grid-item-number")].find(el => el.textContent === "28").click();
    expect(onSelect).toHaveBeenCalledWith({ bookId: 45, chapter: 8, verse: 28, highlightVerses: null });
    expect($("bible-nav-overlay").classList.contains("hidden")).toBe(true);
  });

  it("typing a reference shows a 前往 card that jumps there and flashes the whole range", () => {
    const { onSelect } = mountDirectory();
    const input = $("bible-nav-filter-input");
    input.value = "約3:16-17";
    input.dispatchEvent(new Event("input"));
    const card = document.querySelector(".reference-jump-card");
    expect(card.textContent).toContain("前往");
    card.click();
    expect(onSelect).toHaveBeenCalledWith({ bookId: 43, chapter: 3, verse: 16, highlightVerses: [16, 17] });
  });

  it("Enter on a reference jumps straight there", () => {
    const { onSelect } = mountDirectory();
    const input = $("bible-nav-filter-input");
    input.value = "詩23";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ bookId: 19, chapter: 23 }));
  });

  it("switches to the list view", () => {
    mountDirectory();
    $("view-mode-list").click();
    expect(document.querySelectorAll(".book-list-item-asym")).toHaveLength(66);
    expect($("view-mode-list").classList.contains("active")).toBe(true);
  });

  it("back walks verse → chapter → book → closes", () => {
    const { closeLayer } = mountDirectory();
    document.querySelector(".grid-item-book").click();
    document.querySelector(".chapter-nav-grid .grid-item-number").click();
    $("bible-nav-back-btn").click();
    expect($("bible-nav-title").textContent).toBe("創世記");
    $("bible-nav-back-btn").click();
    expect($("bible-nav-title").textContent).toBe("選擇書卷");
    $("bible-nav-back-btn").click();
    expect(closeLayer).toHaveBeenCalled();
  });

  it("uses English labels for English translations", () => {
    mountDirectory({ version: "NIV" });
    expect($("bible-nav-title").textContent).toBe("Select Book");
    expect(document.querySelector(".grid-item-book.active .full-title").textContent).toBe("John");
    expect(readerBookAbbreviation(BOOKS.find(b => b.id === 46), true)).toBe("1 Cori");
  });

  it("the version badge hands off to the page's version picker", () => {
    const { onVersionBadge } = mountDirectory();
    $("bible-nav-version-badge").click();
    expect(onVersionBadge).toHaveBeenCalledTimes(1);
  });
});
