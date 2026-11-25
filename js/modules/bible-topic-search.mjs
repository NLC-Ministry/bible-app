// 經文主題搜尋（#714）：純函式，不碰 DOM 與網路，方便用題庫量測。
// 只負責「問句 → 相關主題」與章節位置的解析；經文內容由閱讀器照會友選的版本讀取。

const LATIN_TERM = /^[a-z][a-z\s'-]*$/;
const QUERY_NOISE = /[\s　，。、；：？！?!,.;:"'「」『』（）()《》〈〉…—-]+/g;

export function normalizeTopicQuery(query) {
  return String(query || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/裏/g, "裡")
    .replace(QUERY_NOISE, " ")
    .trim();
}

function compact(text) {
  return text.replace(/\s+/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 回傳這個詞命中問句的分數；0 表示沒命中。分數越高越貼切。
function scoreTerm(term, query) {
  const normalized = normalizeTopicQuery(term);
  if (!normalized) return 0;

  if (LATIN_TERM.test(normalized)) {
    // 英文詞要從字首開始比對，避免 rest 命中 interest。
    const pattern = new RegExp(`(^|[^a-z])${escapeRegExp(normalized)}`);
    return pattern.test(query) ? normalized.length : 0;
  }

  const queryText = compact(query);
  const termText = compact(normalized);
  if (queryText === termText) return termText.length * 2 + 1;
  // 單一個字（例如「愛」「錢」）太容易誤中，只接受整個問句就是那個字。
  if (termText.length < 2) return 0;
  if (queryText.includes(termText)) return termText.length * 2;
  // 會友只打了詞的一部分（例如「旨意」打成「神的旨」）：問句至少兩個字才算，分數較低。
  if (queryText.length >= 2 && termText.includes(queryText)) return queryText.length;
  return 0;
}

export function matchBibleTopics(query, topics, { limit = 4 } = {}) {
  const normalizedQuery = normalizeTopicQuery(query);
  if (!normalizedQuery || !Array.isArray(topics)) return [];

  const matches = [];
  topics.forEach((topic, index) => {
    const candidates = [topic.name, topic.en, ...(Array.isArray(topic.terms) ? topic.terms : [])].filter(Boolean);
    let best = 0;
    let matchedTerm = "";
    for (const term of candidates) {
      const score = scoreTerm(term, normalizedQuery);
      if (score > best) {
        best = score;
        matchedTerm = term;
      }
    }
    if (best > 0) matches.push({ topic, score: best, matchedTerm, index });
  });

  return matches
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ topic, score, matchedTerm }) => ({ topic, score, matchedTerm }));
}

// "1 Corinthians 13:4-7" → { bookEng, chapter, verse, endVerse }；格式不對回傳 null。
export function parseTopicRef(ref) {
  const match = String(ref || "").trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const endVerse = match[4] ? Number(match[4]) : verse;
  if (!chapter || !verse || endVerse < verse) return null;
  return { bookEng: match[1], chapter, verse, endVerse };
}

// 顯示用標籤：中文「腓立比書 4章:6-7節」，英文「Philippians 4:6-7」。
export function formatTopicRefLabel(parsed, bookLabel, english = false) {
  if (!parsed) return "";
  const verses = parsed.endVerse > parsed.verse ? `${parsed.verse}-${parsed.endVerse}` : String(parsed.verse);
  return english
    ? `${bookLabel} ${parsed.chapter}:${verses}`
    : `${bookLabel} ${parsed.chapter}章:${verses}節`;
}

// 逐字剝掉 <…> 之間的內容（含巢狀與沒閉合的），結果保證不含 < 或 >。
// 不用 regex replace：剝一次會留下半個標籤（CodeQL js/incomplete-multi-character-sanitization）。
function stripTags(value) {
  let out = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "<") { depth += 1; continue; }
    if (ch === ">") { if (depth > 0) depth -= 1; continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

// 從整章經文取出範圍內的節，去掉標籤後串成一段純文字（呼叫端用 textContent 顯示）。
export function pickTopicRefText(chapterVerses, parsed) {
  if (!Array.isArray(chapterVerses) || !parsed) return "";
  return chapterVerses
    .filter(item => Number(item?.verse) >= parsed.verse && Number(item?.verse) <= parsed.endVerse)
    .sort((left, right) => Number(left.verse) - Number(right.verse))
    .map(item => stripTags(String(item.text || "")).trim())
    .filter(Boolean)
    .join(" ");
}

export function topicRefContainsVerse(ref, target) {
  const range = typeof ref === "string" ? parseTopicRef(ref) : ref;
  const point = typeof target === "string" ? parseTopicRef(target) : target;
  if (!range || !point) return false;
  return range.bookEng === point.bookEng
    && range.chapter === point.chapter
    && point.verse >= range.verse
    && point.verse <= range.endVerse;
}

// 主題搜尋的輸出：命中主題的經文依序攤平、去重，取前 limit 筆。
export function searchTopicRefs(query, topics, { topicLimit = 3, limit = 12 } = {}) {
  const refs = [];
  for (const { topic } of matchBibleTopics(query, topics, { limit: topicLimit })) {
    for (const ref of topic.refs || []) {
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  return refs.slice(0, limit);
}

// 題庫量測：searchFn(query) 回傳章節位置陣列；期望經文有任一節落在結果裡就算命中。
// 第 2 階段的語意搜尋也用同一個函式量，數字才能直接比較。
export async function evaluateBibleSearch(evalSet, searchFn) {
  const misses = [];
  let hits = 0;
  for (const item of evalSet) {
    const results = await searchFn(item.query);
    const hit = (results || []).some(ref => item.expect.some(target => topicRefContainsVerse(ref, target)));
    if (hit) hits += 1;
    else misses.push(item.query);
  }
  const total = evalSet.length;
  return { total, hits, hitRate: total ? hits / total : 0, misses };
}
