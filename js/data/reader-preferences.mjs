// 閱讀偏好（localStorage）：主 App 讀經頁和 /read 獨立讀經頁共用同一組 key、同一種格式，
// 兩邊「上次讀到哪、用哪個譯本、字多大」一致（#416）。
//
// 主 App 的寫入點：bible.js saveReaderPreferences()／updateReaderFontSize()／換譯本，
// home.js、plan.js 跳到指定章節時也會寫 reader_state。state.js loadLocalSettings() 讀出時
// 會把 reader_state 整個物件併進 state.readerState，所以這裡只能寫 { bookId, chapter }。

export const READER_STATE_KEY = "reader_state";
export const READER_VERSION_KEY = "reader_bible_version";
export const READER_FONT_SIZE_KEY = "reader_font_size";
export const APP_THEME_KEY = "app_theme";

export const DEFAULT_READER_VERSION = "CUNP";
export const DEFAULT_READER_FONT_SIZE = 20;
export const READER_FONT_SIZES = Object.freeze([16, 18, 20, 22, 24]);

// 跟 index.html 讀經頁的譯本選單同一份清單、同樣的名稱。
export const READER_VERSIONS = Object.freeze([
  Object.freeze({ code: "CUNP", label: "CUNP", name: "新標點和合本" }),
  Object.freeze({ code: "RCUVTS", label: "RCUV", name: "和合本修訂版" }),
  Object.freeze({ code: "CUV", label: "CUV", name: "官話和合本" }),
  Object.freeze({ code: "OCCB", label: "當代譯本", name: "當代譯本（繁體・可離線下載）" }),
  Object.freeze({ code: "ESV", label: "ESV", name: "English Standard Version" }),
  Object.freeze({ code: "NIV", label: "NIV", name: "New International Version" }),
  Object.freeze({ code: "NLT", label: "NLT", name: "New Living Translation" }),
  Object.freeze({ code: "WEB", label: "WEB", name: "World English Bible（可離線下載）" })
]);

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* 儲存空間滿或被停用：不影響閱讀 */ }
}

export function normalizeReaderFontSize(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_READER_FONT_SIZE;
  return READER_FONT_SIZES.reduce((closest, size) =>
    Math.abs(size - requested) < Math.abs(closest - requested) ? size : closest, DEFAULT_READER_FONT_SIZE);
}

export function normalizeReaderVersion(value) {
  const code = String(value || "").toUpperCase();
  return READER_VERSIONS.some(v => v.code === code) ? code : DEFAULT_READER_VERSION;
}

export function readReaderPosition(storage, books) {
  const fallback = { bookId: 1, chapter: 1 };
  let saved = null;
  try { saved = JSON.parse(safeGet(storage, READER_STATE_KEY) || "null"); } catch { saved = null; }
  const book = Array.isArray(books) ? books.find(b => Number(b.id) === Number(saved?.bookId)) : null;
  const chapter = Number(saved?.chapter);
  if (!book || !Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return fallback;
  return { bookId: book.id, chapter };
}

export function readReaderPreferences(storage, books) {
  const fontSizeRaw = Number.parseInt(safeGet(storage, READER_FONT_SIZE_KEY), 10);
  return {
    ...readReaderPosition(storage, books),
    version: normalizeReaderVersion(safeGet(storage, READER_VERSION_KEY)),
    fontSize: Number.isFinite(fontSizeRaw) ? normalizeReaderFontSize(fontSizeRaw) : DEFAULT_READER_FONT_SIZE
  };
}

export function writeReaderPosition(storage, { bookId, chapter }) {
  safeSet(storage, READER_STATE_KEY, JSON.stringify({ bookId, chapter }));
}

export function writeReaderVersion(storage, version) {
  safeSet(storage, READER_VERSION_KEY, normalizeReaderVersion(version));
}

export function writeReaderFontSize(storage, size) {
  safeSet(storage, READER_FONT_SIZE_KEY, String(normalizeReaderFontSize(size)));
}

export function readAppTheme(storage) {
  const theme = safeGet(storage, APP_THEME_KEY);
  return theme === "dark" || theme === "warm" ? theme : "light";
}
