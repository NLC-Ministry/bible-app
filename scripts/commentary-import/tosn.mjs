// Tyndale Open Study Notes（TOSN）匯入工具的共用函式（#471、#476、#542）。
// - parseTosnStudyNotes：從 StudyNotes.xml 取出某一卷的節注釋：英文原文（給審核者對照）、
//   給譯者的預處理稿（交叉引用已換成和合本縮寫、固定句型已換成中文）、結構化交叉引用、
//   被解釋的經文片語、原文字拼音、原文指紋。
// - mergeTranslations：重新取出時保留已經翻好的中文；原文指紋變了的那幾則清空等重翻。
// - fillExcerptPhrases：從譯文裡找出片語用的和合本字句（「…」且出現在那幾節的和合本裡）。
// - buildImportSql／buildStructureUpdateSql：匯入 SQL；補結構只更新新欄位，不動譯文與審核狀態。
// 授權：TOSN 是 CC BY-SA 4.0，翻譯是衍生著作，必須標示改編自 TOSN 並註明做了什麼改動。

import { createHash } from "node:crypto";
import { TOSN_BOOK_CODES, loadBibleBooks } from "./tosn-books.mjs";
import { describeAnchor, formatRefLabel, parseBref, repairRefFromAnchor, toStoredRef } from "./refs.mjs";
import { findRefLabelRanges } from "../../js/data/passage-commentary.mjs";

export { TOSN_BOOK_CODES };

export const TOSN_ATTRIBUTION = "改編自 Tyndale Open Study Notes（© 2022 Tyndale House Publishers，CC BY-SA 4.0，原著免費提供於 tyndaleopenresources.com），由新生命教會譯為繁體中文，經文與用詞對照和合本並略作調整。";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&#39;": "'", "&nbsp;": " " };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, entity => ENTITIES[entity] || entity);
}

function xmlToText(xml) {
  return decodeEntities(String(xml || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function paragraphsOf(bodyXml) {
  return Array.from(String(bodyXml || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g), match =>
    match[1].replace(/<span class="sn-ref">[\s\S]*?<\/span>/, ""));
}

// 一則注釋的 <body>：每個 <p> 一段；開頭的經文出處（sn-ref）拿掉，其餘標籤只留文字。
export function studyNoteBodyToText(bodyXml) {
  return paragraphsOf(bodyXml).map(xmlToText).filter(Boolean).join("\n\n");
}

// 從 start（指向 <span ...>）開始找對應的 </span>（片語裡還會有 divine-name 之類的 span）。
function spanEnd(xml, start) {
  const pattern = /<span\b[^>]*>|<\/span>/g;
  pattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = pattern.exec(xml))) {
    depth += match[0] === "</span>" ? -1 : 1;
    if (depth === 0) return pattern.lastIndex;
  }
  return xml.length;
}

function spansOfClass(xml, className) {
  const results = [];
  const opener = new RegExp(`<span class="${className}">`, "g");
  let match;
  while ((match = opener.exec(xml))) {
    const end = spanEnd(xml, match.index);
    results.push(xmlToText(xml.slice(match.index, end)));
    opener.lastIndex = end;
  }
  return results;
}

// 「The <divine-name>Lord</divine-name> called to Moses」在 XML 裡被拆成三個 span：
// 把神的名字併進片語，再把只隔著空白的片語接起來，才是完整的一句。
export function mergeExcerptSpans(xml) {
  let merged = String(xml || "").replace(/<span class="sn-excerpt-divine-name">([^<]*)<\/span>/g, '<span class="sn-excerpt">$1</span>');
  const adjacent = /(<span class="sn-excerpt">[^<]*)<\/span>(\s*)<span class="sn-excerpt">/;
  while (adjacent.test(merged)) merged = merged.replace(adjacent, "$1$2");
  return merged;
}

export function sourceHashOf(bodyXml) {
  return createHash("sha256").update(String(bodyXml || "").replace(/\s+/g, " ").trim()).digest("hex");
}

export function tosnReleaseOf(xml) {
  const release = String(xml || "").match(/<items\b[^>]*\brelease="([^"]+)"/)?.[1];
  return release ? `TOSN ${release}` : "TOSN";
}

