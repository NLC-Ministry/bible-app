// 經文出處解析（#362）：把「約3:16」「約翰福音3章16節」「John 3:16」這類輸入
// 解析成 書卷＋章＋節，給搜尋框與目錄篩選共用。純函式、不碰 DOM／全域。
//
// 規則（寬鬆派，依閱讀器目前的版本決定語言）：
// - 中文版本只認中文書名，英文版本只認英文書名。
// - 中文書卷依序比對：標準縮寫 → 別寫 → 全名 → 全名開頭（排除開頭後面緊接序號字的書卷）。
// - 章節一律阿拉伯數字；可用 : ： . 空白 分隔，也可用 章／篇／節 字；
//   範圍 - ～ 至 到，同章不同節用頓號「、」。中文數字不收。

const ORDINAL_CHARS = new Set(["一", "二", "三", "上", "下", "前", "後"]);
const ZH_DIGIT_VARIANTS = [
  [/壹/g, "一"],
  [/貳/g, "二"],
  [/[叄參叁]/g, "三"],
  [/啓/g, "啟"]
];
// 舊式全名寫法。約翰書信的 約壹／約貳／約叄 由 normalizeZhToken 轉成 約一／約二／約三；顯示仍以 BIBLE_BOOKS.abbrev 為準。
const ZH_ALIASES = {
  "撒母耳上": 9,
  "撒母耳下": 10,
  "列王上": 11,
  "列王下": 12,
  "歷代上": 13,
  "歷代下": 14
};
// 英文常見縮寫（SBL 與各家聖經軟體慣用寫法）；全名與全名開頭另外比對。
const EN_ABBREVIATIONS = {
  1: ["gen", "gn", "ge"],
  2: ["ex", "exo", "exod"],
  3: ["lev", "lv", "le"],
  4: ["num", "nm", "nu", "nb"],
  5: ["deut", "dt", "deu", "de"],
  6: ["josh", "jos", "jsh"],
  7: ["judg", "jdg", "jg", "jdgs"],
  8: ["ru", "rth", "rut"],
  9: ["1sam", "1sa", "1sm", "1s"],
  10: ["2sam", "2sa", "2sm", "2s"],
  11: ["1kgs", "1ki", "1kg", "1k"],
  12: ["2kgs", "2ki", "2kg", "2k"],
  13: ["1chr", "1ch", "1chron"],
  14: ["2chr", "2ch", "2chron"],
  15: ["ezr"],
  16: ["neh", "ne"],
  17: ["esth", "est", "es"],
  18: ["jb"],
  19: ["ps", "psa", "psalm", "pss", "psm"],
  20: ["prov", "pr", "prv", "pro"],
  21: ["eccl", "ecc", "ec", "eccles", "qoh"],
  22: ["song", "sos", "sng", "ss", "cant", "songofsongs"],
  23: ["isa", "is"],
  24: ["jer", "je", "jr"],
  25: ["lam", "la"],
  26: ["ezek", "eze", "ezk"],
  27: ["dan", "dn", "da"],
  28: ["hos", "ho"],
  29: ["jl", "joe"],
  30: ["am", "amo"],
  31: ["obad", "ob", "oba"],
  32: ["jon", "jnh"],
  33: ["mic", "mc"],
  34: ["nah", "na"],
  35: ["hab", "hb"],
  36: ["zeph", "zep", "zp"],
  37: ["hag", "hg"],
  38: ["zech", "zec", "zc"],
  39: ["mal", "ml"],
  40: ["matt", "mt", "mat"],
  41: ["mk", "mrk", "mar"],
  42: ["lk", "luk"],
  43: ["jn", "jhn", "joh"],
  44: ["ac", "act"],
  45: ["rom", "ro", "rm"],
  46: ["1cor", "1co"],
  47: ["2cor", "2co"],
  48: ["gal", "ga"],
  49: ["eph", "ephes"],
  50: ["phil", "php", "pp"],
  51: ["col"],
  52: ["1thess", "1th", "1thes"],
  53: ["2thess", "2th", "2thes"],
  54: ["1tim", "1ti", "1tm"],
  55: ["2tim", "2ti", "2tm"],
  56: ["tit", "ti"],
  57: ["phlm", "phm", "philem"],
  58: ["heb"],
  59: ["jas", "jm", "jam"],
  60: ["1pet", "1pe", "1pt", "1p"],
  61: ["2pet", "2pe", "2pt", "2p"],
  62: ["1jn", "1jhn", "1jo", "1joh"],
  63: ["2jn", "2jhn", "2jo", "2joh"],
  64: ["3jn", "3jhn", "3jo", "3joh"],
  65: ["jud", "jd"],
  66: ["rev", "re", "rv", "revelations"]
};

