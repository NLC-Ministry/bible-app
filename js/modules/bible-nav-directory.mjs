// 聖經目錄（#423）：主 App 讀經頁（bible.js）和快速啟動的讀經頁 /read 共用同一份程式與面板。
// 書卷／章／節三個分頁、打「約 3:16」直接跳、格狀／清單、舊約／新約分區、選節後捲過去閃一下。
//
// 每一頁注入自己的部分：目前的譯本與位置、選好之後要做什麼（onSelect）、開關面板的方式、圖示。
// 面板 HTML：主 App 寫在 index.html（其他程式和測試依賴它的位置）；/read 用下面的範本建出來。
// 兩份必須一模一樣——scripts/bible-nav-directory.test.mjs 會用 DOM 比對。

import { filterBibleBooks, parseBibleReference } from "./bible-reference-parser.mjs";

export const BIBLE_NAV_OVERLAY_HTML = `
  <div class="full-page-overlay bible-nav-sheet hidden" id="bible-nav-overlay" aria-hidden="true">
    <header class="overlay-header bible-native-overlay-header bible-nav-sheet__header">
      <button type="button" class="overlay-back-btn bible-nav-sheet__back" id="bible-nav-back-btn"
        aria-label="返回">
        <span class="nlc-icon nlc-icon--md nav-back-chevron" data-icon="chevronLeft" aria-hidden="true"></span>
        <span>返回</span>
      </button>
      <div class="overlay-title bible-nav-sheet__title" id="bible-nav-title">目錄</div>
      <button type="button" class="overlay-version bible-nav-sheet__badge" id="bible-nav-version-badge">CUNP</button>
    </header>

    <div class="segmented-control bible-nav-sheet__tabs segment-track" role="tablist" aria-label="聖經導覽">
      <button type="button" class="segmented-tab segment-toggle-btn active" data-tab="book" role="tab">卷</button>
      <button type="button" class="segmented-tab segment-toggle-btn" data-tab="chapter" role="tab">章</button>
      <button type="button" class="segmented-tab segment-toggle-btn" data-tab="verse" role="tab">節</button>
    </div>

    <div class="mode-selector-bar bible-nav-sheet__toolbar">
      <div class="search-input-wrapper bible-nav-sheet__filter" id="bible-nav-filter">
        <span class="nlc-icon search-icon-inside" data-icon="search" aria-hidden="true"></span>
        <input type="search" class="search-input-field bible-nav-sheet__filter-input" id="bible-nav-filter-input"
          placeholder="篩選書卷或輸入出處" aria-label="篩選書卷或輸入出處" autocomplete="off" enterkeyhint="go">
        <button type="button" class="search-clear-btn hidden" id="bible-nav-filter-clear-btn"
          aria-label="清除"><span class="nlc-icon" data-icon="closeOne"></span></button>
      </div>
      <div class="bible-nav-sheet__view-mode">
        <span class="bible-nav-sheet__toggle-label" id="bible-nav-view-label">檢視</span>
        <div class="view-mode-container bible-nav-sheet__toggle-group segment-track" role="group"
          aria-labelledby="bible-nav-view-label">
          <button type="button" class="view-mode-btn segment-toggle-btn active" id="view-mode-grid" title="網格"
            aria-label="網格">
            <span class="nlc-icon nlc-icon--sm" data-icon="gridFour" aria-hidden="true"></span>
          </button>
          <button type="button" class="view-mode-btn segment-toggle-btn" id="view-mode-list" title="清單" aria-label="清單">
            <span class="nlc-icon nlc-icon--sm" data-icon="unorderedList" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </div>

    <div class="overlay-scroll-content bible-nav-sheet__body" id="bible-nav-content"></div>
  </div>
`;

// 頁面上還沒有目錄面板（/read）就用範本建一個；已經有（主 App 的 index.html）就用現成的。
export function ensureBibleNavOverlay(doc) {
  let overlay = doc.getElementById("bible-nav-overlay");
  if (overlay) return overlay;
  const template = doc.createElement("template");
  template.innerHTML = BIBLE_NAV_OVERLAY_HTML.trim();
  overlay = template.content.firstElementChild;
  doc.body.appendChild(overlay);
  return overlay;
}

