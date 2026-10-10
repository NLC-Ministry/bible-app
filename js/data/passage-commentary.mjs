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

// 「出埃及記 26 章」或「出埃及記 26:1-5」
export function commentaryReferenceLabel(row) {
  const range = normalizeVerseRange(row?.verse_start, row?.verse_end);
  const base = `${row?.book || ""} ${row?.chapter || ""}`;
  return range ? `${base}:${formatVerseRange(range.start, range.end)}` : `${base} 章`;
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
  const orderedRows = [...(rows || [])].sort((a, b) =>
    (Number(a.verse_start) || 0) - (Number(b.verse_start) || 0) || (Number(a.verse_end) || 0) - (Number(b.verse_end) || 0));
  for (const row of orderedRows) {
    if (!row || Number(row.chapter) !== chapterNumber) continue;
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

function paragraphsHTML(text, escape) {
  return splitCommentaryParagraphs(text)
    .map(paragraph => `<p>${paragraph.split("\n").map(line => escape(line)).join("<br>")}</p>`)
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
// 引用的經文標出詞彙位置——標記只在面板裡，閱讀畫面本身不加底線。
export function buildVerseCommentaryHTML({ chapter, verses = [], notes = [], terms = [] }, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const quotes = verses.map(item => {
    const needles = (item.terms || []).flatMap(term => termNeedles(term));
    return `<blockquote class="reader-commentary-quote"><span class="reader-commentary-quote__num">${escape(String(item.verse))}</span>${markTermsHTML(plainVerseText(item.text), needles, escape)}</blockquote>`;
  }).join("");
  const noteHTML = notes.map(note => {
    const range = normalizeVerseRange(note.verse_start, note.verse_end);
    const title = String(note.title || "").trim();
    return `
      <article class="reader-commentary-note">
        <p class="reader-commentary-note__ref">${escape(range ? `${chapter}:${formatVerseRange(range.start, range.end)}` : `${chapter} 章`)}</p>
        ${title ? `<h5 class="reader-commentary-note__title">${escape(title)}</h5>` : ""}
        <div class="reader-commentary-text">${paragraphsHTML(note.content, escape)}</div>
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