const MAX_HIGHLIGHT_VERSES = 200;

const indexCache = new WeakMap();

function normalizeZhToken(value) {
  let text = String(value || "").replace(/\s+/g, "");
  for (const [pattern, replacement] of ZH_DIGIT_VARIANTS) text = text.replace(pattern, replacement);
  return text;
}

function normalizeEnToken(value) {
  return String(value || "").toLowerCase().replace(/[\s.]+/g, "");
}

function stripLeadingNumber(value) {
  return value.replace(/^\d+/, "");
}

function buildIndex(books) {
  const cached = indexCache.get(books);
  if (cached) return cached;
  const byId = new Map(books.map(book => [book.id, book]));
  const zhExact = new Map();
  const enExact = new Map();
  const add = (map, key, book) => {
    if (key && book && !map.has(key)) map.set(key, book);
  };
  // 標準縮寫優先於全名與別寫（「歌」一定是雅歌），所以先放縮寫。
  books.forEach(book => add(zhExact, normalizeZhToken(book.abbrev), book));
  books.forEach(book => add(zhExact, normalizeZhToken(book.name), book));
  Object.entries(ZH_ALIASES).forEach(([alias, id]) => add(zhExact, normalizeZhToken(alias), byId.get(id)));
  books.forEach(book => add(enExact, normalizeEnToken(book.eng), book));
  Object.entries(EN_ABBREVIATIONS).forEach(([id, keys]) => {
    keys.forEach(key => add(enExact, key, byId.get(Number(id))));
  });
  const index = {
    byId,
    zhExact,
    enExact,
    zhNames: books.map(book => ({ book, key: normalizeZhToken(book.name) })),
    enNames: books.map(book => ({ book, key: normalizeEnToken(book.eng) }))
  };
  indexCache.set(books, index);
  return index;
}

// 回傳 { target, books }：target＝按 Enter 會去的那一卷（唯一時），books＝建議／候選（target 排第一）。
export function matchBibleBooks(token, { books, language = "zh" } = {}) {
  if (!Array.isArray(books) || !books.length) return { target: null, books: [] };
  const index = buildIndex(books);
  const english = language === "en";
  const key = english ? normalizeEnToken(token) : normalizeZhToken(token);
  if (!key) return { target: null, books: [] };

  const exact = (english ? index.enExact : index.zhExact).get(key);
  if (exact) {
    return { target: exact, books: [exact] };
  }

  let candidates;
  let preferred;
  if (english) {
    const tokenHasNumber = /^\d/.test(key);
    candidates = index.enNames
      .filter(({ key: name }) => name.startsWith(key) || (!tokenHasNumber && stripLeadingNumber(name).startsWith(key)))
      .map(({ book }) => book);
    // 沒打數字時，優先非數字書卷：「joh」→ John，而不是 1 John。
    preferred = tokenHasNumber ? candidates : candidates.filter(book => !/^\d/.test(normalizeEnToken(book.eng)));
  } else {
    const matches = index.zhNames.filter(({ key: name }) => name.startsWith(key));
    candidates = matches.map(({ book }) => book);
    // 排除「開頭後面緊接序號字」的書卷：「約翰」→ 約翰福音（約翰一書的「約翰」後面是「一」）。
    preferred = matches.filter(({ key: name }) => !ORDINAL_CHARS.has(name.charAt(key.length))).map(({ book }) => book);
  }

  const target = preferred.length === 1 ? preferred[0] : null;
  const ordered = target ? [target, ...candidates.filter(book => book !== target)] : candidates;
  return { target, books: ordered };
}

