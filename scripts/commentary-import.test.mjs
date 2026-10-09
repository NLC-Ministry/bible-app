// #471、#476：Tyndale Open Study Notes 匯入工具與譯文檔。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  TOSN_ATTRIBUTION,
  TOSN_BOOK_CODES,
  buildImportSql,
  mergeTranslations,
  parseTosnRef,
  parseTosnStudyNotes,
  studyNoteBodyToText
} from "./commentary-import/tosn.mjs";
import { loadBibleBooks } from "./commentary-import/extract.mjs";

const XML = `<items release="1.25">
<item name="Lev.1.1-7.38" typename="StudyNote" product="TyndaleOpenStudyNotes">
<refs>Lev.1.1-7.38</refs>
<body>
<p class="sn-text"><span class="sn-ref"><a href="?bref=Lev.1.1-7.38">1:1–7:38</a></span> The first major section.</p>
</body>
</item>
<item name="Lev.1.3-17" typename="StudyNote" product="TyndaleOpenStudyNotes">
<refs>Lev.1.3-17</refs>
<body>
<p class="sn-text"><span class="sn-ref"><a href="?bref=Lev.1.3-17">1:3-17</a></span> <span class="sn-excerpt">The <span class="divine-name">Lord</span>’s</span> offering &amp; more (<a href="?bref=Num.15.1-10">Num 15:1-10</a>).</p>
<p class="sn-list-1">• second paragraph</p>
</body>
</item>
<item name="Num.1.1" typename="StudyNote" product="TyndaleOpenStudyNotes"><refs>Num.1.1</refs><body><p class="sn-text">x</p></body></item>
</items>`;

describe("TOSN extraction (#471)", () => {
  it("maps TOSN book codes onto the app's 66 books in order", () => {
    const books = loadBibleBooks();
    expect(TOSN_BOOK_CODES).toHaveLength(66);
    expect(books).toHaveLength(66);
    expect(books[TOSN_BOOK_CODES.indexOf("Lev")].name).toBe("利未記");
    expect(books[TOSN_BOOK_CODES.indexOf("Rev")].name).toBe("啟示錄");
  });

  it("parses verse ranges, hanging cross-chapter notes on their first verse", () => {
    expect(parseTosnRef("Lev.1.3", "Lev")).toMatchObject({ chapter: 1, verse_start: 3, verse_end: 3, cross_chapter: false, range: "1:3" });
    expect(parseTosnRef("Lev.1.3-17", "Lev")).toMatchObject({ chapter: 1, verse_start: 3, verse_end: 17, range: "1:3-17" });
    expect(parseTosnRef("Lev.1.1-7.38", "Lev")).toMatchObject({ chapter: 1, verse_start: 1, verse_end: 1, cross_chapter: true, range: "1:1–7:38" });
    expect(parseTosnRef("Num.1.1", "Lev")).toBeNull();
  });

  it("turns a note body into plain paragraphs without the leading reference", () => {
    const [overview, note] = parseTosnStudyNotes(XML, "Lev");
    expect(overview.en).toBe("The first major section.");
    expect(note.en).toBe("The Lord’s offering & more (Num 15:1-10).\n\n• second paragraph");
    expect(parseTosnStudyNotes(XML, "Lev")).toHaveLength(2);
    expect(studyNoteBodyToText("<p>&#8220;a&#8221;</p>")).toBe("“a”");
  });

  it("keeps existing translations when re-extracting and titles cross-chapter overviews", () => {
    const merged = mergeTranslations(parseTosnStudyNotes(XML, "Lev"), [{ ref: "Lev.1.3-17", title: "燔祭", zh: "已翻" }]);
    expect(merged[0]).toMatchObject({ title: "1:1–7:38 總覽", zh: "" });
    expect(merged[1]).toMatchObject({ title: "燔祭", zh: "已翻" });
  });
});

describe("import SQL (#471)", () => {
  const file = {
    book: "利未記",
    notes: [
      { ref: "Lev.1.1", chapter: 1, verse_start: 1, verse_end: 1, title: "", zh: "耶和華的「話」", en: "The Lord's word" },
      { ref: "Lev.1.2-3", chapter: 1, verse_start: 2, verse_end: 3, title: "", zh: "第二則", en: "second" },
      { ref: "Lev.1.4", chapter: 1, verse_start: 4, verse_end: 4, title: "", zh: "第三則", en: "third" }
    ]
  };

  it("inserts pending, unpublished rows with attribution and skips refs that already exist", () => {
    const sql = buildImportSql(file, { batchSize: 2 });
    expect(sql.match(/INSERT INTO public\.passage_commentary/g)).toHaveLength(2);
    expect(sql.match(/ON CONFLICT \(source_ref\) WHERE source_ref IS NOT NULL DO NOTHING;/g)).toHaveLength(2);
    expect(sql).toContain("'The Lord''s word'");
    expect(sql).toContain("'TOSN:Lev.1.2-3', FALSE, 'pending'");
    expect(sql).toContain(`'${TOSN_ATTRIBUTION}'`);
    expect(sql.startsWith("-- 經文注釋匯入：利未記（3 則")).toBe(true);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("refuses to build while any note is untranslated", () => {
    expect(() => buildImportSql({ ...file, notes: [...file.notes, { ref: "Lev.1.5", zh: " " }] })).toThrow("還有 1 則沒有譯文：Lev.1.5");
  });

  it("names the CC BY-SA source, the original and the change made, as the licence asks", () => {
    expect(TOSN_ATTRIBUTION).toContain("Tyndale Open Study Notes");
    expect(TOSN_ATTRIBUTION).toContain("CC BY-SA 4.0");
    expect(TOSN_ATTRIBUTION).toContain("tyndaleopenresources.com");
    expect(TOSN_ATTRIBUTION).toContain("譯為繁體中文");
  });
});

describe("translated book files (#476)", () => {
  const dir = "content/commentary/tosn";
  const books = loadBibleBooks();
  const counts = new Function(`${readFileSync("js/data/bible_verse_counts.js", "utf8").replace("window.BIBLE_VERSE_COUNTS = BIBLE_VERSE_COUNTS;", "")}; return BIBLE_VERSE_COUNTS;`)();
  const files = ["leviticus.json"].filter(name => existsSync(`${dir}/${name}`));

  it.each(files)("%s is complete, unique and inside the book's verses", name => {
    const file = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
    const book = books.find(item => item.name === file.book);
    expect(book).toBeTruthy();
    const refs = new Set();
    for (const note of file.notes) {
      expect(refs.has(note.ref), note.ref).toBe(false);
      refs.add(note.ref);
      expect(String(note.zh || "").trim(), note.ref).not.toBe("");
      expect(String(note.en || "").trim(), note.ref).not.toBe("");
      expect(note.verse_end, note.ref).toBeGreaterThanOrEqual(note.verse_start);
      expect(note.verse_end, note.ref).toBeLessThanOrEqual(counts[book.eng][note.chapter - 1]);
    }
    expect(() => buildImportSql(file)).not.toThrow();
  });
});