const TOKEN = /⟦(\d+)⟧/g;
const token = index => `⟦${index}⟧`;
const TOKEN_LIST = "⟦\\d+⟧(?:(?:\\s*[,;]\\s*|\\s*,?\\s+and\\s+)⟦\\d+⟧)*";

// 預處理稿裡的固定句型（不交給 AI）。
const FIXED_PHRASES = [
  [/\bcp\.\s*/g, "參"],
  [/\bcf\.\s*/g, "參"],
  [/\be\.g\.,?\s*/g, "例如"],
  [/\bi\.e\.,?\s*/g, "也就是"]
];

function joinTokenList(list) {
  return list.replace(/\s*,?\s+and\s+/g, "和").replace(/\s*[,;]\s*/g, "、");
}

// 一則注釋 → 英文原文、預處理稿、交叉引用、片語、原文字。books：BIBLE_BOOKS（要有 abbrev）。
export function parseStudyNoteBody(bodyXml, { books = loadBibleBooks() } = {}) {
  const anchors = [];
  const paragraphs = [];
  const excerpts = [];
  const words = [];
  for (const paragraph of paragraphsOf(bodyXml)) {
    for (const text of spansOfClass(mergeExcerptSpans(paragraph), "sn-excerpt")) {
      const phrase = text.replace(/[\s:,;.]+$/, "");
      if (phrase) excerpts.push({ en: phrase, heading: /:\s*$/.test(text) });
    }
    for (const lang of ["hebrew", "greek", "aramaic"]) {
      for (const text of spansOfClass(paragraph, lang)) {
        const word = text.replace(/[\s,;.]+$/, "");
        if (word) words.push({ lang, text: word });
      }
    }
    const tokenized = paragraph.replace(/<a href="\?(bref|item)=([^"]+)">([\s\S]*?)<\/a>/g, (whole, kind, target, inner) => {
      let text = xmlToText(inner);
      if (kind === "item" && !/_StudyNote_Filament$/.test(target)) return text; // 主題文章、人物檔案：照原文
      const notePhrase = /^study notes? on\s+/i.test(text);
      if (notePhrase) text = text.replace(/^study notes? on\s+/i, "");
      const ref = repairRefFromAnchor(parseBref(kind === "item" ? target.replace(/_StudyNote_Filament$/, "") : target), text);
      if (!ref) return text;
      anchors.push({ ref, text, notePhrase, note: kind === "item" });
      return token(anchors.length - 1);
    });
    const text = xmlToText(tokenized);
    if (text) paragraphs.push(text);
  }

  let prepared = paragraphs.join("\n\n");
  prepared = prepared.replace(new RegExp(`\\b(see\\s+(?:also\\s+)?)?(?:the\\s+)?study notes? on\\s+(${TOKEN_LIST})`, "gi"), (_, see, list) => {
    for (const [, index] of list.matchAll(TOKEN)) anchors[index].note = true;
    return `${see ? "見" : ""}${joinTokenList(list)}的注釋`;
  });
  prepared = prepared.replace(/(\bsee\s+(?:also\s+)?)?⟦(\d+)⟧/g, (whole, see, index) =>
    anchors[index].notePhrase ? `${see ? "見" : ""}${token(index)}的注釋` : whole);
  for (const [pattern, replacement] of FIXED_PHRASES) prepared = prepared.replace(pattern, replacement);

  const crossRefs = [];
  prepared = prepared.replace(/(\bchs?\.?\s+)?⟦(\d+)⟧/g, (_, chapterWord, index) => {
    const anchor = anchors[index];
    const label = formatRefLabel(anchor.ref, anchor.text, books, { chapterBefore: Boolean(chapterWord) });
    crossRefs.push(toStoredRef(anchor.ref, label, books, { note: anchor.note }));
    return `${describeAnchor(anchor.text).lead}${label}`;
  });
  prepared = prepared.replace(/\s+•\s+/g, "\n\n").replace(/^•\s+/gm, "");

  return {
    en: studyNoteBodyToText(bodyXml),
    prepared,
    cross_refs: crossRefs,
    excerpts,
    original_words: words,
    source_hash: sourceHashOf(bodyXml)
  };
}

