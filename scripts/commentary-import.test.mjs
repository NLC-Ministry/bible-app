// #471、#476、#542：Tyndale Open Study Notes 匯入工具與譯文檔。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  TOSN_ATTRIBUTION,
  TOSN_BOOK_CODES,
  alignRefLabels,
  buildImportSql,
  buildStructureUpdateSql,
  fillExcerptPhrases,
  mergeExcerptSpans,
  mergeTranslations,
  noteVerses,
  parseStudyNoteBody,
  parseTosnRef,
  parseTosnStudyNotes,
  refLabelVariants,
  sourceHashOf,
  studyNoteBodyToText,
  tosnReleaseOf
} from "./commentary-import/tosn.mjs";
import { loadBibleBooks } from "./commentary-import/extract.mjs";
import { describeAnchor, formatRefLabel, parseBref, repairRefFromAnchor, toStoredRef } from "./commentary-import/refs.mjs";
import {
  USFM_BOOK_CODES,
  matchOriginalWords,
  normalizeTranslit,
  parseLexiconScript,
  parseStrongText,
  parseUsfmBook,
  readZipEntries,
  translitSimilarity
} from "./commentary-import/sources.mjs";
import { buildNoteInput, buildTranslationInput, glossaryCandidates, glossaryHits, serializeGlossary } from "./commentary-import/input.mjs";
import { buildExportFile, buildExportSql } from "./commentary-import/export.mjs";

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

  // #542：新結構都補上了，交叉引用的書卷與章節都存在，跨章的結束章節在範圍內，片語的中文出現在譯文裡。
  it.each(files)("%s carries the #542 structure", name => {
    const file = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
    const book = books.find(item => item.name === file.book);
    expect(file.sourceVersion).toMatch(/^TOSN \d+\.\d+$/);
    for (const note of file.notes) {
      expect(note.source_hash, note.ref).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof note.prepared, note.ref).toBe("string");
      for (const ref of note.cross_refs) {
        const target = books.find(item => item.name === ref.book);
        expect(target, `${note.ref} ${ref.label}`).toBeTruthy();
        expect(ref.chapter, `${note.ref} ${ref.label}`).toBeLessThanOrEqual(target.chapters);
        expect(String(ref.label).trim(), note.ref).not.toBe("");
      }
      for (const excerpt of note.excerpts.filter(item => item.zh)) {
        for (const part of excerpt.zh.split(/……|…/)) expect(note.zh, `${note.ref} ${excerpt.zh}`).toContain(part);
      }
      if (note.cross_chapter) {
        expect(note.chapter_end, note.ref).toBeGreaterThan(note.chapter);
        expect(note.chapter_end_verse, note.ref).toBeLessThanOrEqual(counts[book.eng][note.chapter_end - 1]);
      }
    }
    expect(buildStructureUpdateSql(file)).toContain(`WHERE c.source_ref = v.source_ref AND c.book = '${file.book}';`);
  });
});

const BOOKS = loadBibleBooks();

