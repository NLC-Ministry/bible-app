// /read 獨立讀經頁的畫面（#416）：選書卷章節、上一章／下一章、切換譯本、字級，打開回到上次的位置。
// 不碰登入、不記錄進度。所有外部依賴由 read-entry.js 注入，測試時換成假的。

import { resolveAdjacentChapter } from "../modules/reader-chapter-nav.mjs";
import { withSoftTimeout } from "../net-timeout.mjs";
import {
  READER_FONT_SIZES,
  READER_VERSIONS,
  normalizeReaderFontSize,
  normalizeReaderVersion,
  readReaderPreferences,
  writeReaderFontSize,
  writeReaderPosition,
  writeReaderVersion
} from "../data/reader-preferences.mjs";

// 上次顯示的那一章另存一份：SW 的經文快取每次部署都會清掉，有這份就算離線也打得開上次讀的地方。
export const LAST_CHAPTER_KEY = "read_last_chapter_v1";
export const CHAPTER_TIMEOUT_MS = 12000;
export const PREFETCH_COUNT = 3;

const ENGLISH_VERSIONS = new Set(["ESV", "NIV", "NLT", "WEB"]);

export function bookLabel(book, version) {
  return ENGLISH_VERSIONS.has(version) ? book.eng : book.name;
}

export function versionLabel(version) {
  return READER_VERSIONS.find(v => v.code === version)?.label || version;
}

function readLastChapter(storage) {
  try { return JSON.parse(storage.getItem(LAST_CHAPTER_KEY) || "null"); } catch { return null; }
}

function writeLastChapter(storage, entry) {
  try { storage.setItem(LAST_CHAPTER_KEY, JSON.stringify(entry)); } catch { /* 空間不足就算了 */ }
}