// ── 書名標籤：英文譯本用英文書名 ──
export const ENGLISH_BIBLE_VERSIONS = new Set(["ESV", "NIV", "NLT", "WEB"]);

export function isEnglishBibleVersion(version) {
  return ENGLISH_BIBLE_VERSIONS.has(String(version || "").toUpperCase());
}

export function readerBookLabel(book, english) {
  if (!book) return "";
  return english ? book.eng : book.name;
}

export function readerBookAbbreviation(book, english) {
  if (!book) return "";
  if (!english) return book.abbrev;
  const match = String(book.eng || "").match(/^(\d\s+)?([A-Za-z]+)/);
  return match ? `${match[1] || ""}${match[2].slice(0, 4)}`.trim() : book.eng;
}

// ── 輸入出處直接跳轉（#362）：目錄篩選與主 App 的搜尋提示共用 ──
export function parseReaderReferenceQuery(query, { books, verseCounts = null, english = false }) {
  return parseBibleReference(query, { books, verseCounts, language: english ? "en" : "zh" });
}

export function isReaderReferenceResult(parsed) {
  return Boolean(parsed) && (parsed.kind === "reference" || parsed.kind === "choices" || parsed.kind === "error");
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createBibleNavDirectory({
  doc = document,
  books,
  getVerseCounts = () => null,
  getVersion = () => "CUNP",
  getPosition = () => ({ bookId: 1, chapter: 1 }),
  onSelect,
  openLayer,
  closeLayer,
  onVersionBadge = null,
  hydrateIcons = null
}) {
  const overlay = ensureBibleNavOverlay(doc);
  const $ = id => doc.getElementById(id);
  const state = {
    activeTab: "book",
    selectedBookId: 1,
    selectedChapter: 1,
    selectedVerse: 1,
    viewMode: "grid",
    autoAdvance: true,
    filterQuery: ""
  };

  const english = () => isEnglishBibleVersion(getVersion());
  const bookLabel = book => readerBookLabel(book, english());
  const bookAbbrev = book => readerBookAbbreviation(book, english());
  const parseReference = query => parseReaderReferenceQuery(query, { books, verseCounts: getVerseCounts(), english: english() });

  function clearFilter() {
    state.filterQuery = "";
    const input = $("bible-nav-filter-input");
    if (input) input.value = "";
    $("bible-nav-filter-clear-btn")?.classList.add("hidden");
  }

  function bindFilter() {
    const input = $("bible-nav-filter-input");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "true";
    const clearBtn = $("bible-nav-filter-clear-btn");
    input.addEventListener("input", () => {
      state.filterQuery = input.value;
      if (clearBtn) clearBtn.classList.toggle("hidden", !input.value);
      if (state.activeTab === "book") render();
    });
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        clearFilter();
        if (state.activeTab === "book") render();
        input.focus();
      });
    }
    input.addEventListener("keydown", (e) => {
      // 中文輸入法選字時的 Enter 不算送出。
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      const query = input.value.trim();
      if (!query) return;
      const parsed = parseReference(query);
      if (parsed.kind === "reference") {
        e.preventDefault();
        jumpToReference(parsed);
        return;
      }
      if (isReaderReferenceResult(parsed)) return;
      // 只有書卷：進 Enter 目標那一卷；篩到只剩一卷時也一樣。
      const { books: matched, target } = filterBibleBooks(query, { books, language: english() ? "en" : "zh" });
      const book = target || (matched.length === 1 ? matched[0] : null);
      if (book) {
        e.preventDefault();
        selectBook(book.id);
      }
    });
  }

  function updateHeader() {
    const titleEl = $("bible-nav-title");
    if (!titleEl) return;
    const book = books.find(b => b.id === state.selectedBookId);
    const isEnglish = english();
    const label = bookLabel(book);
    if (state.activeTab === "book") {
      titleEl.textContent = isEnglish ? "Select Book" : "選擇書卷";
    } else if (state.activeTab === "chapter") {
      titleEl.textContent = book ? label : (isEnglish ? "Select Chapter" : "選擇章節");
    } else if (state.activeTab === "verse") {
      titleEl.textContent = book
        ? (isEnglish ? `${label} Chapter ${state.selectedChapter}` : `${label} ${state.selectedChapter}章`)
        : (isEnglish ? "Select Verse" : "選擇節");
    }
  }

  function updateLocale() {
    const isEnglish = english();
    const backText = doc.querySelector("#bible-nav-back-btn span:last-child");
    if (backText) backText.textContent = isEnglish ? "Back" : "返回";
    const tabLabels = isEnglish
      ? { book: "Book", chapter: "Chapter", verse: "Verse" }
      : { book: "卷", chapter: "章", verse: "節" };
    overlay.querySelectorAll(".segmented-tab").forEach(tab => {
      tab.textContent = tabLabels[tab.dataset.tab] || tab.textContent;
    });
    const viewLabel = $("bible-nav-view-label");
    if (viewLabel) viewLabel.textContent = isEnglish ? "View" : "檢視";
    const filterInput = $("bible-nav-filter-input");
    if (filterInput) {
      filterInput.placeholder = isEnglish ? "Filter books or enter a reference" : "篩選書卷或輸入出處";
      filterInput.setAttribute("aria-label", filterInput.placeholder);
    }
    const filterClearBtn = $("bible-nav-filter-clear-btn");
    if (filterClearBtn) filterClearBtn.setAttribute("aria-label", isEnglish ? "Clear" : "清除");
    const gridBtn = $("view-mode-grid");
    const listBtn = $("view-mode-list");
    if (gridBtn) {
      gridBtn.title = isEnglish ? "Grid" : "網格";
      gridBtn.setAttribute("aria-label", gridBtn.title);
    }
    if (listBtn) {
      listBtn.title = isEnglish ? "List" : "清單";
      listBtn.setAttribute("aria-label", listBtn.title);
    }
    updateHeader();
  }

  function createReferenceJumpCard(result, isEnglish) {
    const card = doc.createElement("button");
    card.type = "button";
    card.className = "reference-jump-card";
    if (result.kind === "reference") {
      card.innerHTML = `
      <span class="nlc-icon reference-jump-card__icon" data-icon="bookOpen" aria-hidden="true"></span>
      <span class="reference-jump-card__body">
        <span class="reference-jump-card__eyebrow">${isEnglish ? "Go to" : "前往"}</span>
        <span class="reference-jump-card__title">${escapeText(result.label)}</span>
      </span>
      <span class="nlc-icon reference-jump-card__chevron" data-icon="chevronRight" aria-hidden="true"></span>
    `;
      card.addEventListener("click", () => jumpToReference(result));
    } else {
      card.disabled = true;
      card.classList.add("reference-jump-card--disabled");
      const label = result.book ? (isEnglish ? result.book.eng : result.book.name) : "";
      card.innerHTML = `
      <span class="nlc-icon reference-jump-card__icon" data-icon="bookOpen" aria-hidden="true"></span>
      <span class="reference-jump-card__body">
        ${label ? `<span class="reference-jump-card__eyebrow">${escapeText(label)}</span>` : ""}
        <span class="reference-jump-card__hint">${escapeText(result.message || "")}</span>
      </span>
    `;
    }
    return card;
  }

  // 在 container 裡畫出「前往」卡片／多卷候選／錯誤說明；回傳是否有畫東西。
  function renderReferenceActions(container, parsed) {
    if (!container) return false;
    container.innerHTML = "";
    if (!isReaderReferenceResult(parsed)) return false;
    const isEnglish = english();
    if (parsed.kind === "choices") {
      const note = doc.createElement("div");
      note.className = "reference-jump-note";
      note.textContent = isEnglish ? "Which book did you mean?" : "要找的是哪一卷？";
      container.appendChild(note);
      parsed.choices.forEach(choice => container.appendChild(createReferenceJumpCard(choice, isEnglish)));
    } else {
      container.appendChild(createReferenceJumpCard(parsed, isEnglish));
    }
    if (typeof hydrateIcons === "function") hydrateIcons(container);
    return true;
  }

  function render() {
    const container = $("bible-nav-content");
    if (!container) return;
    container.innerHTML = "";
    const book = books.find(b => b.id === state.selectedBookId);
    const filterWrap = $("bible-nav-filter");
    if (filterWrap) filterWrap.classList.toggle("hidden", state.activeTab !== "book");
    const toolbar = overlay.querySelector(".mode-selector-bar");
    const isEnglish = english();

    if (state.activeTab === "book") {
      if (toolbar) toolbar.style.display = "flex";

      // #362：篩選書卷；輸入完整出處時最上方出現「前往」列。
      const filterQuery = String(state.filterQuery || "").trim();
      const { books: visibleBooks, filtered } = filterBibleBooks(filterQuery, {
        books,
        language: isEnglish ? "en" : "zh"
      });
      if (filterQuery) {
        const parsed = parseReference(filterQuery);
        if (isReaderReferenceResult(parsed)) {
          const actions = doc.createElement("div");
          actions.className = "reference-jump-panel bible-nav-reference";
          renderReferenceActions(actions, parsed);
          container.appendChild(actions);
        }
      }
      if (filtered && !visibleBooks.length) {
        if (!container.childElementCount) {
          const empty = doc.createElement("div");
          empty.className = "bible-nav-empty";
          empty.textContent = isEnglish ? "No matching books" : "找不到符合的書卷";
          container.appendChild(empty);
        }
        return;
      }
      const hasOld = visibleBooks.some(b => b.section === "old");
      const hasNew = visibleBooks.some(b => b.section !== "old");
      const sectionTitle = text => {
        const el = doc.createElement("div");
        el.className = "bible-nav-section-title";
        el.textContent = text;
        return el;
      };
      const oldSection = sectionTitle(isEnglish ? "Old Testament" : "舊約聖經");
      const newSection = sectionTitle(isEnglish ? "New Testament" : "新約聖經");
      const listClass = state.viewMode === "grid" ? "bible-nav-grid" : "bible-nav-list";
      const oldList = doc.createElement("div");
      oldList.className = listClass;
      const newList = doc.createElement("div");
      newList.className = listClass;

      visibleBooks.forEach(b => {
        const item = doc.createElement("div");
        if (state.viewMode === "grid") {
          item.className = "grid-item-book";
          item.innerHTML = `
          <span class="abbrev-title">${escapeText(bookAbbrev(b))}</span>
          <span class="full-title">${escapeText(bookLabel(b))}</span>
        `;
        } else {
          item.className = "book-list-item-asym";
          item.innerHTML = `
          <div class="book-brand-box">${escapeText(bookAbbrev(b))}</div>
          <div class="book-names-box">
            <span class="book-full-title">${escapeText(bookLabel(b))}</span>
            ${isEnglish ? "" : `<span class="book-english-sub">${escapeText(b.eng)}</span>`}
          </div>
        `;
        }
        item.classList.toggle("active", b.id === state.selectedBookId);
        item.addEventListener("click", () => selectBook(b.id));
        (b.section === "old" ? oldList : newList).appendChild(item);
      });

      if (hasOld) container.append(oldSection, oldList);
      if (hasNew) container.append(newSection, newList);
    } else if (state.activeTab === "chapter") {
      if (toolbar) toolbar.style.display = "none";
      const grid = doc.createElement("div");
      grid.className = "chapter-nav-grid";
      const totalChapters = book ? book.chapters : 50;
      for (let c = 1; c <= totalChapters; c++) {
        const item = doc.createElement("div");
        item.className = "grid-item-number";
        item.classList.toggle("active", c === state.selectedChapter);
        item.textContent = c;
        item.addEventListener("click", () => selectChapter(c));
        grid.appendChild(item);
      }
      container.appendChild(grid);
    } else if (state.activeTab === "verse") {
      if (toolbar) toolbar.style.display = "none";
      const grid = doc.createElement("div");
      grid.className = "verse-nav-grid";
      let totalVerses = 30;
      const verseCounts = getVerseCounts();
      if (book && verseCounts) {
        const bookCounts = verseCounts[book.eng];
        if (bookCounts && bookCounts[state.selectedChapter - 1]) {
          totalVerses = bookCounts[state.selectedChapter - 1];
        }
      }
      for (let v = 1; v <= totalVerses; v++) {
        const item = doc.createElement("div");
        item.className = "grid-item-number";
        item.classList.toggle("active", v === state.selectedVerse);
        item.textContent = v;
        item.addEventListener("click", () => selectVerse(v));
        grid.appendChild(item);
      }
      container.appendChild(grid);
    }
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    if (tabName !== "book") clearFilter();
    overlay.querySelectorAll(".segmented-tab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    updateHeader();
    render();
  }

  function selectBook(bookId) {
    state.selectedBookId = bookId;
    state.selectedChapter = 1;
    switchTab("chapter");
  }

  function selectChapter(chapter) {
    state.selectedChapter = chapter;
    switchTab("verse");
  }

  // verse 為 null 時只換章（呼叫端捲回章首）；highlightVerses 為要一起閃底色的節（#362 範圍／頓號）。
  function selectVerse(verse, highlightVerses = null) {
    state.selectedVerse = verse || 1;
    closeLayer(overlay);
    return onSelect({
      bookId: state.selectedBookId,
      chapter: state.selectedChapter,
      verse: verse || null,
      highlightVerses
    });
  }

  function jumpToReference(reference) {
    if (!reference || reference.kind !== "reference" || !reference.book) return;
    state.selectedBookId = reference.book.id;
    state.selectedChapter = reference.chapter;
    const verses = Array.isArray(reference.verses) ? reference.verses : [];
    selectVerse(verses.length ? verses[0] : null, verses);
  }

  let controlsBound = false;
  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;
    const gridBtn = $("view-mode-grid");
    const listBtn = $("view-mode-list");
    overlay.querySelectorAll(".segmented-tab").forEach(tab => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });
    gridBtn?.addEventListener("click", () => {
      state.viewMode = "grid";
      gridBtn.classList.add("active");
      listBtn?.classList.remove("active");
      render();
    });
    listBtn?.addEventListener("click", () => {
      state.viewMode = "list";
      listBtn.classList.add("active");
      gridBtn?.classList.remove("active");
      render();
    });
    $("bible-nav-back-btn")?.addEventListener("click", () => {
      if (state.activeTab === "verse") switchTab("chapter");
      else if (state.activeTab === "chapter") switchTab("book");
      else closeLayer(overlay);
    });
    // 窄螢幕上讀經工具列的譯本鈕會被隱藏，目錄裡這顆徽章是改譯本的入口。
    $("bible-nav-version-badge")?.addEventListener("click", () => {
      closeLayer(overlay);
      if (typeof onVersionBadge === "function") onVersionBadge();
    });
  }

  function open() {
    const position = getPosition() || {};
    state.selectedBookId = position.bookId || 1;
    state.selectedChapter = position.chapter || 1;
    state.selectedVerse = 1;
    clearFilter();
    bindFilter();
    bindControls();
    updateLocale();
    openLayer(overlay);
    $("view-mode-grid")?.classList.toggle("active", state.viewMode === "grid");
    $("view-mode-list")?.classList.toggle("active", state.viewMode === "list");
    if (typeof hydrateIcons === "function") hydrateIcons(overlay);
    switchTab("book");
  }

  return {
    overlay,
    state,
    open,
    close: () => closeLayer(overlay),
    switchTab,
    render,
    selectBook,
    selectChapter,
    selectVerse,
    jumpToReference,
    parseReference,
    renderReferenceActions,
    updateLocale
  };
}