describe("cross references from ?bref= (#542)", () => {
  it("reads TOSN references, including numbered books, ranges, cross-chapter and cross-book", () => {
    expect(parseBref("Exod.27.21")).toEqual({ bookIndex: 1, chapter: 27, verse: 21, chapter_end: 27, verse_end: 21 });
    expect(parseBref("Gen.1.22-25")).toMatchObject({ chapter: 1, verse: 22, chapter_end: 1, verse_end: 25 });
    expect(parseBref("Gen.1.1-2.3")).toMatchObject({ chapter_end: 2, verse_end: 3 });
    expect(parseBref("1Sam.24.6")).toMatchObject({ bookIndex: TOSN_BOOK_CODES.indexOf("ISam") });
    expect(parseBref("ISam.24.6")).toMatchObject({ bookIndex: TOSN_BOOK_CODES.indexOf("ISam") });
    expect(parseBref("Isa.53.1-12")).toMatchObject({ bookIndex: TOSN_BOOK_CODES.indexOf("Isa") });
    expect(parseBref("1Sam.1.1-2Kgs.25.30")).toMatchObject({ end_book_index: TOSN_BOOK_CODES.indexOf("IIKgs"), chapter_end: 25 });
    expect(parseBref("Lev.5.17-19_StudyNote_Filament")).toBeNull();
    expect(parseBref("Nope.1.1")).toBeNull();
  });

  it("repairs the few broken ranges from the anchor text", () => {
    expect(repairRefFromAnchor(parseBref("Heb.3.11-4"), "Heb 3:11–4:11")).toMatchObject({ chapter: 3, verse: 11, chapter_end: 4, verse_end: 11 });
    expect(repairRefFromAnchor(parseBref("Heb.3.11-4"), "3:11")).toMatchObject({ chapter_end: 3, verse_end: 11 });
    expect(repairRefFromAnchor(null, "x")).toBeNull();
  });

  it("labels references the way the anchor is written, with the app's 和合本 abbreviations", () => {
    const label = (bref, text, options) => formatRefLabel(parseBref(bref), text, BOOKS, options);
    expect(label("Exod.27.21", "Exod 27:21")).toBe("出27:21");
    expect(label("Num.15.1-10", "Num 15:1-10")).toBe("民15:1-10");
    expect(label("Lev.7.8", "7:8")).toBe("7:8");
    expect(label("Gen.1.21", "21")).toBe("21");
    expect(label("Gen.6.5-7", "5-7")).toBe("5-7");
    expect(label("Isa.53.1-12", "Isa 53")).toBe("賽53章");
    expect(label("Ps.29.1-11", "Ps 29")).toBe("詩29篇");
    expect(label("Lev.1.1-7.38", "Lev 1–7")).toBe("利1–7章");
    expect(label("Gen.1.1-31", "1", { chapterBefore: true })).toBe("第1章");
    expect(label("Lev.18.1-30", "Chapter 18")).toBe("第18章");
    expect(label("Lev.1.1-7.38", "1:1–7:38")).toBe("1:1–7:38");
    expect(label("1Sam.1.1-2Kgs.25.30", "1 Sam 1:1—2 Kgs 25:30")).toBe("撒上1:1—王下25:30");
    expect(label("1Jn.1.8-9", "1 Jn 1:8-9")).toBe("約一1:8-9");
    expect(label("Ps.141.9", "and 141:9")).toBe("141:9");
    expect(describeAnchor("and 141:9").lead).toBe("and ");
  });

  it("stores the book's full name, and null verses for whole chapters", () => {
    expect(toStoredRef(parseBref("Exod.27.21"), "出27:21", BOOKS, { note: true }))
      .toEqual({ book: "出埃及記", chapter: 27, verse: 21, chapter_end: 27, verse_end: 21, label: "出27:21", note: true });
    expect(toStoredRef(parseBref("Isa.53.1-12"), "賽53章", BOOKS)).toMatchObject({ verse: null, verse_end: null });
    expect(toStoredRef(parseBref("1Sam.1.1-2Kgs.25.30"), "撒上1:1—王下25:30", BOOKS).end_book).toBe("列王紀下");
  });
});

const BODY = `<p class="sn-text"><span class="sn-ref"><a href="?bref=Lev.1.1">1:1</a></span> <span class="sn-excerpt">The</span> <span class="sn-excerpt-divine-name">Lord</span><span class="sn-excerpt"> called to Moses:</span> The Tabernacle (see <a href="?item=Exod.27.21_StudyNote_Filament">study note on Exod 27:21</a>) in ch <a href="?bref=Lev.16.1-34">16</a>; cp. <a href="?bref=Rom.3.25">Rom 3:25</a>; <a href="?bref=Rom.8.3">8:3</a>, e.g., (Hebrew <span class="hebrew">‘olah</span><span class="ital">,</span> “up”) and “<a href="?item=CommunityIdentity_ThemeNote_Filament">Community Identity</a>” Theme Note. • <span class="sn-excerpt">burnt offering:</span> see study notes on <a href="?bref=Lev.4.3">4:3</a> and <a href="?bref=Lev.5.17-19">5:17-19</a>.</p>`;

