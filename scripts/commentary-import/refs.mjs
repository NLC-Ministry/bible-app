// TOSN 交叉引用（<a href="?bref=Exod.27.21">Exod 27:21</a>）→ 結構化經文出處＋和合本縮寫標籤（#542）。
// - parseBref：?bref= 的值 → { bookIndex, chapter, verse, chapter_end, verse_end, end_book_index? }。
// - formatRefLabel：照錨點文字的寫法轉成中文：「Exod 27:21」→「出27:21」、同卷只寫「7:8」、
//   只有節號「21」照寫、整章「Isa 53」→「賽53章」（詩篇用「篇」）、「ch 1」「Chapter 18」→「第1章」。
// 標籤也是閱讀器在譯文裡找出處、做成可點連結的依據，所以譯者要照抄（見 docs/commentary-import.md）。

import { TOSN_BOOK_CODES } from "./tosn-books.mjs";

// 條目名稱用 ISam、IIKgs；?bref= 用 1Sam、2Kgs。兩種都認。
const BOOK_INDEX_BY_CODE = new Map();
TOSN_BOOK_CODES.forEach((code, index) => {
  BOOK_INDEX_BY_CODE.set(code, index);
  const numbered = code.replace(/^(I{1,3})(?=[A-Z])/, roman => String(roman.length));
  BOOK_INDEX_BY_CODE.set(numbered, index);
});

export function tosnBookIndex(code) {
  return BOOK_INDEX_BY_CODE.has(code) ? BOOK_INDEX_BY_CODE.get(code) : -1;
}

const PSALMS_INDEX = TOSN_BOOK_CODES.indexOf("Ps");

// "Exod.27.21"、"Gen.1.22-25"、"Gen.1.1-2.3"、"1Kgs.1.1-2Kgs.25.30"；看不懂回 null。
export function parseBref(value) {
  const match = String(value || "").match(/^([1-3]?[A-Z][A-Za-z]*)\.(\d+)\.(\d+)(?:-(?:(?:([1-3]?[A-Z][A-Za-z]*)\.)?(\d+)\.)?(\d+))?$/);
  if (!match) return null;
  const bookIndex = tosnBookIndex(match[1]);
  if (bookIndex < 0) return null;
  const endBookIndex = match[4] ? tosnBookIndex(match[4]) : bookIndex;
  if (endBookIndex < 0) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const chapterEnd = match[5] ? Number(match[5]) : chapter;
  const verseEnd = match[6] ? Number(match[6]) : verse;
  const ref = { bookIndex, chapter, verse, chapter_end: chapterEnd, verse_end: verseEnd };
  if (endBookIndex !== bookIndex) ref.end_book_index = endBookIndex;
  return ref;
}

// TOSN 少數 ?bref= 寫壞了（例如 "Heb.3.11-4"，錨點文字是「Heb 3:11–4:11」）：結束節比起始節小時，
// 改用錨點文字的範圍；看不出來就當單一節。
export function repairRefFromAnchor(ref, anchorText) {
  if (!ref || ref.end_book_index !== undefined || ref.chapter_end !== ref.chapter || ref.verse_end >= ref.verse) return ref;
  const match = String(anchorText || "").match(/(\d+):(\d+)\s*[–—-]\s*(\d+):(\d+)/);
  if (match && Number(match[1]) === ref.chapter && Number(match[2]) === ref.verse && Number(match[3]) > ref.chapter) {
    return { ...ref, chapter_end: Number(match[3]), verse_end: Number(match[4]) };
  }
  return { ...ref, verse_end: ref.verse };
}

const CHAPTER_WORD =/^(?:chapters?|chs?\.?)\s+/i;
const BOOK_PREFIX = /^(?:[1-3]\s?)?[A-Z][A-Za-z]*\.?\s+(?=\d)/;

// 錨點文字的寫法：有沒有書名、是不是整章、前面的「and」。
export function describeAnchor(text) {
  let rest = String(text || "").replace(/\s+/g, " ").trim();
  let lead = "";
  const and = rest.match(/^(and|or)\s+/i);
  if (and) {
    lead = and[0];
    rest = rest.slice(and[0].length);
  }
  let chapterWord = false;
  const word = rest.match(CHAPTER_WORD);
  if (word) {
    chapterWord = true;
    rest = rest.slice(word[0].length);
  }
  const hasBook = !chapterWord && BOOK_PREFIX.test(rest);
  if (hasBook) rest = rest.replace(BOOK_PREFIX, "");
  return { lead, chapterWord, hasBook, numbers: rest };
}

function isWholeChapterRef(ref, numbers) {
  if (numbers.includes(":")) return false;
  const first = Number(String(numbers).match(/\d+/)?.[0]);
  return ref.verse === 1 && first === ref.chapter && (ref.chapter_end !== ref.chapter || ref.verse_end > 1);
}

// books：BIBLE_BOOKS（要有 abbrev）。chapterBefore：錨點前面緊接著「ch／chs」。
export function formatRefLabel(ref, anchorText, books, { chapterBefore = false } = {}) {
  const anchor = describeAnchor(anchorText);
  const abbrev = index => books[index]?.abbrev || "";
  const crossBook = ref.end_book_index !== undefined && ref.end_book_index !== ref.bookIndex;
  if (crossBook) {
    return `${abbrev(ref.bookIndex)}${ref.chapter}:${ref.verse}—${abbrev(ref.end_book_index)}${ref.chapter_end}:${ref.verse_end}`;
  }
  const prefix = anchor.hasBook ? abbrev(ref.bookIndex) : "";
  if (anchor.chapterWord || chapterBefore || isWholeChapterRef(ref, anchor.numbers)) {
    const chapters = ref.chapter_end !== ref.chapter ? `${ref.chapter}–${ref.chapter_end}` : `${ref.chapter}`;
    const unit = ref.bookIndex === PSALMS_INDEX ? "篇" : "章";
    return prefix ? `${prefix}${chapters}${unit}` : `第${chapters}${unit}`;
  }
  if (!anchor.numbers.includes(":") && !anchor.hasBook) {
    // 只有節號（「1:1, 21」的 21）：沿用前一個出處的章。
    return ref.verse_end !== ref.verse ? `${ref.verse}-${ref.verse_end}` : `${ref.verse}`;
  }
  let body;
  if (ref.chapter_end !== ref.chapter) body = `${ref.chapter}:${ref.verse}–${ref.chapter_end}:${ref.verse_end}`;
  else if (ref.verse_end !== ref.verse) body = `${ref.chapter}:${ref.verse}-${ref.verse_end}`;
  else body = `${ref.chapter}:${ref.verse}`;
  return `${prefix}${body}`;
}

// 存進資料庫的形狀：書名用繁中全名（跟 passage_commentary.book 一樣），整章的 verse 是 null。
export function toStoredRef(ref, label, books, { note = false } = {}) {
  const whole = /[章篇]$/.test(label);
  const stored = {
    book: books[ref.bookIndex]?.name || "",
    chapter: ref.chapter,
    verse: whole ? null : ref.verse,
    chapter_end: ref.chapter_end,
    verse_end: whole ? null : ref.verse_end,
    label
  };
  if (ref.end_book_index !== undefined) stored.end_book = books[ref.end_book_index]?.name || "";
  if (note) stored.note = true;
  return stored;
}
