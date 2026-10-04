// 經文注釋（#447）：主題圖庫、章節索引快取、注釋內容 HTML。
// 純函式，閱讀器（js/modules/reader-commentary.mjs）、後台
// （js/modules/admin-commentary.mjs）與 js/db.js 共用。

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

// 「哪些章有注釋」的索引存在 localStorage：翻章時直接查這份，不必每換一章就
// 打一次 API。管理員自己存檔／刪除時會清掉，其他人最晚 TTL 後看到新注釋。
export const COMMENTARY_INDEX_CACHE_KEY = "passage_commentary_index_v1";
export const COMMENTARY_INDEX_TTL_MS = 6 * 60 * 60 * 1000;

export function buildCommentaryIndex(rows) {
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.book || !(Number(row.chapter) > 0)) continue;
    keys.add(commentaryChapterKey(row.book, row.chapter));
  }
  return keys;
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

// 空行分段；同一段裡的單一換行保留成 <br>。
export function splitCommentaryParagraphs(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

export function buildCommentaryBodyHTML(row, escapeHTML) {
  const escape = typeof escapeHTML === "function" ? escapeHTML : value => String(value ?? "");
  const title = String(row?.title || "").trim();
  const paragraphs = splitCommentaryParagraphs(row?.content)
    .map(paragraph => `<p>${paragraph.split("\n").map(line => escape(line)).join("<br>")}</p>`)
    .join("");
  const figures = resolveCommentaryImages(row?.topic_tags).map(image => `
    <figure class="reader-commentary-figure">
      <div class="reader-commentary-figure__frame">
        <button type="button" class="reader-commentary-figure__zoom" data-commentary-zoom aria-label="放大或縮小圖片：${escape(image.caption)}" aria-pressed="false">
          <img src="${escape(image.src)}" alt="${escape(image.alt)}" loading="lazy" decoding="async">
        </button>
      </div>
      <figcaption>${escape(image.caption)}<span class="reader-commentary-figure__hint">（點圖可放大）</span></figcaption>
    </figure>`).join("");
  return `
    ${title ? `<h4 class="reader-commentary-title">${escape(title)}</h4>` : ""}
    <div class="reader-commentary-text">${paragraphs}</div>
    ${figures ? `<div class="reader-commentary-figures">${figures}</div>` : ""}`;
}