describe("study note preprocessing (#542)", () => {
  const parsed = parseStudyNoteBody(BODY, { books: BOOKS });

  it("keeps the English text exactly as before for reviewers", () => {
    expect(parsed.en).toBe(studyNoteBodyToText(BODY));
    expect(parsed.en.startsWith("The Lord called to Moses: The Tabernacle (see study note on Exod 27:21)")).toBe(true);
  });

  it("hands the translator Chinese references, fixed phrases and one paragraph per • segment", () => {
    expect(parsed.prepared).toBe("The Lord called to Moses: The Tabernacle (見出27:21的注釋) in 第16章; 參羅3:25; 8:3, 例如(Hebrew ‘olah, “up”) and “Community Identity” Theme Note.\n\nburnt offering: 見4:3和5:17-19的注釋.");
  });

  it("stores each reference with its label, marking study-note references", () => {
    expect(parsed.cross_refs.map(ref => ref.label)).toEqual(["出27:21", "第16章", "羅3:25", "8:3", "4:3", "5:17-19"]);
    expect(parsed.cross_refs[0]).toMatchObject({ book: "出埃及記", chapter: 27, verse: 21, note: true });
    expect(parsed.cross_refs[1]).toMatchObject({ book: "利未記", chapter: 16, verse: null });
    expect(parsed.cross_refs[3]).toMatchObject({ book: "羅馬書", chapter: 8, verse: 3 });
    expect(parsed.cross_refs[3].note).toBeUndefined();
    expect(parsed.cross_refs[4].note).toBe(true);
    expect(parsed.cross_refs[5].note).toBe(true);
  });

  it("joins excerpts split around the divine name, and marks heading excerpts", () => {
    expect(mergeExcerptSpans('<span class="sn-excerpt">The</span> <span class="sn-excerpt-divine-name">Lord</span><span class="sn-excerpt"> said</span>'))
      .toBe('<span class="sn-excerpt">The Lord said</span>');
    expect(parsed.excerpts).toEqual([{ en: "The Lord called to Moses", heading: true }, { en: "burnt offering", heading: true }]);
    expect(parsed.original_words).toEqual([{ lang: "hebrew", text: "‘olah" }]);
  });

  it("fingerprints the raw body and reads the release", () => {
    expect(parsed.source_hash).toBe(sourceHashOf(BODY));
    expect(sourceHashOf(BODY)).not.toBe(sourceHashOf(BODY.replace("Moses", "Aaron")));
    expect(sourceHashOf("<p> a </p>")).toBe(sourceHashOf("<p>  a\n</p>"));
    expect(tosnReleaseOf(XML)).toBe("TOSN 1.25");
  });

  it("records the end chapter of cross-chapter notes", () => {
    expect(parseTosnRef("Lev.1.1-7.38", "Lev")).toMatchObject({ verse_end: 1, chapter_end: 7, chapter_end_verse: 38 });
    expect(parseTosnRef("Lev.1.3-17", "Lev").chapter_end).toBeUndefined();
    expect(noteVerses({ chapter: 1, verse_start: 16, verse_end: 16, chapter_end: 2, chapter_end_verse: 2 }, [17, 16]))
      .toEqual([{ chapter: 1, verse: 16 }, { chapter: 1, verse: 17 }, { chapter: 2, verse: 1 }, { chapter: 2, verse: 2 }]);
  });

  it("clears a translation whose source changed, keeping the old one aside", () => {
    const [note] = parseTosnStudyNotes(XML, "Lev");
    const unchanged = mergeTranslations([note], [{ ref: note.ref, zh: "舊", source_hash: note.source_hash }]);
    expect(unchanged[0].zh).toBe("舊");
    const legacy = mergeTranslations([note], [{ ref: note.ref, zh: "舊" }]);
    expect(legacy[0].zh).toBe("舊");
    const changed = mergeTranslations([note], [{ ref: note.ref, zh: "舊", source_hash: "0".repeat(64) }]);
    expect(changed[0]).toMatchObject({ zh: "", zh_previous: "舊" });
    expect(() => buildImportSql({ book: "利未記", notes: changed })).toThrow("還有 1 則沒有譯文");
  });
});

