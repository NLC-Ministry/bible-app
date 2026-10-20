// 經文注釋的資料存取（#470）：主 App（js/db.js，走 state.supabase）和 /read 讀經頁
// （js/read/read-commentary-client.mjs，直接打 nlc-data）共用同一套快取規則。
// - 索引：檢視表 commentary_chapter_index，localStorage 快取 6 小時；失敗後 5 分鐘內不重試。
// - 一章的資料：那一章的注釋全文＋這卷書的詞條清單（只有比對用的欄位），記憶體快取。
// - 詞條解釋：打開面板才依 id 抓，記憶體快取。
// `from(table)` 回傳 supabase-js 相容的查詢（select/eq/in/or/order/range）。

import {
  COMMENTARY_INDEX_CACHE_KEY,
  buildCommentaryIndex,
  commentaryChapterKey,
  parseCommentaryIndexCache,
  serializeCommentaryIndex
} from "./passage-commentary.mjs";
import { DEFAULT_PAGE_SIZE, isLastPage } from "./pagination.mjs";

export const COMMENTARY_INDEX_RETRY_MS = 5 * 60 * 1000;
const TERM_DETAIL_CHUNK = 100; // .in() 的 id 會放進網址，分批送

// chapter_end 起是 #542 的新欄位：跨章範圍、結構化交叉引用、被解釋的片語。
export const CHAPTER_COMMENTARY_COLUMNS = "id, book, chapter, verse_start, verse_end, title, content, topic_tags, source, chapter_end, chapter_end_verse, cross_refs, excerpts";

// 這一章的注釋＋從前面的章延續過來的跨章注釋（#542，例如「1:1–7:38 總覽」在第 3 章也看得到）。
export function chapterCommentaryFilter(chapter) {
  const n = Number(chapter);
  return `chapter.eq.${n},and(chapter.lt.${n},chapter_end.gte.${n})`;
}

export const TERM_MATCH_COLUMNS = "id, term, aliases, chapter, verse_start, verse_end";
export const TERM_DETAIL_COLUMNS = "id, term, definition, topic_tags, source";

// 每一頁都要有唯一排序（#351）；下一頁從實際拿到的筆數接著抓（#399）。
async function selectAllRows(buildQuery, orderBy) {
  const rows = [];
  let start = 0;
  while (true) {
    let query = buildQuery();
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(start, start + DEFAULT_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (isLastPage(page.length, DEFAULT_PAGE_SIZE)) return rows;
    start += page.length;
  }
}

export function createCommentaryRepository({ from, storage = null, now = () => Date.now() }) {
  let indexPromise = null;
  let indexFailedAt = 0;
  const chapterCache = new Map();
  const termsByBook = new Map();
  const termDetails = new Map();

  function readCachedIndex() {
    try { return parseCommentaryIndexCache(storage?.getItem(COMMENTARY_INDEX_CACHE_KEY), now()); } catch (_error) { return null; }
  }

  // 回傳 Set；查不到（離線、未登入）就回空 Set，閱讀器當作沒有注釋。
  async function fetchIndex() {
    const cached = readCachedIndex();
    if (cached) return cached;
    if (indexFailedAt && now() - indexFailedAt < COMMENTARY_INDEX_RETRY_MS) return new Set();
    if (!indexPromise) {
      indexPromise = (async () => {
        try {
          const rows = await selectAllRows(() => from("commentary_chapter_index").select("book, chapter"), ["book", "chapter"]);
          indexFailedAt = 0;
          const index = buildCommentaryIndex(rows);
          try { storage?.setItem(COMMENTARY_INDEX_CACHE_KEY, serializeCommentaryIndex(index, now())); } catch (_error) {}
          return index;
        } catch (error) {
          console.warn("[commentary] index lookup failed:", error);
          indexFailedAt = now();
          return new Set();
        }
      })().finally(() => { indexPromise = null; });
    }
    return indexPromise;
  }

  async function fetchBookTerms(book) {
    if (termsByBook.has(book)) return termsByBook.get(book);
    const rows = await selectAllRows(() => from("commentary_terms")
      .select(TERM_MATCH_COLUMNS)
      .eq("book", book)
      .eq("is_published", true), ["id"]);
    termsByBook.set(book, rows);
    return rows;
  }

  // { rows, terms }；查詢失敗時丟錯（閱讀器就當這章沒有注釋，下次換章再試）。
  async function fetchChapter(book, chapter) {
    const key = commentaryChapterKey(book, chapter);
    if (chapterCache.has(key)) return chapterCache.get(key);
    const [rows, terms] = await Promise.all([
      selectAllRows(() => from("passage_commentary")
        .select(CHAPTER_COMMENTARY_COLUMNS)
        .eq("book", book)
        .or(chapterCommentaryFilter(chapter))
        .eq("is_published", true), ["id"]),
      fetchBookTerms(book)
    ]);
    const result = { rows, terms };
    chapterCache.set(key, result);
    return result;
  }

  // 回傳 Map(id → 詞條全文)；失敗時丟錯，讓面板顯示重試。
  async function fetchTermDetails(ids) {
    const missing = Array.from(new Set((ids || []).map(String))).filter(id => !termDetails.has(id));
    for (let i = 0; i < missing.length; i += TERM_DETAIL_CHUNK) {
      const chunk = missing.slice(i, i + TERM_DETAIL_CHUNK);
      const { data, error } = await from("commentary_terms")
        .select(TERM_DETAIL_COLUMNS)
        .in("id", chunk)
        .eq("is_published", true);
      if (error) throw error;
      for (const row of data || []) termDetails.set(String(row.id), row);
    }
    return new Map((ids || []).map(id => [String(id), termDetails.get(String(id))]).filter(([, row]) => row));
  }

  function invalidate() {
    chapterCache.clear();
    termsByBook.clear();
    termDetails.clear();
    indexFailedAt = 0;
    try { storage?.removeItem(COMMENTARY_INDEX_CACHE_KEY); } catch (_error) {}
  }

  return { fetchIndex, fetchChapter, fetchTermDetails, invalidate };
}
