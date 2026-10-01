// 信望愛聖經搜尋（#366）：bolls.life 規定關鍵字至少 3 個字，
// 1～2 個字的關鍵字（「愛」「恩典」）改由信望愛 se.php 搜尋。純函式、不碰 DOM。

export const FHL_SEARCH_ENDPOINT = "https://bible.fhl.net/json/se.php";
// 信望愛超過 500 筆且沒帶 limit 時會回 "Fail: record count > 500"。
export const FHL_SEARCH_LIMIT = 500;
export const SHORT_QUERY_MAX_LENGTH = 2;

// 閱讀器版本 → 信望愛 VERSION；沒有對應的版本（當代譯本、英文）不送出 1～2 字搜尋。
const FHL_VERSION_BY_READER_VERSION = Object.freeze({
  CUNP: "unv",
  CUV: "unv",
  RCUVTS: "rcuv"
});

export function isShortBibleQuery(query) {
  const length = [...String(query ?? "").trim()].length;
  return length > 0 && length <= SHORT_QUERY_MAX_LENGTH;
}

export function getFhlSearchVersion(readerVersion) {
  return FHL_VERSION_BY_READER_VERSION[String(readerVersion || "").toUpperCase()] || null;
}

export function buildFhlSearchUrl(query, fhlVersion) {
  const params = new URLSearchParams({
    VERSION: fhlVersion,
    q: String(query ?? "").trim(),
    limit: String(FHL_SEARCH_LIMIT)
  });
  return `${FHL_SEARCH_ENDPOINT}?${params.toString()}`;
}

// 修訂版經文夾有原文編號 <WH03588> 與 <br/>，顯示與比對前全部去掉。
export function stripFhlMarkup(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEnglishKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function findBookForRecord(record, books) {
  const byAbbrev = books.find(book => book.abbrev === record.chineses);
  if (byAbbrev) return byAbbrev;
  // 中文縮寫對不到時用英文縮寫（1 Kin → 1 Kings、Philem → Philemon），取第一個開頭相符的書卷。
  const english = normalizeEnglishKey(record.engs);
  if (!english) return null;
  return books.find(book => normalizeEnglishKey(book.eng).startsWith(english)) || null;
}

// 轉成閱讀器搜尋結果的格式；對不到書卷的資料略過。
export function mapFhlSearchRecords(records, books) {
  if (!Array.isArray(records) || !Array.isArray(books)) return [];
  return records
    .map(record => {
      const book = findBookForRecord(record, books);
      if (!book) return null;
      return {
        book: book.id,
        bookName: book.name,
        bookEng: book.eng,
        chapter: Number(record.chap),
        verse: Number(record.sec),
        text: stripFhlMarkup(record.bible_text)
      };
    })
    .filter(item => item && item.chapter > 0 && item.verse > 0 && item.text);
}

// 解析 se.php 回應：成功回傳 { records, totalCount }；失敗丟出錯誤。
export function readFhlSearchPayload(payload) {
  if (!payload || payload.status !== "success") {
    throw new Error(`FHL search failed: ${payload && payload.status ? payload.status : "no payload"}`);
  }
  const records = Array.isArray(payload.record) ? payload.record : [];
  const totalCount = Number(payload.record_count);
  return { records, totalCount: Number.isFinite(totalCount) ? totalCount : records.length };
}