describe("aligning a translation (#542)", () => {
  const verse = { text: "人的肉皮上若長了癤子，或長了癬，或長了火斑，就要將他帶到亞倫作祭司的一個子孫面前。", words: [{ word: "火斑", strong: "H934" }, { word: "子孫", strong: "H1121" }] };
  const lexicon = { H934: { gloss: "a whitish spot on the skin", kjv: "bright spot" }, H1121: { gloss: "a son", kjv: "son" } };
  const note = {
    chapter: 13, verse_start: 2, verse_end: 2,
    excerpts: [{ en: "discolored skin", heading: false }, { en: "one of his sons", heading: true }, { en: "kidneys . . . liver", heading: false }],
    zh: "例如「火斑」。\n\n「亞倫作祭司的一個子孫」：後代也一樣。"
  };

  it("pairs heading excerpts in order and the rest by Strong's meaning; unmatched stay empty", () => {
    const excerpts = fillExcerptPhrases(note, () => verse, [], { lexicon });
    expect(excerpts[0]).toMatchObject({ zh: "火斑", chapter: 13, verse: 2 });
    expect(excerpts[1]).toMatchObject({ zh: "亞倫作祭司的一個子孫", heading: true });
    expect(excerpts[2].zh).toBeUndefined();
  });

  it("needs every part of an ellipsis phrase in the same verse, and falls back to the glossary", () => {
    const liver = { text: "兩個腰子和腰子上的脂油，與肝上的網子。", words: [] };
    const result = fillExcerptPhrases({ chapter: 3, verse_start: 4, verse_end: 4, excerpts: [{ en: "kidneys . . . liver", heading: true }, { en: "The fat", heading: false }], zh: "「腰子……肝上的網子」：說明。脂油要燒掉。" },
      () => liver, [], { glossary: { terms: [{ en: "fat", zh: "脂油" }] } });
    expect(result[0].zh).toBe("腰子……肝上的網子");
    expect(result[1].zh).toBe("脂油");
    expect(fillExcerptPhrases({ ...note, zh: "沒有引號" }, () => verse, [])[0].zh).toBeUndefined();
  });

  it("finds how the translator wrote each reference", () => {
    const ref = (book, label) => ({ book, chapter: 1, verse: 1, chapter_end: 1, verse_end: 1, label });
    expect(refLabelVariants(ref("利未記", "6:27"), "利未記", BOOKS)).toContain("利6:27");
    expect(refLabelVariants(ref("約翰一書", "約一1:8-9"), "利未記", BOOKS)).toContain("約壹1:8–9");
    const aligned = alignRefLabels({
      zh: "見利6:27；約壹1:8-9；出埃及記28–29章；11–15章；民35:19-21。",
      cross_refs: [ref("利未記", "6:27"), ref("約翰一書", "約一1:8-9"), ref("出埃及記", "出28–29章"), ref("利未記", "第11–15章"), ref("民數記", "民35:19-21"), ref("民數記", "民9:9")]
    }, BOOKS, "利未記");
    expect(aligned.map(item => item.label)).toEqual(["利6:27", "約壹1:8-9", "出埃及記28–29章", "11–15章", "民35:19-21", "民9:9"]);
  });
});

describe("structure columns in the import SQL (#542)", () => {
  const note = {
    ref: "Lev.1.1-7.38", chapter: 1, verse_start: 1, verse_end: 1, cross_chapter: true, chapter_end: 7, chapter_end_verse: 38,
    title: "1:1–7:38 總覽", zh: "總覽", en: "Overview", source_hash: "a".repeat(64),
    cross_refs: [{ book: "出埃及記", chapter: 27, verse: 21, chapter_end: 27, verse_end: 21, label: "出27:21" }],
    excerpts: [{ en: "The Lord's", zh: "耶和華的", chapter: 1, verse: 1, heading: true }, { en: "skip", heading: false }]
  };
  const file = { book: "利未記", sourceVersion: "TOSN 1.25", notes: [note, { ref: "Lev.1.2", chapter: 1, verse_start: 2, verse_end: 2, zh: "二", en: "two", cross_refs: [], excerpts: [] }] };

  it("inserts end chapter, references, translated excerpts, version and fingerprint", () => {
    const sql = buildImportSql(file);
    expect(sql).toContain("chapter_end, chapter_end_verse, cross_refs, excerpts, source_version, source_hash)");
    expect(sql).toContain(`'TOSN:Lev.1.1-7.38', FALSE, 'pending', 7, 38, '[{"book":"出埃及記","chapter":27,"verse":21,"chapter_end":27,"verse_end":21,"label":"出27:21"}]'::jsonb, '[{"en":"The Lord''s","zh":"耶和華的","chapter":1,"verse":1,"heading":true}]'::jsonb, 'TOSN 1.25', '${"a".repeat(64)}'`);
    expect(sql).toContain("'TOSN:Lev.1.2', FALSE, 'pending', NULL, NULL, '[]'::jsonb, '[]'::jsonb, 'TOSN 1.25', ''");
  });

  it("backfills only the new columns of rows that already exist, never the translation or review state", () => {
    const sql = buildStructureUpdateSql(file);
    const setClause = sql.match(/SET([\s\S]*?)FROM/)[1];
    for (const column of ["chapter_end", "chapter_end_verse", "cross_refs", "excerpts", "source_version", "source_hash"]) expect(setClause).toContain(`${column} =`);
    for (const column of ["content", "title", "review_status", "is_published", "source_text"]) expect(setClause).not.toMatch(new RegExp(`\\b${column}\\s*=`));
    expect(sql).toContain("chapter_end = v.chapter_end::integer");
    expect(sql).not.toMatch(/INSERT/);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });
});

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

