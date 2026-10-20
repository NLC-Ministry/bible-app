// 經文注釋（#447、#470）：主題圖庫、章節索引快取、節範圍與詞條比對、面板內容 HTML。
// 純函式，閱讀器（js/modules/reader-commentary.mjs，主 App 與 /read 共用）、後台
// （js/modules/admin-commentary*.mjs）與 js/data/commentary-repository.mjs 共用。

export const COMMENTARY_IMAGE_DIR = "assets/commentary/";

// 主題 → 圖片。管理員在後台勾主題，閱讀器就帶出這裡列的圖；新增圖片時把檔案
// 放進 assets/commentary/ 再加一筆。key 存進資料庫（passage_commentary.topic_tags），
// 不要改名。
export const COMMENTARY_TOPICS = Object.freeze([
  Object.freeze({
    key: "tabernacle",
    label: "會幕",
    images: Object.freeze([
      Object.freeze({
        file: "tabernacle-layout.svg",
        alt: "會幕平面圖：外院、聖所、至聖所，以及約櫃、香壇、陳設餅桌、金燈臺、洗濯盆、銅祭壇和院門的位置",
        caption: "會幕平面圖（出埃及記 25–27 章）"
      })
    ])
  }),
  Object.freeze({
    key: "israel-camp",
    label: "以色列營地",
    images: Object.freeze([
      Object.freeze({
        file: "israel-camp.svg",
        alt: "以色列十二支派安營圖：會幕在中央，利未人圍在會幕四周，十二支派按東南西北各三支派安營",
        caption: "以色列十二支派安營圖（民數記 2–3 章）"
      })
    ])
  })
]);

const TOPICS_BY_KEY = new Map(COMMENTARY_TOPICS.map(topic => [topic.key, topic]));

export function getCommentaryTopic(key) {
  return TOPICS_BY_KEY.get(String(key || "")) || null;
}

// 只留圖庫認得的主題、去重、保持原順序（資料庫裡若有已移除的舊主題就略過）。
export function normalizeTopicTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const key = String(tag || "").trim();
    if (!TOPICS_BY_KEY.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function resolveCommentaryImages(tags) {
  const seen = new Set();
  const images = [];
  for (const key of normalizeTopicTags(tags)) {
    for (const image of TOPICS_BY_KEY.get(key).images) {
      if (seen.has(image.file)) continue;
      seen.add(image.file);
      images.push({ src: `${COMMENTARY_IMAGE_DIR}${image.file}`, alt: image.alt, caption: image.caption });
    }
  }
  return images;
}

export function commentaryChapterKey(book, chapter) {
  return `${String(book || "").trim()}|${Number(chapter) || 0}`;
}

// 整卷詞條在索引裡的 key（#470）。
export function commentaryBookKey(book) {
  return `${String(book || "").trim()}|*`;
}

// 「哪些章有內容」的索引存在 localStorage：翻章時先查這份，有內容的章才打 API 抓那一章。
// 來源是檢視表 commentary_chapter_index（只含已發布）：一列一個 (book, chapter)，
// chapter 是 NULL＝這卷有整卷詞條。管理員自己存檔／刪除時會清掉，其他人最晚 TTL 後看到。
export const COMMENTARY_INDEX_CACHE_KEY = "passage_commentary_index_v2";
export const COMMENTARY_INDEX_TTL_MS = 6 * 60 * 60 * 1000;

export function buildCommentaryIndex(rows) {
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !String(row.book || "").trim()) continue;
    if (row.chapter === null || row.chapter === undefined || row.chapter === "") {
      keys.add(commentaryBookKey(row.book));
    } else if (Number(row.chapter) > 0) {
      keys.add(commentaryChapterKey(row.book, row.chapter));
    }
  }
  return keys;
}

export function indexMayHaveCommentary(index, book, chapter) {
  if (!index || typeof index.has !== "function") return false;
  return index.has(commentaryChapterKey(book, chapter)) || index.has(commentaryBookKey(book));
}

export function serializeCommentaryIndex(index, now = Date.now()) {
  return JSON.stringify({ fetchedAt: now, keys: Array.from(index || []) });
}

// 過期、格式不對都回 null（呼叫端重新抓）。
export function parseCommentaryIndexCache(raw, now = Date.now(), ttlMs = COMMENTARY_INDEX_TTL_MS) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_error) { return null; }
  const fetchedAt = Number(parsed && parsed.fetchedAt);
  if (!Number.isFinite(fetchedAt) || !Array.isArray(parsed.keys)) return null;
  if (now - fetchedAt < 0 || now - fetchedAt >= ttlMs) return null;
  return new Set(parsed.keys.map(String));
}