export function mountReadApp({
  doc,
  storage,
  books,
  fetchChapter,
  shouldPrefetch = () => false,
  isOnline = () => true,
  schedule = (fn, ms) => setTimeout(fn, ms),
  chapterTimeoutMs = CHAPTER_TIMEOUT_MS,
  prefetchCount = PREFETCH_COUNT,
  onChapterShown = () => {}
}) {
  const $ = id => doc.getElementById(id);
  const content = $("read-content");
  const refButton = $("read-ref-btn");
  const versionButton = $("read-version-btn");
  const prevButton = $("read-prev");
  const nextButton = $("read-next");
  const sheet = $("read-sheet");
  const sheetTitle = $("read-sheet-title");
  const sheetBody = $("read-sheet-body");

  const prefs = readReaderPreferences(storage, books);
  const view = { bookId: prefs.bookId, chapter: prefs.chapter, version: prefs.version, fontSize: prefs.fontSize };
  let loadSeq = 0;

  const findBook = id => books.find(b => Number(b.id) === Number(id));

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function applyFontSize() {
    content.style.setProperty("--read-font-size", view.fontSize + "px");
    $("read-font-down").disabled = view.fontSize <= READER_FONT_SIZES[0];
    $("read-font-up").disabled = view.fontSize >= READER_FONT_SIZES[READER_FONT_SIZES.length - 1];
  }

  function updateChrome() {
    const book = findBook(view.bookId);
    refButton.textContent = `${bookLabel(book, view.version)} ${view.chapter}`;
    versionButton.textContent = versionLabel(view.version);
    prevButton.disabled = !resolveAdjacentChapter(books, view.bookId, view.chapter, -1);
    nextButton.disabled = !resolveAdjacentChapter(books, view.bookId, view.chapter, 1);
  }

  function renderVerses(book, chapter, verses) {
    content.textContent = "";
    content.appendChild(el("h1", "read-chapter-title", `${bookLabel(book, view.version)} ${chapter}`));
    const list = el("div", "read-verses");
    for (const verse of verses) {
      const row = el("div", "bible-verse");
      row.dataset.verse = String(verse.verse);
      row.appendChild(el("span", "verse-num", String(verse.verse)));
      row.appendChild(el("span", "verse-text", String(verse.text ?? "")));
      list.appendChild(row);
    }
    content.appendChild(list);
    content.dataset.ready = "1";
  }

  function renderMessage(title, detail, { retry = false } = {}) {
    content.textContent = "";
    const box = el("div", "read-message");
    box.appendChild(el("p", "read-message__title", title));
    if (detail) box.appendChild(el("p", "read-message__detail", detail));
    if (retry) {
      const button = el("button", "read-button read-button--primary", "重新載入");
      button.type = "button";
      button.addEventListener("click", () => loadChapter());
      box.appendChild(button);
    }
    content.appendChild(box);
    content.dataset.ready = "1";
  }

  function prefetchAhead(seq) {
    if (!shouldPrefetch(view.version) || !isOnline()) return;
    const { version } = view;
    schedule(async () => {
      let cursor = { bookId: view.bookId, chapter: view.chapter };
      for (let i = 0; i < prefetchCount; i++) {
        if (seq !== loadSeq) return; // 已經換章或換譯本，下一次會自己預抓
        const next = resolveAdjacentChapter(books, cursor.bookId, cursor.chapter, 1);
        if (!next) return;
        try { await fetchChapter(next.book.eng, next.chapter, version); } catch { /* 預抓失敗不影響閱讀 */ }
        cursor = { bookId: next.book.id, chapter: next.chapter };
      }
    }, 800);
  }

  async function loadChapter() {
    const seq = ++loadSeq;
    const book = findBook(view.bookId);
    const { chapter, version } = view;
    updateChrome();
    writeReaderPosition(storage, { bookId: book.id, chapter });
    content.dataset.ready = "";
    content.textContent = "";
    content.appendChild(el("p", "read-status", "正在打開經文…"));

    let result = null;
    try {
      result = await withSoftTimeout(fetchChapter(book.eng, chapter, version), chapterTimeoutMs, null);
    } catch {
      result = null;
    }
    if (seq !== loadSeq) return;

    const usable = result && !result.isPlaceholder && Array.isArray(result.verses) && result.verses.length > 0;
    if (usable) {
      renderVerses(book, chapter, result.verses);
      writeLastChapter(storage, { version, bookId: book.id, chapter, verses: result.verses });
      onChapterShown();
      prefetchAhead(seq);
      return;
    }

    const last = readLastChapter(storage);
    if (last && last.version === version && Number(last.bookId) === book.id && Number(last.chapter) === chapter
      && Array.isArray(last.verses) && last.verses.length > 0) {
      renderVerses(book, chapter, last.verses);
      onChapterShown();
      return;
    }

    renderMessage(
      isOnline() ? "經文暫時載入不了" : "這一章需要網路才能讀取",
      isOnline() ? "請稍後再試一次。" : "連上網路後再試；讀過或預先存好的章節離線也能看。",
      { retry: true }
    );
    onChapterShown();
  }

  function goTo(bookId, chapter) {
    view.bookId = bookId;
    view.chapter = chapter;
    closeSheet();
    const scroller = doc.scrollingElement || doc.documentElement;
    if (scroller) scroller.scrollTop = 0;
    return loadChapter();
  }

  function step(direction) {
    const target = resolveAdjacentChapter(books, view.bookId, view.chapter, direction);
    if (target) return goTo(target.book.id, target.chapter);
    return null;
  }

  // ── 選擇面板（書卷→章節、譯本）──
  function openSheet(title) {
    sheetTitle.textContent = title;
    sheetBody.textContent = "";
    sheet.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    sheet.classList.add("hidden");
    sheet.setAttribute("aria-hidden", "true");
  }

  function showBookPicker(section = findBook(view.bookId)?.section || "old") {
    openSheet("選擇書卷");
    const tabs = el("div", "read-segmented");
    tabs.setAttribute("role", "tablist");
    for (const [key, label] of [["old", "舊約"], ["new", "新約"]]) {
      const tab = el("button", "read-segmented__item" + (key === section ? " is-active" : ""), label);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(key === section));
      tab.addEventListener("click", () => showBookPicker(key));
      tabs.appendChild(tab);
    }
    sheetBody.appendChild(tabs);
    const grid = el("div", "read-grid read-grid--books");
    for (const book of books.filter(b => b.section === section)) {
      const button = el("button", "read-grid__item" + (book.id === view.bookId ? " is-active" : ""), bookLabel(book, view.version));
      button.type = "button";
      button.dataset.bookId = String(book.id);
      button.addEventListener("click", () => showChapterPicker(book));
      grid.appendChild(button);
    }
    sheetBody.appendChild(grid);
  }

  function showChapterPicker(book) {
    openSheet(bookLabel(book, view.version));
    const back = el("button", "read-sheet__back", "‹ 書卷");
    back.type = "button";
    back.addEventListener("click", () => showBookPicker(book.section));
    sheetBody.appendChild(back);
    const grid = el("div", "read-grid read-grid--chapters");
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      const active = book.id === view.bookId && chapter === view.chapter;
      const button = el("button", "read-grid__item" + (active ? " is-active" : ""), String(chapter));
      button.type = "button";
      button.dataset.chapter = String(chapter);
      button.addEventListener("click", () => goTo(book.id, chapter));
      grid.appendChild(button);
    }
    sheetBody.appendChild(grid);
  }

  function showVersionPicker() {
    openSheet("選擇譯本");
    const list = el("div", "read-list");
    for (const version of READER_VERSIONS) {
      const active = version.code === view.version;
      const button = el("button", "read-list__item" + (active ? " is-active" : ""));
      button.type = "button";
      button.dataset.version = version.code;
      button.setAttribute("aria-pressed", String(active));
      button.appendChild(el("span", "read-list__label", `${version.label}`));
      button.appendChild(el("span", "read-list__name", version.name));
      button.addEventListener("click", () => setVersion(version.code));
      list.appendChild(button);
    }
    sheetBody.appendChild(list);
  }

  function setVersion(code) {
    view.version = normalizeReaderVersion(code);
    writeReaderVersion(storage, view.version);
    closeSheet();
    return loadChapter();
  }

  function setFontSize(size) {
    view.fontSize = normalizeReaderFontSize(size);
    writeReaderFontSize(storage, view.fontSize);
    applyFontSize();
  }

  function changeFont(direction) {
    const index = READER_FONT_SIZES.indexOf(view.fontSize);
    const next = READER_FONT_SIZES[Math.min(READER_FONT_SIZES.length - 1, Math.max(0, index + direction))];
    setFontSize(next);
  }

  refButton.addEventListener("click", () => showBookPicker());
  versionButton.addEventListener("click", showVersionPicker);
  prevButton.addEventListener("click", () => step(-1));
  nextButton.addEventListener("click", () => step(1));
  $("read-font-down").addEventListener("click", () => changeFont(-1));
  $("read-font-up").addEventListener("click", () => changeFont(1));
  $("read-sheet-close").addEventListener("click", closeSheet);
  sheet.addEventListener("click", event => { if (event.target === sheet) closeSheet(); });
  doc.addEventListener("keydown", event => {
    if (event.key === "Escape" && !sheet.classList.contains("hidden")) closeSheet();
    if (!sheet.classList.contains("hidden")) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")) return;
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });

  applyFontSize();
  const ready = loadChapter();
  return { ready, view, goTo, step, setVersion, setFontSize, showBookPicker, showVersionPicker };
}
