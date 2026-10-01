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

// 信望愛兩個版本的異體字剛好相反，搜尋時不互通（2026-10-01 實測）：
// unv（和合本）用「裡」「毘」（「心裏」0 筆／「心裡」420 筆、「毗」0 筆／「毘」82 筆）；
// rcuv（修訂版）用「裏」「毗」（「心裏」311 筆／「心裡」0 筆、「毗」85 筆／「毘」0 筆）。
export function normalizeQueryForFhlVersion(query, fhlVersion) {
  const text = String(query ?? "").trim();
  if (fhlVersion === "unv") return text.replace(/裏/g, "裡").replace(/毗/g, "毘");
  if (fhlVersion === "rcuv") return text.replace(/裡/g, "裏").replace(/毘/g, "毗");
  return text;
}

// 新標點和合本改過部分人名、地名譯法，信望愛 unv 仍是舊譯名；搜新譯名時順便搜舊譯名。
// 由 bolls CUNP 與信望愛 unv 全本 31,101 節逐節比對整理（2026-10-01）；
// 「毗／毘」已由上面的字形轉換處理，不列在這裡。不保證完整。
export const CUNP_NAME_ALIASES = Object.freeze({
  "呂便": "流便",
  "她瑪": "他瑪",
  "大流士": "大利烏",
  "塞魯士": "古列",
  "凱撒利亞": "該撒利亞",
  "亞她利雅": "亞他利雅",
  "亞斯她錄": "亞斯他錄",
  "米底亞": "瑪代",
  "亞歷山大": "亞力山大",
  "伊利莎白": "伊利沙伯",
  "尼哥德慕": "尼哥底母",
  "哈慕她": "哈慕他",
  "宙斯": "丟斯",
  "百妮基": "百尼基",
  "以法她": "以法他",
  "阿尼西謀": "阿尼西母",
  "何希阿": "何西阿",
  "亞雅崙": "亞雅倫",
  "尼護施她": "尼護施他",
  "珉雅珉": "岷雅岷",
  "巴施戶珥": "巴示戶珥",
  "杜達": "丟大",
  "克勞第": "革老丟",
  "德提": "德丟",
  "友阿蝶": "友阿爹",
  "友妮基": "友尼基"
});

// 長的譯名先換，避免短名把長名的一部分先換掉。
const CUNP_NAME_ALIAS_ENTRIES = Object.entries(CUNP_NAME_ALIASES).sort((left, right) => right[0].length - left[0].length);

// 回傳要送給信望愛的查詢字串（第一個是主要查詢，其餘是新標點譯名對應的舊譯名）。
export function getFhlSearchQueries(query, readerVersion) {
  const fhlVersion = getFhlSearchVersion(readerVersion);
  if (!fhlVersion) return { fhlVersion: null, queries: [] };
  const primary = normalizeQueryForFhlVersion(query, fhlVersion);
  const queries = [primary];
  if (String(readerVersion || "").toUpperCase() === "CUNP") {
    let aliased = primary;
    for (const [cunpName, unvName] of CUNP_NAME_ALIAS_ENTRIES) {
      aliased = aliased.split(cunpName).join(unvName);
    }
    if (aliased !== primary) queries.push(aliased);
  }
  return { fhlVersion, queries: queries.filter(Boolean) };
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
