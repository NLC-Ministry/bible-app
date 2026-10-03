import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { filterBibleBooks, formatVerseList, parseBibleReference } from "../js/modules/bible-reference-parser.mjs";

const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${readFileSync("js/data/bible_data.js", "utf8")}\nwindow.__books = BIBLE_BOOKS;`, context);
vm.runInContext(`${readFileSync("js/data/bible_verse_counts.js", "utf8")}\nwindow.__counts = BIBLE_VERSE_COUNTS;`, context);
const books = context.window.__books;
const verseCounts = context.window.__counts;

const bible = readFileSync("js/modules/bible.js", "utf8");
const html = readFileSync("index.html", "utf8");

function zh(input) {
  return parseBibleReference(input, { books, verseCounts, language: "zh" });
}

function en(input) {
  return parseBibleReference(input, { books, verseCounts, language: "en" });
}

function expectReference(result, bookName, chapter, verses = null) {
  expect(result.kind).toBe("reference");
  expect(result.book.name).toBe(bookName);
  expect(result.chapter).toBe(chapter);
  expect(result.verses).toEqual(verses);
}

describe("book abbreviations follow the CUV standard (#362)", () => {
  it("uses 斯／西／來 and keeps 約一／約二／約三", () => {
    const abbrev = Object.fromEntries(books.map(book => [book.name, book.abbrev]));
    expect(abbrev["以斯帖記"]).toBe("斯");
    expect(abbrev["歌羅西書"]).toBe("西");
    expect(abbrev["希伯來書"]).toBe("來");
    expect(abbrev["雅歌"]).toBe("歌");
    expect(abbrev["約翰一書"]).toBe("約一");
    expect(abbrev["約翰二書"]).toBe("約二");
    expect(abbrev["約翰三書"]).toBe("約三");
  });

  it("never repeats an abbreviation across the 66 books", () => {
    const all = books.map(book => book.abbrev);
    expect(books).toHaveLength(66);
    expect(new Set(all).size).toBe(66);
  });
});

describe("parseBibleReference — Chinese versions (#362)", () => {
  it("accepts loose separators, spacing and full-width characters", () => {
    for (const input of ["約3:16", "約 3:16", "約3：16", "約3.16", "約 3 16", "約３：１６", "約翰福音3:16", "約翰3:16"]) {
      expectReference(zh(input), "約翰福音", 3, [16]);
    }
  });

  it("accepts 章／篇／節 with Arabic numerals", () => {
    expectReference(zh("約3章16節"), "約翰福音", 3, [16]);
    expectReference(zh("約 3 章 16 節"), "約翰福音", 3, [16]);
    expectReference(zh("約3章"), "約翰福音", 3);
    expectReference(zh("詩23篇"), "詩篇", 23);
    expectReference(zh("詩篇23篇"), "詩篇", 23);
    expectReference(zh("詩23篇1節"), "詩篇", 23, [1]);
    expectReference(zh("詩23"), "詩篇", 23);
  });

  it("treats 至／到／- as ranges and 、 as separate verses", () => {
    expectReference(zh("約3:16-18"), "約翰福音", 3, [16, 17, 18]);
    expectReference(zh("約3章16至18節"), "約翰福音", 3, [16, 17, 18]);
    expectReference(zh("約3:16到18"), "約翰福音", 3, [16, 17, 18]);
    expectReference(zh("約3:16、18"), "約翰福音", 3, [16, 18]);
    expectReference(zh("約3:16、18-20"), "約翰福音", 3, [16, 18, 19, 20]);
    expect(zh("約3:16、18-20").label).toBe("約翰福音 3:16、18-20");
  });

  it("jumps only to the start of a cross-chapter range", () => {
    expectReference(zh("約3:16-4:2"), "約翰福音", 3, [16]);
  });

  it("reads a single number as a verse in single-chapter books", () => {
    expectReference(zh("猶5"), "猶大書", 1, [5]);
    expectReference(zh("猶5-7"), "猶大書", 1, [5, 6, 7]);
  });

  it("maps standard abbreviations to exactly one book", () => {
    expectReference(zh("約3:16"), "約翰福音", 3, [16]);
    expectReference(zh("書1:1"), "約書亞記", 1, [1]);
    expectReference(zh("伯1:1"), "約伯記", 1, [1]);
    expectReference(zh("斯1:1"), "以斯帖記", 1, [1]);
    expectReference(zh("西1:1"), "歌羅西書", 1, [1]);
    expectReference(zh("歌1:1"), "雅歌", 1, [1]);
    expectReference(zh("來11:1"), "希伯來書", 11, [1]);
    expectReference(zh("林前13"), "哥林多前書", 13);
  });

  it("accepts both 1–3 John abbreviation sets and full names", () => {
    for (const input of ["約一1:9", "約壹1:9", "約翰一1:9", "約翰一書1:9", "約翰壹書1:9"]) {
      expectReference(zh(input), "約翰一書", 1, [9]);
    }
    expectReference(zh("約參1:2"), "約翰三書", 1, [2]);
    expectReference(zh("約叄1:2"), "約翰三書", 1, [2]);
  });

  it("resolves a unique full-name prefix and skips books whose next character is an ordinal", () => {
    expectReference(zh("約翰3:16"), "約翰福音", 3, [16]);
    expectReference(zh("約伯3"), "約伯記", 3);
    expectReference(zh("希11:1"), "希伯來書", 11, [1]);
  });

  it("asks the reader to choose when a prefix matches several books", () => {
    const corinthians = zh("哥林多13");
    expect(corinthians.kind).toBe("choices");
    expect(corinthians.choices.map(choice => choice.label)).toEqual(["哥林多前書 13", "哥林多後書 13"]);
    const thessalonians = zh("帖1:1");
    expect(thessalonians.kind).toBe("choices");
    expect(thessalonians.choices).toHaveLength(2);
  });

  it("reports chapters and verses that do not exist", () => {
    expect(zh("約22:1")).toMatchObject({ kind: "error", code: "chapter_out_of_range", message: "約翰福音只有 21 章" });
    expect(zh("約3:40")).toMatchObject({ kind: "error", code: "verse_out_of_range", message: "約翰福音 3 章只有 36 節" });
    expect(zh("詩151")).toMatchObject({ kind: "error", message: "詩篇只有 150 篇" });
  });

  it("rejects Chinese numerals with a hint", () => {
    for (const input of ["約三章十六節", "約三:十六"]) {
      expect(zh(input)).toMatchObject({ kind: "error", code: "invalid_format", message: "章節請用數字，例如 約3:16" });
    }
  });

  it("returns book suggestions for a book-only input", () => {
    expect(zh("約")).toMatchObject({ kind: "books", target: { name: "約翰福音" } });
    expect(zh("約").books.map(book => book.name)).toEqual(["約翰福音"]);
    const john = zh("約翰");
    expect(john.target.name).toBe("約翰福音");
    expect(john.books.map(book => book.name)).toEqual(["約翰福音", "約翰一書", "約翰二書", "約翰三書"]);
    expect(zh("哥林多")).toMatchObject({ kind: "books", target: null });
  });

  it("leaves ordinary keywords and English book names to keyword search", () => {
    for (const input of ["愛", "以利亞", "耶穌", "John 3:16"]) {
      expect(zh(input).kind).toBe("none");
    }
    expect(zh("   ").kind).toBe("empty");
  });
});

describe("parseBibleReference — English versions (#362)", () => {
  it("accepts English names and common abbreviations", () => {
    for (const input of ["John 3:16", "john3:16", "Jn 3.16", "Jn 3 16", "JHN 3:16"]) {
      expectReference(en(input), "約翰福音", 3, [16]);
    }
    expectReference(en("1 Cor 13"), "哥林多前書", 13);
    expectReference(en("1Co 13"), "哥林多前書", 13);
    expectReference(en("1 John 1:9"), "約翰一書", 1, [9]);
    expectReference(en("Ps 23"), "詩篇", 23);
    expectReference(en("Lk. 4:13"), "路加福音", 4, [13]);
    expectReference(en("Song of Solomon 2:1"), "雅歌", 2, [1]);
    expect(en("John 3:16-18").label).toBe("John 3:16-18");
  });

  it("does not treat Chinese book names as references", () => {
    expect(en("約3:16").kind).toBe("none");
  });

  it("prefers the unnumbered book for an unnumbered prefix", () => {
    expect(en("joh")).toMatchObject({ kind: "books", target: { eng: "John" } });
    expect(en("jo").target).toBeNull();
  });
});

describe("filterBibleBooks (#362)", () => {
  const names = (input, language = "zh") =>
    filterBibleBooks(input, { books, language }).books.map(book => (language === "en" ? book.eng : book.name));

  it("narrows the book list with the parser's matching rules", () => {
    expect(names("約")).toEqual(["約翰福音"]);
    expect(names("書")).toEqual(["約書亞記"]);
    expect(names("約伯")).toEqual(["約伯記"]);
    expect(names("約翰")).toEqual(["約翰福音", "約翰一書", "約翰二書", "約翰三書"]);
    expect(names("約3:16")).toEqual(["約翰福音"]);
    expect(names("jn", "en")).toEqual(["John"]);
    expect(names("")).toHaveLength(66);
  });
});

describe("formatVerseList", () => {
  it("compresses consecutive verses", () => {
    expect(formatVerseList([16, 18, 19, 20])).toBe("16、18-20");
    expect(formatVerseList([16, 18, 19, 20], { language: "en" })).toBe("16, 18-20");
  });
});

describe("reader wiring (#362)", () => {
  it("keeps the 🔍 box for scripture text only, with a hint line instead of jump cards", () => {
    expect(html).toContain('id="global-search-reference-hint"');
    expect(html).not.toContain('id="global-search-reference"');
    // 搜尋整本聖經...（還原改版前的提示文字）
    expect(html).toMatch(/id="global-search-input"\s+placeholder="&#x641C;&#x5C0B;&#x6574;&#x672C;&#x8056;&#x7D93;\.\.\."/);
    expect(bible).toContain("要跳到章節，請從目錄輸入");
    expect(bible).not.toContain("reference-book-chip");
  });

  it("puts reference lookup in the directory filter only", () => {
    expect(html).toContain('id="bible-nav-filter-input"');
    // 只有目錄篩選框處理 Enter（中文輸入法選字的 Enter 不算）。
    // 目錄（含篩選框）和 /read 共用 bible-nav-directory.mjs（#423）。
    const directory = readFileSync(new URL("../js/modules/bible-nav-directory.mjs", import.meta.url), "utf8");
    expect(directory.match(/e\.isComposing \|\| e\.keyCode === 229/g)?.length).toBe(1);
    expect(bible).not.toMatch(/e\.isComposing \|\| e\.keyCode === 229/);
    expect(directory).toContain('language: english ? "en" : "zh"');
    expect(bible).toContain("english: usesEnglishReaderLabels()");
  });

  it("jumps through the directory's selectVerse and flashes every requested verse", () => {
    const directory = readFileSync(new URL("../js/modules/bible-nav-directory.mjs", import.meta.url), "utf8");
    expect(directory).toContain("selectVerse(verses.length ? verses[0] : null, verses)");
    expect(bible).toContain("onSelect: goToReaderVerse");
    expect(bible).toContain("revealVerses(document.getElementById(\"bible-content\"), verse, highlightVerses);");
  });
});
