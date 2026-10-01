// 經文搜尋依閱讀器目前的版本決定來源（#378）。純函式、不碰 DOM／網路。
//
// - 新標點和合本、和合本、和合本修訂版 → 信望愛 se.php（不分字數）
// - 當代譯本 → 本機已下載的「離線聖經」資料（bolls.life 沒有這個版本）
// - 英文版本 → bolls.life（至少 3 個字）
import { getFhlSearchVersion } from "./fhl-bible-search.mjs";

const OFFLINE_SEARCH_VERSIONS = new Set(["OCCB"]);

export const BIBLE_SEARCH_ERROR = Object.freeze({
  QUERY_TOO_SHORT: "QUERY_TOO_SHORT",
  OFFLINE_PACK_REQUIRED: "OFFLINE_PACK_REQUIRED"
});

export function getBibleSearchPlan(readerVersion) {
  const version = String(readerVersion || "CUNP").toUpperCase();
  const fhlVersion = getFhlSearchVersion(version);
  if (fhlVersion) return { source: "fhl", version, fhlVersion };
  if (OFFLINE_SEARCH_VERSIONS.has(version)) return { source: "offline", version };
  return { source: "bolls", version };
}

export function createBibleSearchError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function getBibleSearchErrorMessage(error) {
  if (error && error.code === BIBLE_SEARCH_ERROR.QUERY_TOO_SHORT) return "請至少輸入 3 個字";
  if (error && error.code === BIBLE_SEARCH_ERROR.OFFLINE_PACK_REQUIRED) {
    return "要先到 個人 → 偏好設定 → 離線聖經 下載當代譯本才能搜尋";
  }
  return "搜尋失敗，請稍後再試";
}

// 離線資料包的每一列是 { book: "Genesis", chapter: 1, verses: ["…", "…"] }，轉成逐節的搜尋語料。
export function buildOfflineSearchCorpus(rows, books) {
  if (!Array.isArray(rows) || !Array.isArray(books)) return [];
  const bookByEng = new Map(books.map(book => [book.eng, book]));
  const corpus = [];
  for (const row of rows) {
    const book = bookByEng.get(row && row.book);
    if (!book || !Array.isArray(row.verses)) continue;
    row.verses.forEach((text, index) => {
      if (!text) return;
      corpus.push({
        book: book.id,
        bookName: book.name,
        bookEng: book.eng,
        chapter: Number(row.chapter),
        verse: index + 1,
        text: String(text)
      });
    });
  }
  return corpus;
}