describe("translation reference sources (#542)", () => {
  it("reads 和合本 words with their Strong's numbers, skipping morphology, prefixes and untranslated words", () => {
    const parsed = parseStrongText("成了<WAH01961><WTH8804>大痲瘋<WH06883>的災病<WAH09001><WH05061>，{<WAH0413>}亞倫<WH0175>");
    expect(parsed.text).toBe("成了大痲瘋的災病，亞倫");
    expect(parsed.words).toEqual([{ word: "成了", strong: "H1961" }, { word: "大痲瘋", strong: "H6883" }, { word: "的災病", strong: "H5061" }, { word: "亞倫", strong: "H175" }]);
    expect(parseStrongText("神<WG2316>愛<WG25>世人").words).toEqual([{ word: "神", strong: "G2316" }, { word: "愛", strong: "G25" }]);
    expect(parseStrongText("a")).toEqual({ text: "（併於上節）", words: [] });
  });

  it("reads 當代譯本 USFM without headings, footnotes or character markers, keeping combined verses", () => {
    const verses = parseUsfmBook("\\id LEV\n\\h 利未記\n\\c 1\n\\s1 標題\n\\p\n\\v 1 耶和華呼喚\\pn 摩西\\pn*，\n\\v 2 說\\f + \\fr 1:2 \\ft 註\\f*：\n\\q1 詩句\n\\c 2\n\\v 3-4 合併的節");
    expect(verses.get("1:1")).toBe("耶和華呼喚摩西，");
    expect(verses.get("1:2")).toBe("說：詩句");
    expect(verses.get("2:3")).toBe("（3-4節）合併的節");
    expect(verses.get("2:4")).toBe("（3-4節）合併的節");
    expect(USFM_BOOK_CODES).toHaveLength(66);
    expect(USFM_BOOK_CODES[2]).toBe("LEV");
  });

  it("unzips stored and deflated entries without an external tool", () => {
    const entries = readZipEntries(buildZip({ "04-LEVcmncbt.usfm": "\\c 1", "copr.htm": "x" }), name => name.endsWith(".usfm"));
    expect(Array.from(entries.keys())).toEqual(["04-LEVcmncbt.usfm"]);
    expect(entries.get("04-LEVcmncbt.usfm").toString()).toBe("\\c 1");
    expect(() => readZipEntries(Buffer.from("not a zip at all, definitely"))).toThrow("不是 zip 檔");
  });

  it("matches TOSN transliterations to the Strong's numbers found in the verses", () => {
    expect(normalizeTranslit("tsara‘at")).toBe(normalizeTranslit("tsâraʻath"));
    expect(normalizeTranslit("mashiakh")).toBe(normalizeTranslit("mâshîyach"));
    expect(translitSimilarity("‘olah", "ʻôlâh")).toBe(1);
    const lexicon = parseLexiconScript('var x = {"H6883":{"xlit":"tsâraʻath","strongs_def":"leprosy"},"H5061":{"xlit":"negaʻ","strongs_def":"a blow"},"G26":{"translit":"agápē"}}; module.exports = x;');
    const candidates = new Map([["H6883", ["大痲瘋"]], ["H5061", ["的災病"]], ["G26", ["愛"]]]);
    const entries = Object.fromEntries(Object.entries(lexicon).map(([key, entry]) => [key, { xlit: entry.xlit || entry.translit, gloss: entry.strongs_def || "" }]));
    expect(matchOriginalWords([{ lang: "hebrew", text: "tsara‘at" }, { lang: "hebrew", text: "ha-nega‘" }, { lang: "hebrew", text: "shalom" }, { lang: "greek", text: "agapē" }], candidates, entries))
      .toEqual([
        { translit: "tsara‘at", strong: "H6883", xlit: "tsâraʻath", gloss: "leprosy", cuv: ["大痲瘋"] },
        { translit: "ha-nega‘", strong: "H5061", xlit: "negaʻ", gloss: "a blow", cuv: ["的災病"] },
        { translit: "shalom", strong: null },
        { translit: "agapē", strong: "G26", xlit: "agápē", gloss: "", cuv: ["愛"] }
      ]);
  });
});