// "Lev.1.3-17" → 同一章；"Lev.1.1-7.38" → 跨章：掛在起始節（verse_end = verse_start，舊版前端照舊），
// 結束章／結束節另存 chapter_end／chapter_end_verse（#542），閱讀器在整段都看得到。
export function parseTosnRef(ref, bookCode) {
  const match = String(ref || "").match(new RegExp(`^${bookCode}\\.(\\d+)\\.(\\d+)(?:-(?:(\\d+)\\.)?(\\d+))?$`));
  if (!match) return null;
  const chapter = Number(match[1]);
  const verseStart = Number(match[2]);
  const endChapter = match[3] ? Number(match[3]) : chapter;
  const verseEnd = match[4] ? Number(match[4]) : verseStart;
  if (endChapter !== chapter) {
    return {
      chapter, verse_start: verseStart, verse_end: verseStart, cross_chapter: true,
      chapter_end: endChapter, chapter_end_verse: verseEnd,
      range: `${chapter}:${verseStart}–${endChapter}:${verseEnd}`
    };
  }
  return {
    chapter, verse_start: verseStart, verse_end: verseEnd, cross_chapter: false,
    range: verseStart === verseEnd ? `${chapter}:${verseStart}` : `${chapter}:${verseStart}-${verseEnd}`
  };
}

export function parseTosnStudyNotes(xml, bookCode, { books = loadBibleBooks() } = {}) {
  const notes = [];
  const pattern = new RegExp(`<item name="(${bookCode}\\.[^"]+)"[^>]*>[\\s\\S]*?<body>([\\s\\S]*?)<\\/body>`, "g");
  for (const match of String(xml || "").matchAll(pattern)) {
    const position = parseTosnRef(match[1], bookCode);
    if (!position) throw new Error(`看不懂的經文範圍：${match[1]}`);
    notes.push({ ref: match[1], ...position, ...parseStudyNoteBody(match[2], { books }) });
  }
  return notes;
}

// 重新取出時保留已經翻好的中文（依 ref 對應）與片語的中文。
// 原文指紋變了（TOSN 改版改了這則）→ 譯文清空、舊譯文留在 zh_previous，build-sql 會停下來等重翻。
// 舊檔沒有指紋（#471 的利未記）就當作沒變。
export function mergeTranslations(extracted, existing) {
  const previous = new Map((existing || []).map(note => [note.ref, note]));
  return extracted.map(note => {
    const old = previous.get(note.ref);
    const changed = Boolean(old?.source_hash && note.source_hash && old.source_hash !== note.source_hash && String(old.zh || "").trim());
    const oldExcerpts = changed ? [] : (old?.excerpts || []);
    const excerpts = (note.excerpts || []).map((excerpt, index) => {
      const match = oldExcerpts[index]?.en === excerpt.en ? oldExcerpts[index] : oldExcerpts.find(item => item.en === excerpt.en);
      return match?.zh ? { ...excerpt, zh: match.zh, chapter: match.chapter, verse: match.verse } : excerpt;
    });
    const merged = {
      ...note,
      excerpts,
      title: old?.title ?? (note.cross_chapter ? `${note.range} 總覽` : ""),
      zh: changed ? "" : (old?.zh ?? "")
    };
    if (changed) merged.zh_previous = old.zh;
    else if (old?.zh_previous) merged.zh_previous = old.zh_previous;
    return merged;
  });
}

// 這則注釋涵蓋的節（跨章的話每一章都算），verseCounts：該卷每章節數。
export function noteVerses(note, verseCounts = []) {
  const lastChapter = note.chapter_end || note.chapter;
  const lastVerse = note.chapter_end ? note.chapter_end_verse : note.verse_end;
  const verses = [];
  for (let chapter = note.chapter; chapter <= lastChapter; chapter += 1) {
    const from = chapter === note.chapter ? note.verse_start : 1;
    const to = chapter === lastChapter ? lastVerse : (verseCounts[chapter - 1] || from);
    for (let verse = from; verse <= to; verse += 1) verses.push({ chapter, verse });
  }
  return verses;
}

const TRAILING_PUNCTUATION = /[\s，。、：；！？,.:;!?…]+$/;

const ELLIPSIS = /\s*(?:……|…|\.\s?\.\s?\.)\s*/;
const STOPWORDS = new Set("the a an of to and or his her their its he she it they them is was were be been in on for with from by at as that this these those you your will shall not all any one who which what into upon".split(" "));

