// /read 獨立讀經頁的入口（#416）：「快速啟動聖經」開著時，打開 App 直接來這裡。
// 顯示經文前只載入設定值、經文資料層和這一頁自己的畫面：不載 supabase-js、Tailwind、
// db.js、auth.js，也不發任何 Supabase／Logto 請求。登入、網路、會員系統出問題都不影響讀經。
// 由 scripts/bundle.mjs 打包成單一 read.<hash>.js。

import "../config.js";
import "./data/bible_data.js";
import "./data/bible_verse_counts.js";
import "./copy/zh-Hant.js";
// 和主 App 同一套 Lucide 圖示（#423）。
import "./design/icon-registry.js";
import "./design/icons.js";
import { IndexedDbClient } from "./pwa/IndexedDbClient.js";
import { OfflineBibleRepository } from "./pwa/OfflineBibleRepository.js";
import { withSoftTimeout } from "./net-timeout.mjs";
import { readAppTheme } from "./data/reader-preferences.mjs";
import { mountReadApp } from "./read/read-app.mjs";
import { keepLoginFresh } from "./read/read-login-keepalive.mjs";

// iOS 偶爾會讓 IndexedDB 開不起來：本機查不到就等最多 1.5 秒，然後改上網抓，不讓畫面卡住。
const OFFLINE_LOOKUP_TIMEOUT_MS = 1500;
const KEEPALIVE_DELAY_MS = 3000;

function applyTheme(theme) {
  document.body.classList.remove("light-theme", "warm-theme", "dark-theme", "dark");
  document.body.classList.add(theme + "-theme");
  if (theme === "dark") {
    document.body.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function createOfflineLookup() {
  if (!("indexedDB" in window)) return null;
  const repository = new OfflineBibleRepository({ dbClient: new IndexedDbClient() });
  return {
    getChapter: (translation, book, chapter) =>
      withSoftTimeout(repository.getChapter(translation, book, chapter).catch(() => null), OFFLINE_LOOKUP_TIMEOUT_MS, null),
    getRemoteChapter: (translation, book, chapter) => repository.getRemoteChapter(translation, book, chapter),
    getInstalledPack: translation =>
      withSoftTimeout(repository.getInstalledPack(translation).catch(() => null), OFFLINE_LOOKUP_TIMEOUT_MS, null)
  };
}

applyTheme(readAppTheme(localStorage));
window.offlineBibleRepository = createOfflineLookup();

let keepAliveScheduled = false;
mountReadApp({
  doc: document,
  storage: localStorage,
  books: window.BIBLE_BOOKS,
  fetchChapter: (bookEng, chapter, version) => window.fetchBibleChapter(bookEng, chapter, version),
  // 翻頁時預覽下一章：只看已經抓過（預抓、讀過）的記憶體快取，不另外發請求。
  peekChapter: (bookEng, chapter, version) => {
    const key = window.getBibleChapterCacheKey ? window.getBibleChapterCacheKey(bookEng, chapter, version) : `${version}_${bookEng}_${chapter}`;
    return window._bibleChapterCache ? window._bibleChapterCache[key] : null;
  },
  getVerseCounts: () => window.BIBLE_VERSE_COUNTS || null,
  hydrateIcons: typeof window.hydrateIcons === "function" ? window.hydrateIcons : null,
  copy: (window.APP_COPY && window.APP_COPY.reader) || {},
  isOnline: () => navigator.onLine !== false,
  onChapterShown: () => {
    if (keepAliveScheduled) return;
    keepAliveScheduled = true;
    setTimeout(() => {
      keepLoginFresh({
        storage: localStorage,
        loadAuth: async () => {
          await import("./auth.js");
          return window.auth;
        }
      });
    }, KEEPALIVE_DELAY_MS);
  }
});