// ── 節範圍（#470）──────────────────────────────────────────────────
// 起始節空白＝整章（回 null）；只填起始節＝單一節；顛倒時自動對調。
export function normalizeVerseRange(start, end) {
  const from = Number.parseInt(start, 10);
  if (!(from > 0)) return null;
  const parsedEnd = Number.parseInt(end, 10);
  const to = parsedEnd > 0 ? parsedEnd : from;
  return { start: Math.min(from, to), end: Math.max(from, to) };
}

export function formatVerseRange(start, end = start) {
  return Number(start) === Number(end) ? `${start}` : `${start}-${end}`;
}

// [1, 2, 3, 5] → "1-3、5"
export function formatVerseRuns(verses) {
  const sorted = Array.from(new Set((verses || []).map(Number).filter(n => n > 0))).sort((a, b) => a - b);
  const runs = [];
  for (const verse of sorted) {
    const last = runs[runs.length - 1];
    if (last && verse === last.end + 1) last.end = verse;
    else runs.push({ start: verse, end: verse });
  }
  return runs.map(run => formatVerseRange(run.start, run.end)).join("、");
}

// 跨章的節注釋（#542）：verse_start／verse_end 是掛在起始章的位置（舊版前端照舊），
// chapter_end／chapter_end_verse 是整段真正的結尾。不是跨章就回 null。
export function crossChapterSpan(row) {
  const chapter = Number(row?.chapter);
  const chapterEnd = Number(row?.chapter_end);
  const start = Number.parseInt(row?.verse_start, 10);
  if (!(chapterEnd > chapter) || !(start > 0)) return null;
  return { chapter, verseStart: start, chapterEnd, verseEnd: Number.parseInt(row?.chapter_end_verse, 10) || 0 };
}

// 節注釋本身的範圍，不含書名：「26:1-5」或跨章的「1:1–7:38」。整章注釋回 null。
export function noteRangeLabel(row) {
  const span = crossChapterSpan(row);
  if (span) return `${span.chapter}:${span.verseStart}–${span.chapterEnd}:${span.verseEnd || ""}`.replace(/:$/, "");
  const range = normalizeVerseRange(row?.verse_start, row?.verse_end);
  return range ? `${row?.chapter || ""}:${formatVerseRange(range.start, range.end)}` : null;
}

// 「出埃及記 26 章」或「出埃及記 26:1-5」
export function commentaryReferenceLabel(row) {
  const range = noteRangeLabel(row);
  return range ? `${row?.book || ""} ${range}` : `${row?.book || ""} ${row?.chapter || ""} 章`;
}

// ── 詞條比對（#470）────────────────────────────────────────────────
// 後台「其他寫法」用逗號、頓號或換行分隔；重複的（英文不分大小寫）只留一個。
export function parseTermAliases(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,，、;；\n]/);
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const alias = String(item || "").trim();
    if (!alias || seen.has(alias.toLowerCase())) continue;
    seen.add(alias.toLowerCase());
    result.push(alias);
  }
  return result;
}

export function termNeedles(term) {
  return parseTermAliases([term?.term, ...(Array.isArray(term?.aliases) ? term.aliases : [])]);
}

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

// 主 App 的經文以 HTML 放入（來源已清掉標籤）；比對與引用一律用純文字。
export function plainVerseText(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => HTML_ENTITIES[entity] || entity);
}

