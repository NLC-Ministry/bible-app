// /read 獨立讀經頁的畫面（#416、#423）：版面、操作和主 App 讀經頁一致——
// 目錄（共用 bible-nav-directory.mjs）、左右滑動換章＋翻頁動畫、浮動上一章／下一章、章末連結、
// 點選經文後複製／分享（格式共用 verse-selection-format.mjs）、譯本選單、文字大小。
// 不碰登入、不記錄進度、沒有螢光筆／筆記／朗讀。所有外部依賴由 read-entry.js 注入，測試時換成假的。

import { createReaderSwipeController, readerArrowKeyDirection, resolveAdjacentChapter, resolvePrefetchChapters } from "../modules/reader-chapter-nav.mjs";
import { buildChapterPreview, buildViewportSnapshot, createReaderPageFlip } from "../modules/reader-page-flip.mjs";
import { buildChapterEndNav, createVerseElement, revealVerses } from "../modules/reader-verse-dom.mjs";
import { formatVerseSelectionText, groupVerseSelectionRuns } from "../modules/verse-selection-format.mjs";
import { createBibleNavDirectory, isEnglishBibleVersion, readerBookLabel } from "../modules/bible-nav-directory.mjs";
import { withSoftTimeout } from "../net-timeout.mjs";
import {
  READER_FONT_SIZES,
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
const FLIP_PREVIEW_VERSES = 40; // 同主 App 的 READER_FLIP_PREVIEW_VERSES

// 譯本的短標籤：同主 App（只有修訂版顯示成 RCUV）。
export function versionLabel(version) {
  return version === "RCUVTS" ? "RCUV" : version;
}

export function bookLabel(book, version) {
  return readerBookLabel(book, isEnglishBibleVersion(version));
}

function readLastChapter(storage) {
  try { return JSON.parse(storage.getItem(LAST_CHAPTER_KEY) || "null"); } catch { return null; }
}

function writeLastChapter(storage, entry) {
  try { storage.setItem(LAST_CHAPTER_KEY, JSON.stringify(entry)); } catch { /* 空間不足就算了 */ }
}

export function mountReadApp({
  doc,
  win = doc.defaultView,
  storage,
  books,
  fetchChapter,
  peekChapter = () => null,
  getVerseCounts = () => null,
  isOnline = () => true,
  schedule = (fn, ms) => setTimeout(fn, ms),
  chapterTimeoutMs = CHAPTER_TIMEOUT_MS,
  onChapterShown = () => {},
  hydrateIcons = null,
  copy = {},
  clipboard = win?.navigator?.clipboard || null,
  share = win?.navigator?.share ? (data => win.navigator.share(data)) : null
}) {
  const $ = id => doc.getElementById(id);
  const readerView = $("reader-view");
  const surface = doc.querySelector("#reader-view .reader-reading-surface");
  const titleEl = $("bible-title");
  const content = $("bible-content");
  const versionModal = $("bible-version-picker-modal");
  const settingsBackdrop = $("typography-settings-backdrop");
  const selectionRoot = $("selection-bottom-bar-root");
  const hydrate = el => { if (typeof hydrateIcons === "function" && el) hydrateIcons(el); };

  const prefs = readReaderPreferences(storage, books);
  const view = { bookId: prefs.bookId, chapter: prefs.chapter, version: prefs.version, fontSize: prefs.fontSize };
  let loadSeq = 0;
  let renderedChapter = { bookId: 0, bookName: "", chapter: 0, textByVerse: new Map() };
  const selection = new Map();

  const findBook = id => books.find(b => Number(b.id) === Number(id));
  const english = () => isEnglishBibleVersion(view.version);
  const headingText = (book, chapter) => (english() ? `${book.eng} Chapter ${chapter}` : `${book.name} ${chapter}章`);
  const canNavigate = direction => Boolean(resolveAdjacentChapter(books, view.bookId, view.chapter, direction));

  // ── 面板開關：同主 App 的 openReaderLayer／closeReaderLayer ──
  function openLayer(element) {
    if (!element) return;
    element.classList.remove("hidden");
    element.style.pointerEvents = "auto";
    element.setAttribute("aria-hidden", "false");
    doc.body.classList.add("reader-modal-open");
  }

  function closeLayer(element) {
    if (!element) return;
    element.classList.add("hidden");
    element.style.pointerEvents = "none";
    element.setAttribute("aria-hidden", "true");
    const stillOpen = doc.querySelector(".full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden)");
    doc.body.classList.toggle("reader-modal-open", Boolean(stillOpen));
  }

  const layerOpen = () => Boolean(
    doc.body.classList.contains("reader-modal-open")
    || doc.querySelector("#bible-version-picker-modal:not(.hidden), .full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden)")
  );

  function toast(message) {
    const el = doc.createElement("div");
    el.className = "read-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    doc.body.appendChild(el);
    schedule(() => el.remove(), 2200);
  }

  // ── 工具列與字級 ──
  function updateChrome() {
    const book = findBook(view.bookId);
    const label = versionLabel(view.version);
    $("reader-nav-ref-label").textContent = `${readerBookLabel(book, english())} ${view.chapter}`;
    $("reader-version-inline").textContent = label;
    const versionSpan = $("reader-nav-version-btn")?.querySelector("span");
    if (versionSpan) versionSpan.textContent = label;
    const navBadge = $("bible-nav-version-badge");
    if (navBadge) navBadge.textContent = label;
    $("floating-prev-btn").disabled = !canNavigate(-1);
    $("floating-next-btn").disabled = !canNavigate(1);
  }

  function applyFontSize() {
    const size = view.fontSize;
    doc.documentElement.style.setProperty("--reader-font-size", size + "px");
    readerView?.style.setProperty("--reader-font-size", size + "px");
    content.style.setProperty("font-size", size + "px", "important");
    content.querySelectorAll(".verse-text, .verse-num").forEach(el => el.style.setProperty("font-size", size + "px", "important"));
    const output = $("reader-font-size-value");
    if (output) output.textContent = `${size}px`;
    doc.querySelectorAll(".reader-font-size-tick").forEach(button => {
      const active = Number(button.dataset.readerFontSize) === size;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setFontSize(size) {
    view.fontSize = normalizeReaderFontSize(size);
    writeReaderFontSize(storage, view.fontSize);
    applyFontSize();
  }

  // ── 經文與選取 ──
  const selKey = (bookId, chapter, verse) => `${bookId}_${chapter}_${verse}`;

  function selectedSorted() {
    const order = new Map(books.map((b, i) => [b.id, i]));
    return Array.from(selection.values()).sort((a, b) =>
      (order.get(a.bookId) ?? 999) - (order.get(b.bookId) ?? 999) || a.chapter - b.chapter || a.verse - b.verse);
  }

  function applySelectionClasses() {
    content.querySelectorAll(".bible-verse[data-verse]").forEach(el => {
      const on = selection.has(selKey(renderedChapter.bookId, renderedChapter.chapter, Number(el.dataset.verse)));
      el.classList.toggle("verse-selected", on);
      el.setAttribute("aria-pressed", String(on));
    });
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function renderSelectionBar() {
    if (!selectionRoot) return;
    const sorted = selectedSorted();
    if (!sorted.length) { selectionRoot.innerHTML = ""; return; }
    const crossChapter = new Set(sorted.map(v => `${v.bookId}_${v.chapter}`)).size > 1;
    const runs = groupVerseSelectionRuns(sorted, v => selKey(v.bookId, v.chapter, v.verse));
    const chips = runs.map(r => {
      const vpart = r.startVerse === r.endVerse ? `${r.startVerse}` : `${r.startVerse}-${r.endVerse}`;
      const abbrev = findBook(r.bookId)?.abbrev || r.bookName;
      const ref = crossChapter ? `${abbrev}${r.chapter}:${vpart}` : `${r.chapter}:${vpart}`;
      return `<button type="button" class="yv-chip" role="listitem" data-remove-keys="${escapeText(r.keys.join(","))}" aria-label="移除 ${escapeText(r.bookName)} ${r.chapter}:${vpart}">
      <span class="yv-chip-ref">${escapeText(ref)}</span>
      <span class="nlc-icon" data-icon="close" aria-hidden="true"></span>
    </button>`;
    }).join("");
    selectionRoot.innerHTML = `
    <div id="pwa-selection-bottom-bar" class="youversion-action-bar active${sorted.length === 1 ? "" : " youversion-action-bar--multi"}">
      <div class="yv-bar-top-row">
        <div class="yv-selection-strip" role="list" aria-label="已選取的經文（共 ${sorted.length} 節）">${chips}</div>
        <button type="button" class="yv-multi-cancel-button" data-action="clear-all" aria-label="全部取消" title="全部取消">
          <span class="nlc-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
      <div class="yv-content-row">
        <div class="yv-action-group" data-yv-panel="actions">
          <button type="button" class="yv-tile" data-action="copy">
            <span class="nlc-icon" data-icon="copy" aria-hidden="true"></span>
            <span class="yv-tile-label">複製</span>
          </button>
          <button type="button" class="yv-tile" data-action="share">
            <span class="nlc-icon" data-icon="share" aria-hidden="true"></span>
            <span class="yv-tile-label">分享</span>
          </button>
        </div>
      </div>
    </div>`;
    hydrate(selectionRoot);
  }

  function refreshSelection() {
    applySelectionClasses();
    renderSelectionBar();
  }

  function toggleVerse(verse) {
    const { bookId, bookName, chapter, textByVerse } = renderedChapter;
    if (!verse || !textByVerse.has(verse)) return;
    const key = selKey(bookId, chapter, verse);
    if (selection.has(key)) selection.delete(key);
    else selection.set(key, { bookId, bookName, chapter, verse, text: textByVerse.get(verse) });
    refreshSelection();
  }

  function clearSelection() {
    selection.clear();
    refreshSelection();
  }

  async function copySelection() {
    const text = formatVerseSelectionText(selectedSorted());
    if (!text) return;
    try {
      if (!clipboard) throw new Error("no clipboard");
      await clipboard.writeText(text);
      toast("經文已複製到剪貼簿！");
    } catch {
      toast("這台裝置不支援複製，請長按經文選取文字");
    }
  }

  async function shareSelection() {
    const text = formatVerseSelectionText(selectedSorted());
    if (!text) return;
    if (share) {
      try { await share({ title: "經文分享", text }); } catch { /* 使用者取消 */ }
      return;
    }
    await copySelection();
  }

  selectionRoot?.addEventListener("click", event => {
    const target = event.target.closest?.("[data-remove-keys], [data-action]");
    if (!target) return;
    if (target.dataset.removeKeys) {
      target.dataset.removeKeys.split(",").forEach(k => selection.delete(k));
      refreshSelection();
      return;
    }
    if (target.dataset.action === "clear-all") clearSelection();
    if (target.dataset.action === "copy") copySelection();
    if (target.dataset.action === "share") shareSelection();
  });

  function renderVerses(book, chapter, verses) {
    renderedChapter = {
      bookId: book.id,
      bookName: book.name,
      chapter,
      textByVerse: new Map(verses.map(v => [Number(v.verse), String(v.text ?? "")]))
    };
    titleEl.textContent = headingText(book, chapter);
    content.textContent = "";
    const fragment = doc.createDocumentFragment();
    verses.forEach(v => fragment.appendChild(createVerseElement(doc, v, { allowHtml: false })));
    content.appendChild(fragment);
    content.appendChild(buildChapterEndNav({ doc, books, bookId: book.id, chapter, copy, hydrateIcons }));
    content.dataset.ready = "1";
    applyFontSize();
    applySelectionClasses();
    const announcer = $("reader-chapter-announcer");
    if (announcer) announcer.textContent = String(copy.chapterChanged || "已切換到 {chapter}").replace("{chapter}", headingText(book, chapter));
  }

  function renderMessage(title, detail, { retry = false } = {}) {
    content.textContent = "";
    const box = doc.createElement("div");
    box.className = "read-message";
    const titleNode = doc.createElement("p");
    titleNode.className = "read-message__title";
    titleNode.textContent = title;
    box.appendChild(titleNode);
    if (detail) {
      const detailNode = doc.createElement("p");
      detailNode.className = "read-message__detail";
      detailNode.textContent = detail;
      box.appendChild(detailNode);
    }
    if (retry) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "read-button read-button--primary";
      button.textContent = "重新載入";
      button.addEventListener("click", () => loadChapter());
      box.appendChild(button);
    }
    content.appendChild(box);
    content.dataset.ready = "1";
  }

  // 預抓的章數和方向照共用規則（#440）。經文包譯本、離線時也抓：fetchChapter 會從本機或快取讀，
  // 抓到的也是翻頁預覽（peekChapter）的來源。
  function prefetchAround(seq) {
    const { bookId, chapter, version } = view;
    schedule(async () => {
      for (const target of resolvePrefetchChapters(books, bookId, chapter)) {
        if (seq !== loadSeq) return; // 已經換章或換譯本，下一次會自己預抓
        try { await fetchChapter(target.book.eng, target.chapter, version); } catch { /* 預抓失敗不影響閱讀 */ }
      }
    }, 800);
  }

  async function loadChapter() {
    const seq = ++loadSeq;
    const book = findBook(view.bookId);
    const { chapter, version } = view;
    updateChrome();
    writeReaderPosition(storage, { bookId: book.id, chapter });
    titleEl.textContent = headingText(book, chapter);
    content.dataset.ready = "";
    content.textContent = "";
    const status = doc.createElement("p");
    status.className = "read-status";
    status.textContent = "正在打開經文…";
    content.appendChild(status);

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
      prefetchAround(seq);
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
    if (surface) surface.scrollTop = 0;
    return loadChapter();
  }

  function step(direction) {
    const target = resolveAdjacentChapter(books, view.bookId, view.chapter, direction);
    if (!target) return Promise.resolve(false);
    return goTo(target.book.id, target.chapter).then(() => true);
  }

  // ── 翻頁動畫與左右滑動換章：同主 App（reader-page-flip.mjs、reader-chapter-nav.mjs）──
  function getStageRect() {
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    let bottom = Math.min(rect.bottom, win?.innerHeight || rect.bottom);
    const bar = doc.querySelector(".youversion-action-bar");
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      if (barRect.height > 0 && barRect.top > top && barRect.top < bottom) bottom = barRect.top;
    }
    return { left: rect.left, right: rect.right, width: rect.width, top, bottom, height: bottom - top };
  }

  const pageFlip = readerView ? createReaderPageFlip({
    host: readerView,
    getStageRect,
    buildCurrentPage: stageRect => buildViewportSnapshot({
      header: surface?.querySelector(".reader-header"), container: content, stageRect, doc
    }),
    buildTargetPage: (direction, stageRect) => {
      const target = resolveAdjacentChapter(books, view.bookId, view.chapter, direction);
      if (!target) return null;
      const cached = peekChapter(target.book.eng, target.chapter, view.version);
      const verses = cached && !cached.isPlaceholder && Array.isArray(cached.verses) && cached.verses.length ? cached.verses : null;
      return buildChapterPreview({
        header: surface?.querySelector(".reader-header"),
        container: content,
        surface,
        stageRect,
        headingText: headingText(target.book, target.chapter),
        doc,
        fillContent: shell => {
          if (!verses) return; // 還沒預載到：空白頁照樣翻過去，之後顯示「正在打開經文」
          verses.slice(0, FLIP_PREVIEW_VERSES).forEach(v => shell.appendChild(createVerseElement(doc, v, { allowHtml: false })));
        }
      });
    },
    onCommit: direction => step(direction),
    win,
    doc,
    storage
  }) : null;

  const prefersReducedMotion = () => Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  // 按鈕、鍵盤、章末連結共用：播完整個翻頁並換章。
  function flipTo(direction) {
    if (!direction || !canNavigate(direction)) return Promise.resolve(false);
    if (!pageFlip || prefersReducedMotion()) return step(direction);
    return pageFlip.play(direction);
  }

  let flipStartScrollTop = null;
  createReaderSwipeController({
    surface: readerView,
    isEnabled: () => !layerOpen(),
    canNavigate,
    onGestureStart: () => { pageFlip?.finishNow(); },
    onDragStart: direction => {
      // 確定是左右翻頁：記住捲動位置並暫停上下捲動，避免慣性蓋掉換章後的「捲回開頭」（#380）。
      flipStartScrollTop = surface ? surface.scrollTop : null;
      surface?.classList.add("reader-flip-scroll-locked");
      pageFlip?.begin(direction);
    },
    onDrag: (_direction, { progress }) => { pageFlip?.update(progress); },
    onDragEnd: ({ direction, commit, velocity, immediate }) => {
      surface?.classList.remove("reader-flip-scroll-locked");
      if (!commit && flipStartScrollTop !== null && surface) surface.scrollTop = flipStartScrollTop;
      flipStartScrollTop = null;
      const done = pageFlip ? pageFlip.release({ direction, commit, velocity, immediate }) : (commit ? step(direction) : null);
      if (commit) Promise.resolve(done).then(moved => { if (moved !== false && surface) surface.scrollTop = 0; });
    },
    win
  });

  // ── 目錄：和主 App 同一份 ──
  const directory = createBibleNavDirectory({
    doc,
    books,
    getVerseCounts,
    getVersion: () => view.version,
    getPosition: () => ({ bookId: view.bookId, chapter: view.chapter }),
    onSelect: async ({ bookId, chapter, verse, highlightVerses }) => {
      await goTo(bookId, chapter);
      revealVerses(content, verse, highlightVerses, { schedule });
    },
    openLayer,
    closeLayer,
    onVersionBadge: () => openVersionPicker(),
    hydrateIcons
  });

  // ── 譯本選單 ──
  function openVersionPicker() {
    if (!versionModal) return;
    versionModal.querySelectorAll(".version-option-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.version === view.version);
    });
    versionModal.classList.remove("hidden");
    versionModal.setAttribute("aria-hidden", "false");
  }

  function closeVersionPicker() {
    if (!versionModal) return;
    versionModal.classList.add("hidden");
    versionModal.setAttribute("aria-hidden", "true");
  }

  function setVersion(code) {
    const next = normalizeReaderVersion(code);
    closeVersionPicker();
    if (next === view.version) return Promise.resolve();
    view.version = next;
    writeReaderVersion(storage, next);
    return loadChapter();
  }

  // ── 事件 ──
  content.addEventListener("click", event => {
    const navButton = event.target.closest?.("[data-chapter-nav]");
    if (navButton && content.contains(navButton)) {
      event.preventDefault();
      flipTo(Number(navButton.dataset.chapterNav));
      return;
    }
    const verseDiv = event.target.closest?.(".bible-verse[data-verse]");
    if (verseDiv && content.contains(verseDiv)) toggleVerse(Number(verseDiv.dataset.verse));
  });
  content.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const verseDiv = event.target.closest?.(".bible-verse[data-verse]");
    if (!verseDiv || event.target !== verseDiv) return;
    event.preventDefault();
    toggleVerse(Number(verseDiv.dataset.verse));
  });

  $("reader-nav-directory-btn")?.addEventListener("click", () => directory.open());
  $("reader-book-badge")?.addEventListener("click", () => directory.open());
  $("reader-nav-version-btn")?.addEventListener("click", openVersionPicker);
  $("version-picker-close")?.addEventListener("click", closeVersionPicker);
  $("version-picker-backdrop")?.addEventListener("click", closeVersionPicker);
  versionModal?.querySelectorAll(".version-option-btn").forEach(btn => {
    btn.addEventListener("click", () => setVersion(btn.dataset.version));
  });
  $("floating-prev-btn")?.addEventListener("click", () => flipTo(-1));
  $("floating-next-btn")?.addEventListener("click", () => flipTo(1));
  $("reader-settings-trigger-btn")?.addEventListener("click", event => {
    event.stopPropagation();
    openLayer(settingsBackdrop);
    applyFontSize();
  });
  $("typography-sheet-close-btn")?.addEventListener("click", () => closeLayer(settingsBackdrop));
  settingsBackdrop?.addEventListener("click", event => { if (event.target === settingsBackdrop) closeLayer(settingsBackdrop); });
  doc.querySelectorAll(".reader-font-size-tick").forEach(button => {
    button.addEventListener("click", () => setFontSize(Number(button.dataset.readerFontSize)));
  });
  doc.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (versionModal && !versionModal.classList.contains("hidden")) closeVersionPicker();
      else if (settingsBackdrop && !settingsBackdrop.classList.contains("hidden")) closeLayer(settingsBackdrop);
      else if (!directory.overlay.classList.contains("hidden")) directory.close();
      return;
    }
    if (layerOpen()) return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")) return;
    const direction = readerArrowKeyDirection(event);
    if (!direction || !canNavigate(direction)) return;
    event.preventDefault();
    flipTo(direction);
  });

  hydrate(doc.body);
  applyFontSize();
  const ready = loadChapter();
  return {
    ready,
    view,
    goTo,
    step,
    flipTo,
    setVersion,
    setFontSize,
    directory,
    toggleVerse,
    clearSelection,
    copySelection,
    shareSelection,
    selection,
    get fontSizes() { return READER_FONT_SIZES; }
  };
}