describe("translation input file (#542)", () => {
  const cuv = new Map([[13, new Map([[2, { text: "成了大痲瘋的災病", words: [{ word: "大痲瘋", strong: "H6883" }] }], [3, { text: "祭司要察看", words: [] }]])]]);
  const ccb = new Map([["13:2", "出現痲瘋病症狀"], ["13:3", "祭司要檢查"]]);
  const lexicon = { H6883: { xlit: "tsâraʻath", gloss: "leprosy" } };
  const glossary = { terms: [{ en: "priest", zh: "祭司" }, { en: "serious skin disease", zh: "大痲瘋", translit: "tsara‘at", strong: "H6883" }, { en: "altar", zh: "壇" }] };
  const note = {
    ref: "Lev.13.2-3", range: "13:2-3", chapter: 13, verse_start: 2, verse_end: 3, en: "The priests saw tsara‘at.", prepared: "The priests saw tsara‘at (見出27:21的注釋).",
    excerpts: [{ en: "swelling", heading: false }], original_words: [{ lang: "hebrew", text: "tsara‘at" }], zh: ""
  };

  it("attaches each verse's 和合本, Strong's words and 當代譯本, the matched original words and the glossary", () => {
    const input = buildNoteInput(note, { cuv, ccb, lexicon, glossary, verseCounts: [] });
    expect(input.en).toBe(note.prepared);
    expect(input.verses).toEqual([
      { ref: "13:2", cuv: "成了大痲瘋的災病", ccb: "出現痲瘋病症狀", strongs: "大痲瘋=H6883" },
      { ref: "13:3", cuv: "祭司要察看", ccb: "祭司要檢查", strongs: "" }
    ]);
    expect(input.original_words[0]).toMatchObject({ translit: "tsara‘at", strong: "H6883", cuv: ["大痲瘋"] });
    expect(input.glossary.map(term => term.zh)).toEqual(["祭司", "大痲瘋"]);
    expect(glossaryHits({ en: "the altars", original_words: [] }, glossary).map(term => term.zh)).toEqual(["壇"]);
  });

  it("attaches only the first verse of a long range, and skips translated notes unless --all", () => {
    const counts = Array(13).fill(60);
    const long = buildNoteInput({ ...note, verse_start: 1, verse_end: 59 }, { cuv, ccb, lexicon, glossary, verseCounts: counts });
    expect(long.verses).toHaveLength(1);
    expect(long.verses_note).toContain("20");
    const file = { book: "利未記", sourceVersion: "TOSN 1.25", notes: [note, { ...note, ref: "Lev.13.4", zh: "已翻" }] };
    expect(buildTranslationInput(file, { cuv, ccb, lexicon, glossary }).notes.map(item => item.ref)).toEqual(["Lev.13.2-3"]);
    const all = buildTranslationInput(file, { cuv, ccb, lexicon, glossary }, { all: true });
    expect(all.notes).toHaveLength(2);
    expect(all.notices.join("")).toContain("CC BY-SA 4.0");
    expect(all.instructions.join("")).toContain("align.mjs");
  });

  it("proposes glossary entries only for new Strong's numbers, flagged for review", () => {
    const input = { notes: [{ ref: "Lev.1.2", original_words: [{ translit: "qorban", strong: "H7133", cuv: ["供物"], gloss: "offering" }, { translit: "tsara‘at", strong: "H6883", cuv: ["大痲瘋"] }, { translit: "x", strong: null }] }] };
    expect(glossaryCandidates(input, glossary, "利未記")).toEqual([
      { translit: "qorban", strong: "H7133", zh: "供物", gloss: "offering", ref: "Lev.1.2", source: "strongs:利未記", auto: true }
    ]);
    const text = serializeGlossary({ description: "d", terms: [{ en: "a", zh: "甲", auto: true }] });
    expect(JSON.parse(text)).toEqual({ description: "d", terms: [{ en: "a", zh: "甲", auto: true }] });
    expect(text).toContain('    { "en": "a", "zh": "甲", "auto": true }');
  });
});