// 回傳不重疊的 [start, end) 區間，依位置排序；同一處較長的詞優先；英文不分大小寫。
export function findTermRanges(text, needles) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const ordered = [...(needles || [])].map(n => String(n || "")).filter(Boolean).sort((a, b) => b.length - a.length);
  const ranges = [];
  for (const needle of ordered) {
    const target = needle.toLowerCase();
    let index = lower.indexOf(target);
    while (index !== -1) {
      const end = index + target.length;
      if (!ranges.some(range => index < range.end && end > range.start)) ranges.push({ start: index, end });
      index = lower.indexOf(target, end);
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export function markTermsHTML(text, needles, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const source = String(text || "");
  let html = "";
  let cursor = 0;
  for (const range of findTermRanges(source, needles)) {
    html += escape(source.slice(cursor, range.start));
    html += `<mark class="reader-commentary-mark">${escape(source.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  return html + escape(source.slice(cursor));
}

// ── 交叉引用與片語（#542）──────────────────────────────────────────────
// cross_refs：[{ book, chapter, verse, chapter_end, verse_end, label, note? }]，label 是譯文裡的寫法
// （「出27:21」「5:17-19」「第16章」，只有節號的「21」）。excerpts：[{ en, zh, chapter, verse, heading }]，
// zh 是被解釋的和合本字句。兩者都由匯入工具產生（scripts/commentary-import/）。
const VERSE_ONLY_LABEL = /^\d+(?:[-–]\d+)?$/;
const LIST_SEPARATORS = "、，,；;和及與 ";

// 譯文裡出處標籤的位置：前後不能接著數字或冒號（「8:3」不算「28:3」「8:30」或「8:3-5」的一部分）；
// 只有節號的標籤一定要接在頓號、逗號、分號或「和」後面（「8:11、12」的 12）。
export function findRefLabelRanges(text, label) {
  const source = String(text || "");
  const needle = String(label || "");
  const ranges = [];
  if (!needle) return ranges;
  const verseOnly = VERSE_ONLY_LABEL.test(needle);
  let index = source.indexOf(needle);
  while (index !== -1) {
    const before = source[index - 1] || "";
    const after = source.slice(index + needle.length, index + needle.length + 2);
    const okBefore = verseOnly ? LIST_SEPARATORS.includes(before) && before !== "" : !/[\d:：\-–—]/.test(before);
    const okAfter = !/^[\d:：]/.test(after) && !/^[-–]\d/.test(after) && !(verseOnly && /^[章篇]/.test(after));
    if (okBefore && okAfter) ranges.push({ start: index, end: index + needle.length });
    index = source.indexOf(needle, index + needle.length);
  }
  return ranges;
}

function refAttributes(ref, escape) {
  const attrs = { book: ref.book, chapter: ref.chapter, verse: ref.verse, "chapter-end": ref.chapter_end, "verse-end": ref.verse_end };
  return Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ` data-ref-${key}="${escape(String(value))}"`)
    .join("");
}

// 一段譯文 → HTML：片語加粗；linkRefs 時出處做成按鈕（閱讀器點了跳過去）。
// 同一個標籤出現好幾次，依序對到同標籤的出處（多出來的都對最後一個）。
export function commentaryTextHTML(text, { refs = [], phrases = [], linkRefs = false } = {}, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const source = String(text || "");
  const marks = [];
  for (const range of findTermRanges(source, phrases)) marks.push({ ...range, kind: "phrase" });
  if (linkRefs) {
    const byLabel = new Map();
    for (const ref of Array.isArray(refs) ? refs : []) {
      if (!ref || !ref.label || !ref.book || !(Number(ref.chapter) > 0)) continue;
      if (!byLabel.has(ref.label)) byLabel.set(ref.label, []);
      byLabel.get(ref.label).push(ref);
    }
    for (const [label, list] of byLabel) {
      findRefLabelRanges(source, label).forEach((range, i) => marks.push({ ...range, kind: "ref", ref: list[Math.min(i, list.length - 1)] }));
    }
  }
  marks.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  let html = "";
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    html += escape(source.slice(cursor, mark.start));
    const inner = escape(source.slice(mark.start, mark.end));
    html += mark.kind === "phrase"
      ? `<strong class="reader-commentary-phrase">${inner}</strong>`
      : `<button type="button" class="reader-commentary-ref" data-commentary-ref${refAttributes(mark.ref, escape)}>${inner}</button>`;
    cursor = mark.end;
  }
  return html + escape(source.slice(cursor));
}

// 點出處跳轉時：捲到起始節；同一章的範圍一起閃底色。整章出處（verse 是 null）只換章。
export function refRevealTarget({ chapter, verse = null, chapterEnd = null, verseEnd = null } = {}) {
  if (!(Number(verse) > 0)) return { verse: null, highlightVerses: null };
  const sameChapter = !(Number(chapterEnd) > 0) || Number(chapterEnd) === Number(chapter);
  const last = sameChapter && Number(verseEnd) > Number(verse) ? Number(verseEnd) : Number(verse);
  const highlightVerses = [];
  for (let current = Number(verse); current <= last; current += 1) highlightVerses.push(current);
  return { verse: Number(verse), highlightVerses };
}

export function excerptPhrases(excerpts) {
  return parseTermAliases((Array.isArray(excerpts) ? excerpts : []).map(excerpt => excerpt?.zh));
}

// 這則注釋裡、屬於第 chapter 章第 verse 節的片語（在引用經文裡標出來）。
export function excerptPhrasesForVerse(note, chapter, verse) {
  return excerptPhrases((Array.isArray(note?.excerpts) ? note.excerpts : []).filter(excerpt =>
    Number(excerpt?.verse) === Number(verse) && Number(excerpt?.chapter ?? note.chapter) === Number(chapter)));
}

// 把一章的注釋和詞條對到節上（#470）。
// - 整章注釋（沒有節範圍）→ chapterRow，由工具列的燈泡打開。
// - 節注釋 → 範圍內每一節都有內容，但 icon 只放在起始節（研讀注釋常一則涵蓋十幾節，#471）。
// - 指定節的詞條 → 那幾節都有內容，也都顯示節旁 icon。
// - 整卷／整章的詞條 → 只套用在經文出現這個詞（或其他寫法）的節；icon 只放在這章第一次
//   出現的那一節，其他節點選後從工具列的「注釋」一樣看得到，閱讀畫面才不會滿是 icon。
export function resolveChapterCommentary({ rows = [], terms = [], chapter, textByVerse = new Map() } = {}) {
  const chapterNumber = Number(chapter);
  const verseNumbers = Array.from(textByVerse.keys()).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  const plain = new Map(verseNumbers.map(verse => [verse, plainVerseText(textByVerse.get(verse))]));
  const entries = new Map();
  const iconVerses = new Set();
  const entryFor = verse => {
    if (!entries.has(verse)) entries.set(verse, { notes: [], terms: [] });
    return entries.get(verse);
  };
  const versesIn = range => verseNumbers.filter(verse => verse >= range.start && verse <= range.end);

  let chapterRow = null;
  // 從前面的章延續過來的跨章注釋排最前面（這章的第 1 節起）。
  const sortStart = row => (Number(row?.chapter) < chapterNumber ? 0 : Number(row?.verse_start) || 0);
  const orderedRows = [...(rows || [])].sort((a, b) =>
    sortStart(a) - sortStart(b) || (Number(a.verse_end) || 0) - (Number(b.verse_end) || 0));
  for (const row of orderedRows) {
    if (!row) continue;
    // 跨章注釋（#542）：起始章從起始節到章末、中間的章整章、結束章到結束節都有內容；
    // icon 放在每一章涵蓋的第一節，「1:1–7:38 總覽」在 1–7 章都看得到。
    const span = crossChapterSpan(row);
    if (span) {
      if (chapterNumber < span.chapter || chapterNumber > span.chapterEnd) continue;
      const from = chapterNumber === span.chapter ? span.verseStart : 1;
      const to = chapterNumber === span.chapterEnd && span.verseEnd > 0 ? span.verseEnd : Number.POSITIVE_INFINITY;
      const covered = verseNumbers.filter(verse => verse >= from && verse <= to);
      for (const verse of covered) entryFor(verse).notes.push(row);
      if (covered.length) iconVerses.add(covered[0]);
      continue;
    }
    if (Number(row.chapter) !== chapterNumber) continue;
    const range = normalizeVerseRange(row.verse_start, row.verse_end);
    if (!range) {
      if (!chapterRow) chapterRow = row;
      continue;
    }
    const covered = versesIn(range);
    for (const verse of covered) entryFor(verse).notes.push(row);
    if (covered.length) iconVerses.add(covered[0]);
  }

  for (const term of terms || []) {
    if (!term) continue;
    const range = normalizeVerseRange(term.verse_start, term.verse_end);
    if (range) {
      if (Number(term.chapter) !== chapterNumber) continue;
      for (const verse of versesIn(range)) {
        entryFor(verse).terms.push(term);
        iconVerses.add(verse);
      }
      continue;
    }
    const hasChapter = term.chapter !== null && term.chapter !== undefined && term.chapter !== "";
    if (hasChapter && Number(term.chapter) !== chapterNumber) continue;
    const needles = termNeedles(term);
    if (!needles.length) continue;
    let first = true;
    for (const verse of verseNumbers) {
      if (!findTermRanges(plain.get(verse), needles).length) continue;
      entryFor(verse).terms.push(term);
      if (first) iconVerses.add(verse);
      first = false;
    }
  }

  return { chapterRow, entries, iconVerses: Array.from(iconVerses).sort((a, b) => a - b) };
}

// ── 面板內容 HTML ──────────────────────────────────────────────────
// 空行分段；同一段裡的單一換行保留成 <br>。
export function splitCommentaryParagraphs(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

function paragraphsHTML(text, escape, decorate = null) {
  const line = decorate ? value => commentaryTextHTML(value, decorate, escape) : value => escape(value);
  return splitCommentaryParagraphs(text)
    .map(paragraph => `<p>${paragraph.split("\n").map(line).join("<br>")}</p>`)
    .join("");
}

function sourceHTML(source, escape) {
  const text = String(source || "").trim();
  return text ? `<p class="reader-commentary-source">出處：${escape(text)}</p>` : "";
}

function figuresHTML(tags, escape) {
  const figures = resolveCommentaryImages(tags).map(image => `
    <figure class="reader-commentary-figure">
      <div class="reader-commentary-figure__frame">
        <button type="button" class="reader-commentary-figure__zoom" data-commentary-zoom aria-label="放大或縮小圖片：${escape(image.caption)}" aria-pressed="false">
          <img src="${escape(image.src)}" alt="${escape(image.alt)}" loading="lazy" decoding="async">
        </button>
      </div>
      <figcaption>${escape(image.caption)}<span class="reader-commentary-figure__hint">（點圖可放大）</span></figcaption>
    </figure>`).join("");
  return figures ? `<div class="reader-commentary-figures">${figures}</div>` : "";
}

// 整章注釋（#447）。
export function buildCommentaryBodyHTML(row, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const title = String(row?.title || "").trim();
  return `
    ${title ? `<h4 class="reader-commentary-title">${escape(title)}</h4>` : ""}
    <div class="reader-commentary-text">${paragraphsHTML(row?.content, escape)}</div>
    ${sourceHTML(row?.source, escape)}
    ${figuresHTML(row?.topic_tags, escape)}`;
}

// 節注釋＋詞彙（#470）。verses：[{ verse, text, terms }]（點選或點 icon 的節，已排序）；
// notes／terms 已去重（一則跨好幾節的注釋只出現一次），terms 要帶 definition。
// 引用的經文標出詞彙與被解釋的片語（#542）——標記只在面板裡，閱讀畫面本身不加底線。
// linkRefs：譯文裡的出處做成按鈕（呼叫端要處理 [data-commentary-ref] 的點擊）。
export function buildVerseCommentaryHTML({ chapter, verses = [], notes = [], terms = [], linkRefs = false }, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const quotes = verses.map(item => {
    const needles = [
      ...(item.terms || []).flatMap(term => termNeedles(term)),
      ...notes.flatMap(note => excerptPhrasesForVerse(note, chapter, item.verse))
    ];
    return `<blockquote class="reader-commentary-quote"><span class="reader-commentary-quote__num">${escape(String(item.verse))}</span>${markTermsHTML(plainVerseText(item.text), needles, escape)}</blockquote>`;
  }).join("");
  const noteHTML = notes.map(note => {
    const range = noteRangeLabel({ ...note, chapter: note.chapter || chapter });
    const title = String(note.title || "").trim();
    const decorate = { refs: note.cross_refs, phrases: excerptPhrases(note.excerpts), linkRefs };
    return `
      <article class="reader-commentary-note">
        <p class="reader-commentary-note__ref">${escape(range || `${chapter} 章`)}</p>
        ${title ? `<h5 class="reader-commentary-note__title">${escape(title)}</h5>` : ""}
        <div class="reader-commentary-text">${paragraphsHTML(note.content, escape, decorate)}</div>
        ${sourceHTML(note.source, escape)}
      </article>`;
  }).join("");
  const termHTML = terms.map(term => `
      <article class="reader-commentary-term">
        <h5 class="reader-commentary-term__name">${escape(term.term)}</h5>
        <div class="reader-commentary-text">${paragraphsHTML(term.definition, escape)}</div>
        ${sourceHTML(term.source, escape)}
      </article>`).join("");
  const tags = [...notes, ...terms].flatMap(item => (Array.isArray(item.topic_tags) ? item.topic_tags : []));
  return `
    ${quotes ? `<div class="reader-commentary-quotes">${quotes}</div>` : ""}
    ${noteHTML ? `<section class="reader-commentary-section" aria-label="說明"><h4 class="reader-commentary-section__title">說明</h4>${noteHTML}</section>` : ""}
    ${termHTML ? `<section class="reader-commentary-section" aria-label="詞彙"><h4 class="reader-commentary-section__title">詞彙</h4>${termHTML}</section>` : ""}
    ${figuresHTML(tags, escape)}`;
}