function englishStems(text) {
  return new Set(String(text || "").toLowerCase().split(/[^a-z]+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .map(word => word.replace(/(?:ings?|ed|es|s)$/, "").slice(0, 5))
    .filter(stem => stem.length > 2));
}

// 片語的中文＝譯文裡用「」框起來、又真的出現在這則經文範圍和合本裡的字句（「腰子……肝上的網子」每一段
// 都要在同一節裡）。英文片語跟「」字句怎麼配：
// 1. 段首的標題片語（英文接冒號、中文「…」：）數量一樣就依序配；
// 2. 其餘的：字句裡和合本用詞的 Strong's 字義（詞典）跟英文片語有相同的字，或用語表的對照吻合 → 分數高的先配；
// 3. 還沒配到的英文片語：用語表裡英文吻合、中文同時出現在那幾節和合本與譯文的，就用那個詞。
// 配不到的就不填（閱讀器只是不加粗），寧缺勿錯。
// cuvVerse(chapter, verse) 回傳 { text, words: [{ word, strong }] }（或純文字）。
export function fillExcerptPhrases(note, cuvVerse, verseCounts = [], { lexicon = null, glossary = null } = {}) {
  const excerpts = (note.excerpts || []).map(excerpt => ({ ...excerpt }));
  const zh = String(note.zh || "");
  if (!excerpts.length || !zh.trim()) return excerpts;
  const verses = noteVerses(note, verseCounts).map(position => {
    const verse = cuvVerse(position.chapter, position.verse);
    return typeof verse === "string" || !verse
      ? { ...position, text: String(verse || ""), words: [] }
      : { ...position, text: String(verse.text || ""), words: verse.words || [] };
  });
  const terms = (glossary?.terms || []).filter(term => term.en && term.zh);
  const termsIn = text => terms.filter(term => new RegExp(`(^|[^a-z])${term.en.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(String(text).toLowerCase()));

  const candidates = [];
  for (const match of zh.matchAll(/「([^「」]{1,80})」(：)?/g)) {
    const phrase = match[1].replace(TRAILING_PUNCTUATION, "");
    const parts = phrase.split(ELLIPSIS).filter(Boolean);
    const found = parts.length ? verses.find(position => parts.every(part => position.text.includes(part))) : null;
    if (!found || candidates.some(candidate => candidate.phrase === phrase)) continue;
    const glosses = found.words
      .filter(item => parts.some(part => part.includes(item.word) || item.word.includes(part)))
      // KJV 譯法清單太長的（hayah、asah 之類的常用動詞）只看字義，免得什麼都配得上。
      .map(item => {
        const entry = lexicon?.[item.strong];
        return `${entry?.gloss || ""} ${entry?.kjv && entry.kjv.length <= 120 ? entry.kjv : ""}`;
      })
      .join(" ");
    candidates.push({ phrase, parts, heading: Boolean(match[2]), chapter: found.chapter, verse: found.verse, stems: englishStems(glosses), order: candidates.length, used: false });
  }
  const assign = (excerpt, candidate) => {
    candidate.used = true;
    excerpt.zh = candidate.phrase;
    excerpt.chapter = candidate.chapter;
    excerpt.verse = candidate.verse;
  };
  const score = (excerpt, candidate) => {
    let points = 0;
    for (const stem of englishStems(excerpt.en)) if (candidate.stems.has(stem)) points += 1;
    for (const term of termsIn(excerpt.en)) if (candidate.parts.some(part => part.includes(term.zh) || term.zh.includes(part))) points += 2;
    return points;
  };

  // 段首的標題片語（英文接冒號、中文「…」：）順序可靠：數量一樣就先依序配。
  const headings = excerpts.filter(excerpt => excerpt.heading);
  const headingCandidates = candidates.filter(candidate => candidate.heading);
  if (headings.length && headings.length === headingCandidates.length) {
    headings.forEach((excerpt, index) => assign(excerpt, headingCandidates[index]));
  }

  const pairs = [];
  excerpts.forEach((excerpt, index) => {
    if (excerpt.zh) return;
    for (const candidate of candidates) {
      const points = score(excerpt, candidate);
      if (points > 0) pairs.push({ excerpt, candidate, points: points + (excerpt.heading === candidate.heading ? 0.5 : 0), distance: Math.abs(index - candidate.order) });
    }
  });
  pairs.sort((a, b) => b.points - a.points || a.distance - b.distance);
  for (const { excerpt, candidate } of pairs) {
    if (!excerpt.zh && !candidate.used) assign(excerpt, candidate);
  }

  for (const excerpt of excerpts) {
    if (excerpt.zh) continue;
    for (const term of termsIn(excerpt.en).sort((a, b) => b.zh.length - a.zh.length)) {
      const found = zh.includes(term.zh) ? verses.find(position => position.text.includes(term.zh)) : null;
      if (!found) continue;
      excerpt.zh = term.zh;
      excerpt.chapter = found.chapter;
      excerpt.verse = found.verse;
      break;
    }
  }
  return excerpts;
}

// 出處標籤的其他寫法：譯者可能寫「利6:27」而不是「6:27」、「11–15章」而不是「第11–15章」、
// 「出埃及記28章」、「約壹」，或把「-」寫成「–」。
const ALTERNATE_ABBREVIATIONS = Object.freeze({ "約一": "約壹", "約二": "約貳", "約三": "約參" });

export function refLabelVariants(ref, noteBook, books = loadBibleBooks()) {
  const book = books.find(item => item.name === ref.book);
  const abbrev = book?.abbrev || "";
  const transforms = [
    label => label.replace(/(\d)-(\d)/g, "$1–$2"),
    label => label.replace(/(\d)–(\d)/g, "$1-$2"),
    label => (label.startsWith("第") ? label.slice(1) : null),
    label => (abbrev && ref.book === noteBook && label.startsWith(abbrev) && /\d/.test(label[abbrev.length] || "") ? label.slice(abbrev.length) : null),
    label => (abbrev && ref.book === noteBook && /^\d+:/.test(label) ? `${abbrev}${label}` : null),
    label => (abbrev && label.startsWith(abbrev) && /\d/.test(label[abbrev.length] || "") ? `${ref.book}${label.slice(abbrev.length)}` : null),
    label => (ALTERNATE_ABBREVIATIONS[abbrev] && label.startsWith(abbrev) ? `${ALTERNATE_ABBREVIATIONS[abbrev]}${label.slice(abbrev.length)}` : null)
  ];
  const seen = [ref.label];
  for (let depth = 0; depth < 3; depth += 1) {
    for (const label of [...seen]) {
      for (const transform of transforms) {
        const next = transform(label);
        if (next && !seen.includes(next)) seen.push(next);
      }
    }
  }
  return seen;
}

// 把每個出處的 label 換成譯文裡實際的寫法（找不到就留原樣，閱讀器只是不做連結）。
// 好幾種寫法都找得到時取最長的：譯文寫「利6:27」，連結就包含「利」。
export function alignRefLabels(note, books = loadBibleBooks(), noteBook = "") {
  const content = String(note.zh || "");
  return (note.cross_refs || []).map(ref => {
    const found = refLabelVariants(ref, noteBook, books)
      .filter(label => findRefLabelRanges(content, label).length)
      .sort((a, b) => b.length - a.length)[0];
    return found && found !== ref.label ? { ...ref, label: found } : ref;
  });
}

// 譯完之後（或補結構時）：出處標籤對齊譯文、片語填上和合本字句。
// 片語重新配對：先清掉舊的中文（重跑 align 時才不會被上一次的錯配卡住）。
export function alignNote(note, { cuvVerse, verseCounts = [], books = loadBibleBooks(), book = "", lexicon = null, glossary = null } = {}) {
  if (!String(note.zh || "").trim()) return note;
  const fresh = { ...note, excerpts: (note.excerpts || []).map(({ en, heading }) => ({ en, heading })) };
  return {
    ...note,
    cross_refs: alignRefLabels(note, books, book),
    excerpts: fillExcerptPhrases(fresh, cuvVerse, verseCounts, { lexicon, glossary })
  };
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? []))}::jsonb`;
}

function sqlInt(value) {
  return Number.isInteger(Number(value)) && value !== null && value !== undefined ? String(Number(value)) : "NULL";
}

// 存進資料庫的片語：只留有中文的（閱讀器要用中文加粗、在經文裡標出）。
export function storedExcerpts(note) {
  return (note.excerpts || [])
    .filter(excerpt => String(excerpt.zh || "").trim())
    .map(excerpt => ({
      en: excerpt.en,
      zh: String(excerpt.zh).trim(),
      chapter: excerpt.chapter ?? note.chapter,
      verse: excerpt.verse ?? note.verse_start,
      heading: Boolean(excerpt.heading)
    }));
}

function structureValues(note, sourceVersion) {
  return {
    chapter_end: note.cross_chapter ? sqlInt(note.chapter_end) : "NULL",
    chapter_end_verse: note.cross_chapter ? sqlInt(note.chapter_end_verse) : "NULL",
    cross_refs: sqlJson(note.cross_refs || []),
    excerpts: sqlJson(storedExcerpts(note)),
    source_version: sqlString(note.source_version || sourceVersion || ""),
    source_hash: sqlString(note.source_hash || "")
  };
}

// 每 50 則一個 INSERT；source_ref 已存在就略過（重跑不會蓋掉審過的內容）。
export function buildImportSql(file, { batchSize = 50 } = {}) {
  const book = String(file?.book || "").trim();
  if (!book) throw new Error("缺少書卷名稱（book）");
  const notes = Array.isArray(file?.notes) ? file.notes : [];
  const missing = notes.filter(note => !String(note.zh || "").trim()).map(note => note.ref);
  if (missing.length) throw new Error(`還有 ${missing.length} 則沒有譯文：${missing.slice(0, 5).join("、")}${missing.length > 5 ? "…" : ""}`);
  const source = String(file.attribution || TOSN_ATTRIBUTION);
  const statements = [];
  for (let i = 0; i < notes.length; i += batchSize) {
    const values = notes.slice(i, i + batchSize).map(note => {
      const structure = structureValues(note, file.sourceVersion);
      return `  (${[
        sqlString(book), Number(note.chapter), Number(note.verse_start), Number(note.verse_end),
        sqlString(String(note.title || "").trim()), sqlString(String(note.zh).trim()), "'{}'::text[]",
        sqlString(source), sqlString(note.en || ""), sqlString(`TOSN:${note.ref}`), "FALSE", "'pending'",
        structure.chapter_end, structure.chapter_end_verse, structure.cross_refs, structure.excerpts,
        structure.source_version, structure.source_hash
      ].join(", ")})`;
    });
    statements.push(`INSERT INTO public.passage_commentary
  (book, chapter, verse_start, verse_end, title, content, topic_tags, source, source_text, source_ref, is_published, review_status,
   chapter_end, chapter_end_verse, cross_refs, excerpts, source_version, source_hash)
VALUES
${values.join(",\n")}
ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;`);
  }
  return `-- 經文注釋匯入：${book}（${notes.length} 則，Tyndale Open Study Notes 譯文，待審、未發布）\nBEGIN;\n${statements.join("\n\n")}\nCOMMIT;\n`;
}

// 已經匯入的書卷補上新結構（#542）：只更新結束章、交叉引用、片語、來源版本與指紋，
// 不動譯文、標題、審核狀態與發布狀態。用 source_ref 對應，資料庫沒有的列不會新增。
export function buildStructureUpdateSql(file) {
  const book = String(file?.book || "").trim();
  if (!book) throw new Error("缺少書卷名稱（book）");
  const notes = Array.isArray(file?.notes) ? file.notes : [];
  const rows = notes.map(note => {
    const structure = structureValues(note, file.sourceVersion);
    return `  (${[sqlString(`TOSN:${note.ref}`), structure.chapter_end, structure.chapter_end_verse,
      structure.cross_refs, structure.excerpts, structure.source_version, structure.source_hash].join(", ")})`;
  });
  return `-- 經文注釋補結構：${book}（${notes.length} 則；只更新新欄位，譯文與審核狀態不動）
BEGIN;
UPDATE public.passage_commentary AS c SET
  chapter_end = v.chapter_end::integer,
  chapter_end_verse = v.chapter_end_verse::integer,
  cross_refs = v.cross_refs,
  excerpts = v.excerpts,
  source_version = v.source_version,
  source_hash = v.source_hash
FROM (VALUES
${rows.join(",\n")}
) AS v (source_ref, chapter_end, chapter_end_verse, cross_refs, excerpts, source_version, source_hash)
WHERE c.source_ref = v.source_ref AND c.book = ${sqlString(book)};
COMMIT;
`;
}