function verseCountFor(book, chapter, verseCounts) {
  const counts = verseCounts && book ? verseCounts[book.eng] : null;
  const count = Array.isArray(counts) ? Number(counts[chapter - 1]) : NaN;
  return Number.isFinite(count) && count > 0 ? count : null;
}

function chapterUnit(book, english) {
  if (english) return "chapters";
  return book && book.id === 19 ? "篇" : "章";
}

export function formatVerseList(verses, { language = "zh" } = {}) {
  if (!Array.isArray(verses) || !verses.length) return "";
  const parts = [];
  let start = verses[0];
  let previous = verses[0];
  for (let i = 1; i <= verses.length; i += 1) {
    const current = verses[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  return parts.join(language === "en" ? ", " : "、");
}

export function formatBibleReferenceLabel({ book, chapter, verses }, { language = "zh" } = {}) {
  if (!book) return "";
  const english = language === "en";
  const name = english ? book.eng : book.name;
  if (!chapter) return name;
  const versePart = formatVerseList(verses, { language });
  return versePart ? `${name} ${chapter}:${versePart}` : `${name} ${chapter}`;
}


// 把輸入拆成「書卷」與「章節」兩段。英文的數字書卷（1 John 3:16）開頭數字屬於書名。
function splitInput(raw, english) {
  if (english) {
    const bookPart = raw.match(/^(\d+\s*)?[^\d]*/)[0];
    return { bookToken: bookPart.trim(), rest: raw.slice(bookPart.length).trim() };
  }
  const digitIndex = raw.search(/\d/);
  if (digitIndex === -1) return { bookToken: raw.trim(), rest: "" };
  return { bookToken: raw.slice(0, digitIndex).trim(), rest: raw.slice(digitIndex).trim() };
}

function normalizeChapterSpec(rest) {
  return String(rest || "")
    .replace(/[章篇]/g, ":")
    .replace(/節/g, "")
    .replace(/[至到~〜～–—]/g, "-")
    .replace(/[、,，;；]/g, ",")
    .replace(/\s*([:\-,])\s*/g, "$1")
    .trim();
}

function parseVerseRanges(spec) {
  if (!spec) return [];
  const ranges = [];
  for (const item of spec.split(",")) {
    const match = item.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    const a = Number(match[1]);
    const b = match[2] ? Number(match[2]) : a;
    ranges.push([Math.min(a, b), Math.max(a, b)]);
  }
  return ranges;
}

// 回傳 { chapter, ranges } 或 null（格式不對）。
function parseChapterSpec(rest, book) {
  const spec = normalizeChapterSpec(rest);
  if (!spec) return null;

  // 跨章範圍（約3:16-4:2）只跳起點。
  const crossChapter = spec.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (crossChapter) {
    const verse = Number(crossChapter[2]);
    return { chapter: Number(crossChapter[1]), ranges: [[verse, verse]] };
  }
  const withVerses = spec.match(/^(\d+)[:.\s](.*)$/);
  if (withVerses) {
    const ranges = parseVerseRanges(withVerses[2].replace(/\s+/g, ","));
    return ranges ? { chapter: Number(withVerses[1]), ranges } : null;
  }
  if (Number(book.chapters) === 1) {
    // 單章書卷：「猶5」「猶5-7」視為節。
    const ranges = parseVerseRanges(spec);
    return ranges ? { chapter: 1, ranges } : null;
  }
  const chapterOnly = spec.match(/^(\d+)(?:-\d+)?$/);
  return chapterOnly ? { chapter: Number(chapterOnly[1]), ranges: [] } : null;
}

function buildReference(book, rest, { verseCounts, language }) {
  const english = language === "en";
  const parsed = parseChapterSpec(rest, book);
  if (!parsed) return null;
  const { chapter, ranges } = parsed;
  const name = english ? book.eng : book.name;

  const chapterCount = Number(book.chapters) || 0;
  if (chapter < 1 || chapter > chapterCount) {
    return {
      kind: "error",
      code: "chapter_out_of_range",
      book,
      message: english
        ? `${name} has only ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}`
        : `${name}只有 ${chapterCount} ${chapterUnit(book, false)}`
    };
  }

  let verses = null;
  if (ranges.length) {
    const verseCount = verseCountFor(book, chapter, verseCounts);
    const minVerse = Math.min(...ranges.map(([start]) => start));
    const maxVerse = Math.max(...ranges.map(([, end]) => end));
    if (minVerse < 1 || (verseCount && maxVerse > verseCount)) {
      return {
        kind: "error",
        code: "verse_out_of_range",
        book,
        chapter,
        message: english
          ? `${name} ${chapter} has only ${verseCount || "?"} verses`
          : `${name} ${chapter} ${chapterUnit(book, false)}只有 ${verseCount || "?"} 節`
      };
    }
    const set = new Set();
    for (const [start, end] of ranges) {
      for (let v = start; v <= end && set.size < MAX_HIGHLIGHT_VERSES; v += 1) set.add(v);
    }
    verses = [...set].sort((a, b) => a - b);
  }

  const reference = { kind: "reference", book, chapter, verses };
  reference.label = formatBibleReferenceLabel(reference, { language });
  return reference;
}

function formatError(language, book = null) {
  return {
    kind: "error",
    code: "invalid_format",
    book,
    message: language === "en" ? "Use numbers for chapter and verse, e.g. John 3:16" : "章節請用數字，例如 約3:16"
  };
}

// 「約三章十六節」：開頭是書卷、後面是中文數字＋章節字 → 提示改用數字。
function detectChineseNumeralReference(token, books) {
  if (!/[章篇節:]/.test(token)) return null;
  for (let end = token.length - 1; end > 0; end -= 1) {
    const { target } = matchBibleBooks(token.slice(0, end), { books, language: "zh" });
    if (target && /^[一二三四五六七八九十百零〇兩]+[章篇節:]/.test(token.slice(end))) return target;
  }
  return null;
}

// 主要進入點。回傳：
// - { kind: "empty" }                                   空白輸入
// - { kind: "none" }                                    不像出處 → 照常做關鍵字搜尋
// - { kind: "books", target, books }                    只有書卷（target＝Enter 目標，可能為 null）
// - { kind: "reference", book, chapter, verses, label } verses 為 null 表示只到章
// - { kind: "choices", choices: [reference|error...] } 書卷對到多卷又帶了章節
// - { kind: "error", code, message, book? }             看得出是出處但不成立
export function parseBibleReference(input, { books, verseCounts, language = "zh" } = {}) {
  const raw = String(input ?? "").normalize("NFKC").trim();
  if (!raw) return { kind: "empty" };
  const english = language === "en";
  const { bookToken, rest } = splitInput(raw, english);
  if (!bookToken) return { kind: "none" };
  // 依版本語言：中文版本只認中文書名、英文版本只認英文書名。
  if (english ? /[^\x00-\x7F]/.test(bookToken) : /[A-Za-z]/.test(bookToken)) return { kind: "none" };

  if (!rest) {
    const bookOnly = matchBibleBooks(bookToken, { books, language });
    if (bookOnly.books.length) return { kind: "books", ...bookOnly };
    const numeralBook = english ? null : detectChineseNumeralReference(bookToken, books);
    return numeralBook ? formatError(language, numeralBook) : { kind: "none" };
  }

  const matched = matchBibleBooks(bookToken, { books, language });
  if (!matched.books.length) return { kind: "none" };
  if (matched.target) {
    return buildReference(matched.target, rest, { verseCounts, language }) || formatError(language, matched.target);
  }
  const choices = matched.books
    .map(book => buildReference(book, rest, { verseCounts, language }))
    .filter(Boolean);
  return choices.length ? { kind: "choices", choices } : formatError(language);
}

// 目錄「卷」分頁篩選：回傳要顯示的書卷（維持原本順序）與 Enter 目標。
export function filterBibleBooks(input, { books, language = "zh" } = {}) {
  const list = Array.isArray(books) ? books : [];
  const raw = String(input ?? "").normalize("NFKC").trim();
  if (!raw) return { books: list, target: null, filtered: false };
  const { bookToken } = splitInput(raw, language === "en");
  const { target, books: matches } = matchBibleBooks(bookToken, { books: list, language });
  const ids = new Set(matches.map(book => book.id));
  return { books: list.filter(book => ids.has(book.id)), target, filtered: true };
}