describe("glossary file (#542)", () => {
  const glossary = JSON.parse(readFileSync("content/commentary/glossary.json", "utf8"));

  it("has a Chinese rendering and an English or transliterated key for every term, without duplicates", () => {
    const keys = new Set();
    for (const term of glossary.terms) {
      expect(String(term.zh || "").trim(), JSON.stringify(term)).not.toBe("");
      expect(Boolean(term.en || term.translit), JSON.stringify(term)).toBe(true);
      if (term.strong) expect(term.strong).toMatch(/^[HG]\d+$/);
      const key = (term.en || term.translit).toLowerCase();
      expect(keys.has(key), key).toBe(false);
      keys.add(key);
    }
    expect(glossary.terms.find(term => term.en === "Tabernacle").zh).toBe("會幕");
    expect(glossary.terms.find(term => term.strong === "H6883").zh).toBe("大痲瘋");
  });
});

describe("export from the database (#542)", () => {
  it("selects imported rows of one book in Bible order, reviewed ones by default", () => {
    const sql = buildExportSql("利未記");
    expect(sql).toContain("WHERE book = '利未記'");
    expect(sql).toContain("AND source_ref LIKE 'TOSN:%'");
    expect(sql).toContain("AND review_status IN ('approved', 'published')");
    expect(sql).toContain("ORDER BY chapter, verse_start, verse_end, source_ref;");
    expect(sql).toContain("'zh', content");
    expect(buildExportSql("O'Book", ["pending"])).toContain("WHERE book = 'O''Book'");
  });

  it("writes the licence, statuses and notes, accepting JSON text or objects from the CLI", () => {
    const file = buildExportFile("利未記", [{ note: { ref: "Lev.1.1", zh: "甲", source_version: "TOSN 1.25" } }, { note: '{"ref":"Lev.1.2","zh":"乙","source_version":"TOSN 1.25"}' }],
      { exportedAt: "2026-10-19T00:00:00.000Z", projectRef: "aaaaaaaaaaaaaaaaaaaa" });
    expect(file).toMatchObject({ book: "利未記", statuses: ["approved", "published"], sourceVersions: ["TOSN 1.25"], exportedAt: "2026-10-19T00:00:00.000Z" });
    expect(file.notes.map(note => note.zh)).toEqual(["甲", "乙"]);
    expect(file.license).toContain("CC BY-SA 4.0");
    expect(file.attribution).toBe(TOSN_ATTRIBUTION);
  });
});

describe("#542 migration", () => {
  const migration = readFileSync("supabase/migrations/20261019094508_commentary_import_structure.sql", "utf8").replace(/\r\n/g, "\n");

  it("only adds columns, keeps the index view's columns, and updates the review JSON with explicit grants", () => {
    for (const column of ["chapter_end INTEGER", "chapter_end_verse INTEGER", "cross_refs JSONB NOT NULL DEFAULT '[]'::jsonb", "excerpts JSONB NOT NULL DEFAULT '[]'::jsonb", "source_version TEXT NOT NULL DEFAULT ''", "source_hash TEXT NOT NULL DEFAULT ''"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).not.toMatch(/DROP COLUMN|ALTER COLUMN|DROP TABLE|DROP VIEW/);
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("generate_series(c.chapter + 1, c.chapter_end)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.commentary_chapter_index FROM PUBLIC, anon;");
    const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(match => match[1]);
    expect(functions).toEqual(["_commentary_review_item_json"]);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._commentary_review_item_json(public.passage_commentary) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public._commentary_review_item_json(public.passage_commentary) TO service_role;");
    for (const key of ["chapter_end", "chapter_end_verse", "cross_refs", "excerpts", "source_version", "content", "review_status"]) expect(migration).toContain(`'${key}', c.${key}`);
  });
});
