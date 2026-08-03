// js/modules/bible.js

import { createReaderBottomDwellController, observeReaderEndSentinel } from "./reader-bottom-dwell.mjs";
import { resolveReaderStartIndex, selectPreferredChineseVoice, selectPreferredVoice } from "./reader-speech.mjs";

export function openReaderLayer(element) {
  if (!element) return;
  element.classList.remove("hidden");
  element.style.pointerEvents = "auto";
  element.setAttribute("aria-hidden", "false");
  document.body.classList.add("reader-modal-open");
}

export function closeReaderLayer(element) {
  if (!element) return;
  element.classList.add("hidden");
  element.style.pointerEvents = "none";
  element.setAttribute("aria-hidden", "true");
  const stillOpen = document.querySelector(".full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden)");
  document.body.classList.toggle("reader-modal-open", Boolean(stillOpen));
}

export function releaseClosedReaderLayers() {
  document.querySelectorAll(
    ".full-page-overlay.hidden, .bottom-sheet-backdrop.hidden, .reader-search-panel.hidden, " +
    ".full-page-overlay[aria-hidden='true'], .bottom-sheet-backdrop[aria-hidden='true'], .reader-search-panel[aria-hidden='true']"
  ).forEach((layer) => {
    layer.style.pointerEvents = "none";
  });
}

function initSmartFloatingReaderNav() {
  const readerView = document.getElementById("reader-view");
  const floatPrev = document.getElementById("floating-prev-btn");
  const floatNext = document.getElementById("floating-next-btn");
  if (!readerView || (!floatPrev && !floatNext) || readerView.dataset.smartFloatingNavBound === "true") return;

  readerView.dataset.smartFloatingNavBound = "true";
  let idleTimer = null;

  const setNavVisible = (visible, awake = false) => {
    document.body.classList.toggle("reader-nav-hidden", !visible);
    document.body.classList.toggle("reader-nav-awake", visible && awake);
  };

  const wakeFloatingNav = (duration = 1600) => {
    clearTimeout(idleTimer);
    setNavVisible(true, true);
    idleTimer = setTimeout(() => setNavVisible(true, false), duration);
  };

  const hideFloatingNavDuringScroll = () => {
    clearTimeout(idleTimer);
    setNavVisible(false, false);
    idleTimer = setTimeout(() => wakeFloatingNav(1400), 500);
  };

  const bindFloatingButton = (button, direction) => {
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateToChapter(direction);
      wakeFloatingNav(900);
    });
  };

  bindFloatingButton(floatPrev, -1);
  bindFloatingButton(floatNext, 1);

  const scrollSurface = readerView.querySelector(".reader-reading-surface") || document.querySelector(".main-content");
  if (scrollSurface) {
    scrollSurface.addEventListener("scroll", hideFloatingNavDuringScroll, { passive: true });
  }

  readerView.addEventListener("pointerdown", (event) => {
    const interactiveTarget = event.target.closest("button, a, input, select, textarea, [role='button'], .full-page-overlay, .bottom-sheet-backdrop");
    if (!interactiveTarget) wakeFloatingNav();
  }, { passive: true });

  setNavVisible(true, false);
}
let readerBottomDwellController = null;
let readerEndObserver = null;
let readerEndVisible = false;
let readerAutoReadNoticeKey = "";

function getCurrentPlanReaderTask() {
  const plan = window.findPlanByContextId?.(state.readerState?.planContextId) || state.activePlan;
  if (!plan || !state.readerState || !state.readerState.fromPlan) return null;

  const book = BIBLE_BOOKS.find(item => Number(item.id) === Number(state.readerState.bookId));
  const round = Number(state.readerState.planRound || plan.currentRound || 1);
  if (!book || !Array.isArray(plan.days)) return null;

  const findChapter = day => Array.isArray(day?.chapters)
    ? day.chapters.find(item =>
      item.book === book.name &&
      Number(item.chapter) === Number(state.readerState.chapter) &&
      Number(item.round || round) === round
    )
    : null;

  let day = plan.days.find(item => Number(item.dayNum) === Number(state.readerState.planDayNum));
  let chapter = findChapter(day);
  if (!chapter) {
    day = plan.days.find(item => Boolean(findChapter(item))) || null;
    chapter = findChapter(day);
  }

  return chapter ? { book, chapter, day, round, plan } : null;
}

function isCurrentPlanReaderTaskRead(taskContext) {
  if (!taskContext) return false;
  const { chapter, round } = taskContext;
  return Boolean(chapter[`isReadR${round}`] || (round === 1 && chapter.isRead));
}

function getCurrentPlanReaderTargetKey() {
  const taskContext = getCurrentPlanReaderTask();
  if (!taskContext) return "";
  const { book, day, round, plan } = taskContext;
  return [plan.id || plan.globalPlanId || plan.presetKey || "plan", day.dayNum, round, book.name, state.readerState.chapter].join("|");
}

async function autoMarkCurrentPlanReaderTaskRead(expectedTargetKey) {
  const taskContext = getCurrentPlanReaderTask();
  if (!taskContext || getCurrentPlanReaderTargetKey() !== expectedTargetKey) return false;
  if (isCurrentPlanReaderTaskRead(taskContext)) return true;
  if (state.readerState.autoMarked || state.readerState.autoMarkInFlight) return false;
  if (taskContext.plan && isPlanExpired(taskContext.plan)) return false;
  if (taskContext.round < Number(taskContext.plan.currentRound || 1)) return false;

  const planDayChKey = `${taskContext.book.name}_${state.readerState.chapter}`;
  const readKey = `isReadR${taskContext.round}`;
  const previousRoundRead = Boolean(taskContext.chapter[readKey]);
  const previousRead = Boolean(taskContext.chapter.isRead);
  state.readerState.autoMarked = true;
  state.readerState.autoMarkInFlight = true;
  taskContext.chapter[readKey] = true;
  if (taskContext.round === 1) taskContext.chapter.isRead = true;
  try {
    window.renderPlanScheduleTracker?.();
    calculatePlanProgress();
    if (typeof updateDashboardView === "function") updateDashboardView();
    await db.logChapterRead(taskContext.book.name, state.readerState.chapter, true, taskContext.round, taskContext.plan);

    const shouldHandleR1 = taskContext.plan.isPlanCompleted && !taskContext.plan.upgradePromptHandled;
    const shouldHandleR2 = taskContext.plan.isRound2Completed && !taskContext.plan.round2UpgradePromptHandled;
    if ((shouldHandleR1 || shouldHandleR2) && typeof window.handleRoundCompletion === "function") {
      await window.handleRoundCompletion(taskContext.plan);
    }
    console.info("[AutoRead] Reading log persisted", { targetKey: expectedTargetKey });
    return true;
  } catch (error) {
    console.error("Failed to auto-mark reader progress", error);
    state.readerState.autoMarked = false;
    taskContext.chapter[readKey] = previousRoundRead;
    taskContext.chapter.isRead = previousRead;
    window.renderPlanScheduleTracker?.();
    calculatePlanProgress();
    if (typeof updateDashboardView === "function") updateDashboardView();
    if (typeof showToast === "function") {
      showToast((window.APP_COPY && window.APP_COPY.plan.syncFail) || "閱讀進度同步失敗，請稍後再試");
    }
    return false;
  } finally {
    state.readerState.autoMarkInFlight = false;
  }
}

function initImmersivePlanReader() {
  const readerView = document.getElementById("reader-view");
  const scrollSurface = readerView && readerView.querySelector(".reader-reading-surface");
  if (!readerView || !scrollSurface || readerView.dataset.immersivePlanReaderBound === "true") return;

  readerView.dataset.immersivePlanReaderBound = "true";
  readerBottomDwellController = createReaderBottomDwellController({
    dwellMs: 1000,
    bottomThreshold: 96,
    onComplete: autoMarkCurrentPlanReaderTaskRead
  });
  scrollSurface.addEventListener("scroll", handleReaderScroll, { passive: true });
  scrollSurface.addEventListener("scrollend", handleReaderScroll, { passive: true });
  const mainSurface = document.querySelector(".main-content");
  if (mainSurface && mainSurface !== scrollSurface && mainSurface.dataset.planReaderBottomDwellBound !== "true") {
    mainSurface.dataset.planReaderBottomDwellBound = "true";
    mainSurface.addEventListener("scroll", handleReaderScroll, { passive: true });
    mainSurface.addEventListener("scrollend", handleReaderScroll, { passive: true });
  }
}

export function initReaderControls() {
  releaseClosedReaderLayers();
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  const bookBadge = document.getElementById("reader-book-badge");
  const chapterBadge = document.getElementById("reader-chapter-badge");
  const readerBackBtn = document.getElementById("reader-back-btn");

  if (readerBackBtn) {
    readerBackBtn.addEventListener("click", () => {
      const globalBackBtn = document.getElementById("global-back-btn");
      if (globalBackBtn) globalBackBtn.click();
    });
  }

  populateBookSelector("all");
  populateChapterSelector();
  updatePillLabels();
  renderReaderPicker();

  function openReaderCatalog() {
    console.log('目錄被點擊了');
    if (typeof window.openBibleNavOverlay === "function") window.openBibleNavOverlay();
  }

  if (bookBadge) bookBadge.addEventListener("click", openReaderCatalog);
  if (chapterBadge) chapterBadge.addEventListener("click", openReaderCatalog);

  const navDirectoryBtn = document.getElementById("reader-nav-directory-btn");
  if (navDirectoryBtn) {
    navDirectoryBtn.addEventListener("click", () => {
      console.log('目錄被點擊了');
      if (typeof window.openBibleNavOverlay === "function") {
        window.openBibleNavOverlay();
      }
    });
  }

  setupVersionPickerEvents();

  const navVersionBtn = document.getElementById("reader-nav-version-btn");
  if (navVersionBtn) {
    navVersionBtn.addEventListener("click", () => {
      if (typeof window.toggleBibleVersion === "function") {
        window.toggleBibleVersion();
      }
    });
  }

  const audioBtn = document.getElementById("reader-audio-btn");
  if (audioBtn) {
    audioBtn.addEventListener("click", () => {
      if (typeof window.toggleReaderAudio === "function") {
        window.toggleReaderAudio();
      }
    });
  }

  const searchBtn = document.getElementById("reader-search-btn");
  const searchOverlay = document.getElementById("global-search-overlay");
  const searchInput = document.getElementById("global-search-input");
  const searchCancelBtn = document.getElementById("global-search-cancel-btn");
  const searchClearBtn = document.getElementById("global-search-clear-btn");
  const searchResultsContainer = document.getElementById("global-search-results");
  const searchResultsCountEl = document.getElementById("search-results-count");

  if (searchBtn && searchOverlay) {
    searchBtn.addEventListener("click", () => {
      openReaderLayer(searchOverlay);
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      if (searchClearBtn) searchClearBtn.classList.add("hidden");
      if (searchResultsContainer) searchResultsContainer.innerHTML = "";
      if (searchResultsCountEl) searchResultsCountEl.textContent = "請輸入關鍵字進行搜尋";
    });
  }

  if (searchCancelBtn && searchOverlay) {
    searchCancelBtn.addEventListener("click", () => {
      closeReaderLayer(searchOverlay);
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchClearBtn.classList.add("hidden");
      if (searchResultsContainer) searchResultsContainer.innerHTML = "";
      if (searchResultsCountEl) searchResultsCountEl.textContent = "請輸入關鍵字進行搜尋";
      searchInput.focus();
    });
  }

  let searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      if (searchClearBtn) {
        searchClearBtn.classList.toggle("hidden", !query);
      }
      
      clearTimeout(searchTimeout);
      if (!query) {
        if (searchResultsContainer) searchResultsContainer.innerHTML = "";
        if (searchResultsCountEl) searchResultsCountEl.textContent = "請輸入關鍵字進行搜尋";
        return;
      }
      
      if (searchResultsCountEl) searchResultsCountEl.textContent = "正在搜尋中...";
      
      searchTimeout = setTimeout(async () => {
        try {
          const results = await window.searchBibleText(query, state.readerState.version || "CUNP");
          renderSearchResults(results, query);
        } catch (err) {
          console.error("Search error:", err);
          if (searchResultsCountEl) searchResultsCountEl.textContent = "搜尋失敗，請稍後再試";
        }
      }, 400);
    });
  }

  function renderSearchResults(results, query) {
    if (!searchResultsContainer) return;
    searchResultsContainer.innerHTML = "";
    
    if (!results || results.length === 0) {
      if (searchResultsCountEl) searchResultsCountEl.textContent = "找不到符合的經文";
      return;
    }
    
    if (searchResultsCountEl) {
      searchResultsCountEl.textContent = `共找到 ${results.length} 筆符合的結果`;
    }
    
    results.forEach(item => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      
      const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
      const highlightedText = item.text.replace(regex, "<mark>$1</mark>");
      
      div.innerHTML = `
        <div class="search-result-ref">${item.bookName} ${item.chapter}章:${item.verse}節</div>
        <div class="search-result-text">${highlightedText}</div>
      `;
      
      div.addEventListener("click", () => {
        if (searchOverlay) closeReaderLayer(searchOverlay);
        
        const book = BIBLE_BOOKS.find(b => b.name === item.bookName || b.eng.toLowerCase() === item.bookEng.toLowerCase());
        if (book) {
          navOverlayState.selectedBookId = book.id;
          navOverlayState.selectedChapter = item.chapter;
          selectNavVerse(item.verse);
        }
      });
      
      searchResultsContainer.appendChild(div);
    });
  }

  const settingsTrigger = document.getElementById("reader-settings-trigger-btn");
  const settingsBackdrop = document.getElementById("typography-settings-backdrop");
  const settingsCloseBtn = document.getElementById("typography-sheet-close-btn");

  if (settingsTrigger && settingsBackdrop) {
    settingsTrigger.addEventListener("click", (e) => {
      console.log("➡️ [Debug] 點擊文字設定按鈕，嘗試開啟 typography-settings-backdrop");
      e.stopPropagation();
      openReaderLayer(settingsBackdrop);
      updateSheetActiveStates();
    });
  }

  if (settingsCloseBtn && settingsBackdrop) {
    settingsCloseBtn.addEventListener("click", () => {
      console.log("🔒 [Debug] 關閉文字設定按鈕被點擊");
      closeReaderLayer(settingsBackdrop);
    });
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === settingsBackdrop) {
        console.log("🔒 [Debug] 點擊文字設定外部遮罩關閉");
        closeReaderLayer(settingsBackdrop);
      }
    });
  }

  document.querySelectorAll(".font-size-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const size = parseInt(btn.dataset.size);
      state.readerState.fontSize = size;
      updateReaderFontSize();
      updateSheetActiveStates();
    });
  });

  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      if (typeof window.applyAppTheme === "function") {
        window.applyAppTheme(theme);
        updateSheetActiveStates();
      }
    });
  });

  function updateSheetActiveStates() {
    document.querySelectorAll(".font-size-option").forEach(btn => {
      btn.classList.toggle("active", parseInt(btn.dataset.size) === state.readerState.fontSize);
    });
    document.querySelectorAll(".theme-option").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === state.theme);
    });
  }

  const testamentButtons = document.querySelectorAll("#reader-testament-buttons .reader-picker-tab");
  testamentButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.testament || "all";
      if (testamentSelect) testamentSelect.value = filter;
      populateBookSelector(filter);
      populateChapterSelector();
      renderReaderPicker();
      updatePillLabels();
    });
  });

  if (testamentSelect) {
    testamentSelect.addEventListener("change", (e) => {
      populateBookSelector(e.target.value);
      populateChapterSelector();
      renderReaderPicker();
      updatePillLabels();
    });
  }

  if (bookSelect) {
    bookSelect.addEventListener("change", () => {
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
      renderReaderPicker();
      updatePillLabels();
    });
  }

  if (chapterSelect) {
    chapterSelect.addEventListener("change", () => {
      state.readerState.chapter = parseInt(chapterSelect.value);
      saveReaderPreferences();
      renderReaderText();
      renderReaderPicker();
      updatePillLabels();
    });
  }

  const incFont = document.getElementById("reader-font-increase");
  const decFont = document.getElementById("reader-font-decrease");
  if (incFont) incFont.addEventListener("click", () => {
    if (state.readerState.fontSize < 36) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (decFont) decFont.addEventListener("click", () => {
    if (state.readerState.fontSize > 12) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });

  const legacyInc = document.getElementById("increase-font");
  const legacyDec = document.getElementById("decrease-font");
  if (legacyInc) legacyInc.addEventListener("click", () => {
    if (state.readerState.fontSize < 36) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (legacyDec) legacyDec.addEventListener("click", () => {
    if (state.readerState.fontSize > 12) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });

  const prevChapterBtn = document.getElementById("prev-chapter-btn");
  const nextChapterBtn = document.getElementById("next-chapter-btn");
  if (prevChapterBtn) prevChapterBtn.addEventListener("click", () => {
    console.log('上一章被點擊了');
    navigateToChapter(-1);
  });
  if (nextChapterBtn) nextChapterBtn.addEventListener("click", () => {
    console.log('下一章被點擊了');
    navigateToChapter(1);
  });

  initSmartFloatingReaderNav();
  initImmersivePlanReader();

  const markReadBtn = document.getElementById("mark-read-btn");
  if (markReadBtn) {
    markReadBtn.addEventListener("click", () => {
      const wasChecked = markReadBtn.classList.contains("checked");
      const isChecked = !wasChecked;
      const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
      if (!bookObj) return;

      // 💡 關鍵修復：唯讀歷史鎖定，防止從讀經頁面誤觸修改歷史遍數打卡紀錄
      const planRound = state.readerState.planRound || (state.activePlan ? state.activePlan.currentRound || 1 : 1);
      if (state.activePlan && planRound < (state.activePlan.currentRound || 1)) {
        showToast("此遍進度已完成存檔，無法修改以前的打卡紀錄。");
        return;
      }

      if (state.activePlan && isPlanExpired(state.activePlan)) {
        showToast("此計畫已過期，無法再修改打卡紀錄。");
        return;
      }

      markReadBtn.classList.toggle("checked", isChecked);

      let planDayChKey = null;
      if (state.activePlan) {
        planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
        window.renderPlanScheduleTracker?.();
        calculatePlanProgress();
        if (typeof updateDashboardView === "function") {
          updateDashboardView();
        }
      }

      db.logChapterRead(bookObj.name, state.readerState.chapter, isChecked, planRound, state.activePlan)
        .then(async () => {
          if (state.activePlan) {
            const plan = state.activePlan;
            const shouldHandleR1 = plan.isPlanCompleted && !plan.upgradePromptHandled;
            const shouldHandleR2 = plan.isRound2Completed && !plan.round2UpgradePromptHandled;
            if (shouldHandleR1 || shouldHandleR2) {
              if (typeof window.handleRoundCompletion === "function") {
                await window.handleRoundCompletion(plan);
              }
            }
            if (isChecked && typeof window.checkAndPromptTodayCompletion === "function") {
              await window.checkAndPromptTodayCompletion();
            }
          }
        })
        .catch(error => {
          console.error("Failed to update reader progress in background", error);
          markReadBtn.classList.toggle("checked", wasChecked);
          if (state.activePlan && planDayChKey) {
            window.renderPlanScheduleTracker?.();
            calculatePlanProgress();
            if (typeof updateDashboardView === "function") {
              updateDashboardView();
            }
          }
          showToast((window.APP_COPY && window.APP_COPY.plan.syncFail) || "進度沒同步成功，等一下再試試");
        });
    });
  }
}

export function renderReaderPicker() {
  renderReaderTestamentTabs();
  renderReaderBookGrid();
  renderReaderChapterGrid();
}

function renderReaderTestamentTabs() {
  const testamentSelect = document.getElementById("reader-testament-select");
  const currentFilter = testamentSelect ? testamentSelect.value : "all";
  document.querySelectorAll("#reader-testament-buttons .reader-picker-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.testament === currentFilter);
  });
}

function renderReaderBookGrid() {
  const grid = document.getElementById("reader-book-grid");
  const bookSelect = document.getElementById("reader-book-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  if (!grid || !bookSelect) return;

  const filter = testamentSelect ? testamentSelect.value : "all";
  grid.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter !== "all" && book.section !== filter) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-book-choice";
    btn.classList.toggle("active", Number(book.id) === Number(state.readerState.bookId));
    btn.textContent = book.name;
    btn.addEventListener("click", () => {
      state.readerState.bookId = book.id;
      state.readerState.chapter = 1;
      bookSelect.value = String(book.id);
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderPicker();
      updatePillLabels();
    });
    grid.appendChild(btn);
  });
}

function renderReaderChapterGrid() {
  const grid = document.getElementById("reader-chapter-grid");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const book = BIBLE_BOOKS.find(b => Number(b.id) === Number(state.readerState.bookId));
  if (!grid || !chapterSelect || !book) return;

  grid.innerHTML = "";
  for (let chapter = 1; chapter <= book.chapters; chapter++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-chapter-choice";
    btn.classList.toggle("active", Number(chapter) === Number(state.readerState.chapter));
    btn.textContent = chapter;
    btn.addEventListener("click", () => {
      state.readerState.chapter = chapter;
      chapterSelect.value = String(chapter);
      saveReaderPreferences();
      renderReaderText();
      renderReaderPicker();
      updatePillLabels();
    });
    grid.appendChild(btn);
  }
}

export function populateBookSelector(filter) {
  const bookSelect = document.getElementById("reader-book-select");
  if (!bookSelect) return;

  bookSelect.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter === "all" || book.section === filter) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = book.name + " (" + book.abbrev + ")";
      if (book.id === state.readerState.bookId) {
        option.selected = true;
      }
      bookSelect.appendChild(option);
    }
  });
}

export function populateChapterSelector() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const bookId = bookSelect ? parseInt(bookSelect.value || state.readerState.bookId, 10) : Number(state.readerState.bookId || 1);
  state.readerState.bookId = bookId;

  const book = BIBLE_BOOKS.find(b => b.id === bookId);
  if (!book) {
    console.error("Book not found for ID:", bookId);
    return;
  }

  if (state.readerState.chapter > book.chapters) {
    state.readerState.chapter = 1;
  }

  if (!chapterSelect) return;
  chapterSelect.innerHTML = "";

  for (let i = 1; i <= book.chapters; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = i + " 章";
    if (i === state.readerState.chapter) {
      option.selected = true;
    }
    chapterSelect.appendChild(option);
  }
}

export function saveReaderPreferences() {
  localStorage.setItem("reader_state", JSON.stringify({
    bookId: state.readerState.bookId,
    chapter: state.readerState.chapter
  }));
}

export function updatePillLabels() {
  const book = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  const refLabel = document.getElementById("reader-nav-ref-label");
  if (refLabel && book) {
    refLabel.textContent = `${book.name} ${state.readerState.chapter}`;
  }

  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const version = state.readerState.version || "CUNP";
    const label = version === "CUNP" ? "CUNP" : (version === "RCUVTS" ? "RCUV" : "CUV");
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
    const inlineVersion = document.getElementById("reader-version-inline");
    if (inlineVersion) inlineVersion.textContent = label;
  }
}

export function updateReaderFontSize() {
  const size = Number(state.readerState.fontSize || 18);
  state.readerState.fontSize = size;
  document.documentElement.style.setProperty("--reader-font-size", size + "px");
  const bibleContent = document.getElementById("bible-content");
  if (bibleContent) bibleContent.style.fontSize = size + "px";

  localStorage.setItem("reader_font_size", size);

  document.querySelectorAll("#reader-settings-dropdown .font-btn, .font-size-option").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.size) === state.readerState.fontSize);
  });

  document.querySelectorAll("#reader-settings-dropdown .theme-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === state.theme);
  });
}

export function navigateToChapter(direction) {
  const currentBook = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);

  if (direction > 0 && state.readerState && state.readerState.fromPlan && state.activePlan) {
    const plan = state.activePlan;
    const planDay = state.readerState.planDayNum || 1;
    const selectedDay = plan.days.find(d => d.dayNum === planDay);
    const dayChapters = (selectedDay && selectedDay.chapters) || [];
    const currentChIndex = dayChapters.findIndex(ch =>
      ch.book === currentBook.name && Number(ch.chapter) === Number(state.readerState.chapter)
    );
    const isLastChapterOfDay = currentChIndex === dayChapters.length - 1 || currentChIndex === -1;

    if (isLastChapterOfDay) {
      if (isTodayScheduleCompleted()) {
        const start = new Date(plan.startDate);
        start.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const elapsedDay = Math.max(1, Math.ceil((today - start) / (1000 * 60 * 60 * 24)) + 1);
        const readAheadDayNum = Math.max(elapsedDay + 1, planDay + 1);

        const currentRound = plan.currentRound || 1;
        const catchUpDay = plan.days.find(d => {
          if (d.dayNum >= planDay) return false;
          return d.chapters.some(ch => {
            const r = ch.round || currentRound;
            if (r === 1) return !Boolean(ch.isReadR1 || ch.isRead);
            if (r === 2) return !Boolean(ch.isReadR2);
            if (r >= 3) return !Boolean(ch.isReadR3);
            return !Boolean(ch.isRead);
          });
        });

        const catchUpDayNum = catchUpDay ? catchUpDay.dayNum : null;

        const onCatchUp = () => {
          if (catchUpDay && catchUpDay.chapters.length > 0) {
            const firstCh = catchUpDay.chapters[0];
            const book = BIBLE_BOOKS.find(b => b.name === firstCh.book || b.eng === firstCh.book);
            if (book) {
              state.readerState.bookId = book.id;
              state.readerState.chapter = Number(firstCh.chapter);
              state.readerState.planDayNum = catchUpDay.dayNum;
              renderReaderText();
            }
          } else {
            showToast("您已完成目前所有的歷史補讀進度！");
          }
        };

        const onReadAhead = () => {
          const nextDay = plan.days.find(d => d.dayNum === readAheadDayNum);
          if (nextDay && nextDay.chapters.length > 0) {
            const firstCh = nextDay.chapters[0];
            const book = BIBLE_BOOKS.find(b => b.name === firstCh.book || b.eng === firstCh.book);
            if (book) {
              state.readerState.bookId = book.id;
              state.readerState.chapter = Number(firstCh.chapter);
              state.readerState.planDayNum = nextDay.dayNum;
              renderReaderText();
            }
          } else {
            showToast("您已到達計畫的最後一天！");
          }
        };

        showPlanNavigationPrompt({
          hasCatchUp: Boolean(catchUpDay),
          catchUpDayNum,
          readAheadDayNum,
          onCatchUp,
          onReadAhead
        });
        return;
      } else {
        const nextChInfo = getNextPlanChapterInfo(plan, planDay, currentChIndex, dayChapters);
        if (nextChInfo) {
          const nextBook = BIBLE_BOOKS.find(b => b.name === nextChInfo.book || b.eng === nextChInfo.book);
          if (nextBook) {
            state.readerState.bookId = nextBook.id;
            state.readerState.chapter = Number(nextChInfo.chapter);
            state.readerState.planDayNum = nextChInfo.dayNum;
            renderReaderText();
            return;
          }
        }
      }
    } else {
      const nextCh = dayChapters[currentChIndex + 1];
      const nextBook = BIBLE_BOOKS.find(b => b.name === nextCh.book || b.eng === nextCh.book);
      if (nextBook) {
        state.readerState.bookId = nextBook.id;
        state.readerState.chapter = Number(nextCh.chapter);
        renderReaderText();
        return;
      }
    }
  }

  let newChapter = state.readerState.chapter + direction;
  
  if (newChapter < 1) {
    const prevBookId = state.readerState.bookId - 1;
    if (prevBookId >= 1) {
      const prevBook = BIBLE_BOOKS.find(b => b.id === prevBookId);
      state.readerState.bookId = prevBookId;
      state.readerState.chapter = prevBook.chapters;
      
      const testamentSelect = document.getElementById("reader-testament-select");
      if (testamentSelect) testamentSelect.value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else if (newChapter > currentBook.chapters) {
    const nextBookId = state.readerState.bookId + 1;
    if (nextBookId <= 66) {
      state.readerState.bookId = nextBookId;
      state.readerState.chapter = 1;
      
      const testamentSelect = document.getElementById("reader-testament-select");
      if (testamentSelect) testamentSelect.value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else {
    state.readerState.chapter = newChapter;
    const chapterSelect = document.getElementById("reader-chapter-select");
    if (chapterSelect) chapterSelect.value = newChapter;
    saveReaderPreferences();
    renderReaderText();
  }
}

export async function renderReaderText() {
  const container = document.getElementById("bible-content");
  if (!container) return;

  let verses = null;
  let isLoading = true;

  console.log('🔍 [畫面渲染檢查] 目前 verses 資料狀態：', verses, '是否加載中：', isLoading);

  if (isSpeaking) {
    stopReaderAudio(true);
  }
  state.readerState.selectedVerseNum = null;
  state.readerState.autoMarked = false;
  state.readerState.autoMarkInFlight = false;
  if (readerBottomDwellController) readerBottomDwellController.reset();
  readerEndObserver?.disconnect();
  readerEndObserver = null;
  readerEndVisible = false;
  const heading = document.getElementById("bible-title");
  const markReadBtn = document.getElementById("mark-read-btn");
  
  const bookId = Number(state.readerState && state.readerState.bookId) || 1;
  const book = BIBLE_BOOKS.find(b => b.id === bookId) || BIBLE_BOOKS[0];
  const chapter = Number(state.readerState && state.readerState.chapter) || 1;

  if (heading) heading.textContent = `${book.name} ${chapter}章`;
  updatePillLabels();
  renderReaderPicker();
  
  const scrollSurface = document.querySelector(".reader-reading-surface") || document.querySelector(".main-content");
  if (scrollSurface) {
    scrollSurface.scrollTop = 0;
  }

  const bar = document.getElementById("reader-bottom-action-bar");
  if (bar) {
    bar.style.display = "none";
    bar.classList.add("hidden");
  }

  const cacheKey = `${book.eng}_${chapter}`;
  const cachedData = window._bibleChapterCache && window._bibleChapterCache[cacheKey];
  if (cachedData && cachedData.verses && cachedData.verses.length > 0) {
    verses = cachedData.verses;
    isLoading = false;
  }

  if (isLoading || !verses) {
    ComponentSkeletonLoader.show('reader', container);
  } else {
    renderVersesList(container, verses, book.name, chapter);
  }
  
  if (markReadBtn) {
    const isRead = state.readingLogs.some(l => l.book === book.name && l.chapter === chapter);
    markReadBtn.classList.toggle("checked", isRead);
  }

  try {
    isLoading = true;
    const data = await fetchBibleChapter(book.eng, chapter);
    verses = data ? data.verses : null;
    isLoading = false;

    console.log('🔍 [畫面渲染檢查] 目前 verses 資料狀態：', verses, '是否加載中：', isLoading);

    if (!verses || verses.length === 0) {
      throw new Error("經文正在稍微休息中，別擔心，我們一起重新點亮畫面試試看！");
    }

    renderVersesList(container, verses, book.name, chapter);
    triggerPredictivePrefetch();
  } catch (error) {
    console.error("Failed to load complete Bible chapter:", error);
    isLoading = false;
    
    container.innerHTML = `
      <div class="reader-error-state" style="padding: 3rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
        <div style="font-size: 2.5rem;">📖</div>
        <p style="color: var(--text-secondary); font-weight: 500; margin: 0; font-size: 0.95rem; line-height: 1.5; max-width: 280px;">經文正在稍微休息中，別擔心，我們一起重新點亮畫面試試看！</p>
        <button type="button" class="primary-btn" onclick="renderReaderText()" style="padding: 0.5rem 1.5rem; border-radius: 20px; font-weight: 500; margin-top: 0.5rem; font-size: 0.88rem; width: auto; min-height: 38px; display: inline-flex; align-items: center; justify-content: center;">
          重新點亮畫面（重試）
        </button>
      </div>
    `;
  }

  updateReaderFontSize();
  updateReaderBottomActionBar();
  bindReaderEndObserver();
  scheduleReaderBottomDwellCheck();
}

function setReaderStartSelection(verseElement) {
  const container = document.getElementById("bible-content");
  if (!container || !verseElement) return;
  const wasSelected = verseElement.classList.contains("reader-start-selected");
  container.querySelectorAll(".bible-verse.reader-start-selected").forEach(item => {
    item.classList.remove("reader-start-selected");
    item.setAttribute("aria-pressed", "false");
  });
  if (wasSelected) {
    state.readerState.selectedVerseNum = null;
    console.info("[ReaderAudio] Start verse selection cleared");
    return;
  }
  verseElement.classList.add("reader-start-selected");
  verseElement.setAttribute("aria-pressed", "true");
  state.readerState.selectedVerseNum = Number(verseElement.dataset.verse || 1);
  console.info("[ReaderAudio] Start verse selected", { verse: state.readerState.selectedVerseNum });
}
function renderVersesList(container, verses, bookName, chapter) {
  container.innerHTML = "";
  verses.forEach(v => {
    const verseDiv = document.createElement("div");
    verseDiv.className = "bible-verse";
    verseDiv.dataset.verse = String(v.verse);
    verseDiv.id = `reader-verse-${v.verse}`;
    verseDiv.tabIndex = 0;
    verseDiv.setAttribute("role", "button");
    verseDiv.setAttribute("aria-pressed", "false");
    verseDiv.setAttribute("aria-label", `第 ${v.verse} 節，點一下選為朗讀起點`);

    const highlightKey = `${bookName}_${chapter}_${v.verse}`;
    const chapterId = `${state.readerState?.bookId || "GEN"}_${chapter}`;
    if (state.highlights[highlightKey]) {
      verseDiv.style.backgroundColor = state.highlights[highlightKey];
      verseDiv.setAttribute("data-highlight", state.highlights[highlightKey]);
    }

    verseDiv.innerHTML = `<span class="verse-num">${v.verse}</span><span class="verse-text">${v.text}</span>`;

    const toggleSelection = e => {
      e.stopPropagation();
      setReaderStartSelection(verseDiv);
      const verseText = v.text;
      const formattedText = `【${bookName} ${chapter}:${v.verse}】${verseText}`;
      openIntegratedSelectionBottomBar({
        selectedText: formattedText,
        verseDiv,
        highlightKey,
        chapterId
      });
    };
    verseDiv.addEventListener("click", toggleSelection);
    verseDiv.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleSelection(e);
    });

    container.appendChild(verseDiv);
  });
  const sentinel = document.createElement("div");
  sentinel.id = "reader-end-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.style.cssText = "height:1px;width:100%;pointer-events:none;";
  container.appendChild(sentinel);
}

/**
 * Integrated Reader Selection Bottom Bar Launcher
 */
function openIntegratedSelectionBottomBar(options) {
  const { selectedText, verseDiv, highlightKey, chapterId } = options;
  const rootElement = document.getElementById("selection-bottom-bar-root");
  if (!rootElement) return;

  if (state.readerState && verseDiv) {
    const verseNum = Number(verseDiv.dataset.verse || 1);
    state.readerState.lastFocusedVerseNum = verseNum;
  }

  rootElement.innerHTML = `
    <div id="pwa-selection-bottom-bar" class="youversion-action-bar active">
      <div class="drag-pill"></div>
      <div class="yv-content-row">
        <div class="yv-color-capsule">
          <button type="button" class="yv-dot yv-dot-yellow" data-color="#facc15" title="黃色標註"></button>
          <button type="button" class="yv-dot yv-dot-cyan" data-color="#38bdf8" title="亮青標註"></button>
          <button type="button" class="yv-dot yv-dot-green" data-color="#4ade80" title="綠色標註"></button>
          <button type="button" class="yv-dot yv-dot-dual" data-action="clear" title="雙色調色盤 / 清除標註"></button>
        </div>
        <div class="yv-action-group">
          <button type="button" class="yv-tile" data-action="play">
            <span class="nlc-icon" data-icon="chevronRight" aria-hidden="true"></span>
            <span class="yv-tile-label">朗讀</span>
          </button>
          <button type="button" class="yv-tile" data-action="bookmark">
            <span class="nlc-icon" data-icon="bookmark" aria-hidden="true"></span>
            <span class="yv-tile-label">儲存</span>
          </button>
          <button type="button" class="yv-tile" data-action="notes">
            <span class="nlc-icon" data-icon="edit" aria-hidden="true"></span>
            <span class="yv-tile-label">筆記</span>
          </button>
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
      <div class="yv-swipe-hint" data-action="close">
        <span>^ 向上滑動查看更多</span>
      </div>
    </div>
  `;

  const barDiv = document.getElementById("pwa-selection-bottom-bar");
  if (!barDiv) return;

  const closeBar = () => {
    rootElement.innerHTML = "";
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("selectionchange", onSelectionChange);
    setReaderStartSelection(null);
  };

  const onSelectionChange = () => {
    if (typeof window === "undefined" || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      closeBar();
    }
  };

  const onDocClick = (e) => {
    if (barDiv.contains(e.target) || (verseDiv && verseDiv.contains(e.target))) return;
    closeBar();
  };

  barDiv.querySelectorAll("[data-color]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const color = btn.getAttribute("data-color");
      if (verseDiv) {
        verseDiv.style.backgroundColor = color;
        verseDiv.setAttribute("data-highlight", color);
      }
      state.highlights[highlightKey] = color;
      localStorage.setItem("bible_highlights", JSON.stringify(state.highlights));
      showToast("已完成螢光筆劃線標註！");
      closeBar();
    };
  });

  barDiv.querySelector('[data-action="play"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    const verseNum = Number(verseDiv?.dataset.verse || 1);
    closeBar();
    if (typeof window.toggleReaderAudio === "function") {
      window.toggleReaderAudio(verseNum);
    }
  });

  barDiv.querySelector('[data-action="bookmark"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    showToast("已儲存經文至我的書籤！");
    closeBar();
  });

  barDiv.querySelector('[data-action="notes"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    showToast("開啟靈修筆記...");
    closeBar();
  });

  barDiv.querySelector('[data-action="clear"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (verseDiv) {
      verseDiv.style.backgroundColor = "";
      verseDiv.removeAttribute("data-highlight");
    }
    delete state.highlights[highlightKey];
    localStorage.setItem("bible_highlights", JSON.stringify(state.highlights));
    showToast("已清除劃線標註");
    closeBar();
  });

  barDiv.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(selectedText).then(() => {
        showToast("經文已複製到剪貼簿！");
      });
    } else {
      showToast(selectedText);
    }
    closeBar();
  });

  barDiv.querySelector('[data-action="share"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator.share({ title: "經文分享", text: selectedText, url: window.location.href }).catch(() => {});
    } else if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(selectedText).then(() => {
        showToast("經文已複製，可直接貼上分享！");
      });
    }
    closeBar();
  });

  barDiv.querySelector('[data-action="close"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeBar();
  });

  setTimeout(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("selectionchange", onSelectionChange);
  }, 100);
}

window.openBibleVersionPicker = function() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal) {
    return window.toggleBibleVersionNext?.();
  }

  const current = state.readerState.version || "CUNP";

  modal.querySelectorAll(".version-option-btn").forEach(btn => {
    const v = btn.getAttribute("data-version");
    btn.classList.toggle("active", v === current);
  });

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
};

window.closeBibleVersionPicker = function() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
};

window.selectBibleVersion = function(newVersion) {
  if (!newVersion) return;
  const current = state.readerState.version || "CUNP";
  window.closeBibleVersionPicker();

  if (current === newVersion) return;

  state.readerState.version = newVersion;
  localStorage.setItem("reader_bible_version", newVersion);

  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const label = newVersion === "RCUVTS" ? "RCUV" : newVersion;
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
    const inlineVersion = document.getElementById("reader-version-inline");
    if (inlineVersion) inlineVersion.textContent = label;
  }

  const versionLabels = {
    CUNP: "新標點和合本",
    RCUVTS: "和合本修訂版",
    CUV: "官話和合本",
    ESV: "ESV (English Standard Version)",
    NIV: "NIV (New International Version)",
    NLT: "NLT (New Living Translation)"
  };

  showToast(`已切換譯本至 ${versionLabels[newVersion] || newVersion}`);
  renderReaderText();
};

window.toggleBibleVersionNext = function() {
  const current = state.readerState.version || "CUNP";
  let next = "CUNP";
  if (current === "CUNP") next = "RCUVTS";
  else if (current === "RCUVTS") next = "CUV";
  else if (current === "CUV") next = "ESV";
  else if (current === "ESV") next = "NIV";
  else if (current === "NIV") next = "NLT";
  else next = "CUNP";
  window.selectBibleVersion(next);
};

window.toggleBibleVersion = function() {
  window.openBibleVersionPicker();
};

// 綁定 Version Picker Modal 內部事件
function setupVersionPickerEvents() {
  const modal = document.getElementById("bible-version-picker-modal");
  if (!modal || modal.dataset.eventsBound === "true") return;
  modal.dataset.eventsBound = "true";

  const closeBtn = document.getElementById("version-picker-close");
  const backdrop = document.getElementById("version-picker-backdrop");
  closeBtn?.addEventListener("click", window.closeBibleVersionPicker);
  backdrop?.addEventListener("click", window.closeBibleVersionPicker);

  modal.querySelectorAll(".version-option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-version");
      if (v) window.selectBibleVersion(v);
    });
  });
}

let isSpeaking = false;
let speechUtterance = null;
let currentSpeakingVerseIndex = -1;
let verseListForSpeaking = [];
let currentAudioSessionId = 0;
let preferredReaderVoice = null;

function updateReaderAudioButton(speaking) {
  const btn = document.getElementById("reader-audio-btn");
  if (!btn) return;
  btn.classList.toggle("active", speaking);
  btn.setAttribute("aria-pressed", speaking ? "true" : "false");
  btn.setAttribute("aria-label", speaking ? "停止朗讀" : "朗讀經文");
  btn.title = speaking ? "停止朗讀" : "朗讀經文";
}

function clearSpeakingHighlight() {
  document.querySelectorAll(".bible-verse.speaking-highlight").forEach(el => {
    el.classList.remove("speaking-highlight");
  });
}

function stopReaderAudio(quiet = false) {
  const wasActive = isSpeaking || Boolean(window.speechSynthesis?.speaking) || Boolean(window.speechSynthesis?.pending);
  currentAudioSessionId++;
  if (typeof window.speechSynthesis !== "undefined") {
    try { window.speechSynthesis.cancel(); } catch (_e) {}
  }
  isSpeaking = false;
  currentSpeakingVerseIndex = -1;
  verseListForSpeaking = [];
  speechUtterance = null;
  clearSpeakingHighlight();
  updateReaderAudioButton(false);
  if (!quiet && wasActive && typeof showToast === "function") showToast("已停止朗讀");
}

function getInstalledReaderVoice(targetLang = "zh-TW") {
  if (typeof window.speechSynthesis === "undefined") return Promise.resolve(null);
  const immediate = window.speechSynthesis.getVoices?.() || [];
  preferredReaderVoice = selectPreferredVoice(immediate, targetLang) || preferredReaderVoice;
  if (preferredReaderVoice && preferredReaderVoice.lang?.toLowerCase().startsWith(targetLang.slice(0, 2).toLowerCase())) {
    return Promise.resolve(preferredReaderVoice);
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      preferredReaderVoice = selectPreferredVoice(window.speechSynthesis.getVoices?.() || [], targetLang);
      resolve(preferredReaderVoice);
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 400);
  });
}

function speakNextVerseInQueue(sessionId) {
  if (sessionId !== currentAudioSessionId || !isSpeaking) return;
  if (currentSpeakingVerseIndex < 0 || currentSpeakingVerseIndex >= verseListForSpeaking.length) {
    stopReaderAudio(true);
    return;
  }
  const currentItem = verseListForSpeaking[currentSpeakingVerseIndex];
  if (!currentItem) {
    stopReaderAudio(true);
    return;
  }

  clearSpeakingHighlight();
  const verseEl = document.getElementById(`reader-verse-${currentItem.verseNum}`);
  if (verseEl) {
    verseEl.classList.add("speaking-highlight");
    verseEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  const currentVersion = state.readerState?.version || "CUNP";
  const isEnglish = ["ESV", "NIV", "NLT"].includes(currentVersion);
  const fallbackLang = isEnglish ? "en-US" : "zh-TW";

  speechUtterance = new SpeechSynthesisUtterance(currentItem.text);
  speechUtterance.lang = preferredReaderVoice?.lang || fallbackLang;
  if (preferredReaderVoice) speechUtterance.voice = preferredReaderVoice;
  speechUtterance.rate = 0.92;
  speechUtterance.pitch = 1;
  speechUtterance.volume = 1;
  speechUtterance.onend = () => {
    if (sessionId !== currentAudioSessionId || !isSpeaking) return;
    currentSpeakingVerseIndex++;
    speakNextVerseInQueue(sessionId);
  };
  speechUtterance.onerror = error => {
    if (sessionId !== currentAudioSessionId || !isSpeaking) return;
    console.warn("[ReaderAudio] Speech synthesis interrupted", error);
    stopReaderAudio(true);
    if (typeof showToast === "function") showToast("朗讀暫時中斷，請再試一次");
  };
  window.speechSynthesis.speak(speechUtterance);
}

window.toggleReaderAudio = async function(startVerseNum = null) {
  if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    if (typeof showToast === "function") showToast("您的瀏覽器不支援語音朗讀功能");
    return;
  }
  if (isSpeaking || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (isSpeaking) {
      stopReaderAudio();
      return;
    }
  }

  if (typeof window.speechSynthesis !== "undefined" && window.speechSynthesis.paused) {
    try { window.speechSynthesis.resume(); } catch (_e) {}
  }

  stopReaderAudio(true);
  const container = document.getElementById("bible-content");
  if (!container) return;
  verseListForSpeaking = Array.from(container.querySelectorAll(".bible-verse")).map(el => ({
    verseNum: Number(el.dataset.verse || 0),
    text: el.querySelector(".verse-text")?.textContent.trim() || ""
  })).filter(item => item.text.length > 0);
  if (verseListForSpeaking.length === 0) return;

  const selectedVerseNum = startVerseNum ?? state.readerState?.selectedVerseNum ?? null;
  const startIndex = resolveReaderStartIndex(verseListForSpeaking, selectedVerseNum);
  if (startIndex < 0) return;

  currentAudioSessionId++;
  const sessionId = currentAudioSessionId;
  isSpeaking = true;
  currentSpeakingVerseIndex = startIndex;
  updateReaderAudioButton(true);
  const currentVersion = state.readerState?.version || "CUNP";
  const isEnglish = ["ESV", "NIV", "NLT"].includes(currentVersion);
  preferredReaderVoice = await getInstalledReaderVoice(isEnglish ? "en-US" : "zh-TW");
  if (sessionId !== currentAudioSessionId || !isSpeaking) return;

  const startVerse = verseListForSpeaking[startIndex];
  console.info("[ReaderAudio] Playback started", {
    verse: startVerse?.verseNum || 1,
    voice: preferredReaderVoice?.name || "browser default",
    lang: preferredReaderVoice?.lang || "zh-TW"
  });
  if (typeof showToast === "function") showToast(`從第 ${startVerse?.verseNum || 1} 節開始朗讀`);
  speakNextVerseInQueue(sessionId);
};
window.searchChapterVerses = function(keyword) {
  const container = document.getElementById("bible-content");
  if (!container) return;
  
  container.querySelectorAll(".bible-verse").forEach(verseDiv => {
    const verseTextEl = verseDiv.querySelector(".verse-text");
    if (verseTextEl) {
      verseTextEl.innerHTML = verseTextEl.textContent;
    }
  });
  
  const cleanKeyword = keyword.trim();
  if (!cleanKeyword) return;
  
  container.querySelectorAll(".bible-verse").forEach(verseDiv => {
    const verseTextEl = verseDiv.querySelector(".verse-text");
    if (verseTextEl) {
      const text = verseTextEl.textContent;
      const regex = new RegExp(`(${escapeRegExp(cleanKeyword)})`, "gi");
      if (text.toLowerCase().includes(cleanKeyword.toLowerCase())) {
        verseTextEl.innerHTML = text.replace(regex, "<mark>$1</mark>");
      }
    }
  });
};

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let navOverlayState = {
  activeTab: 'book',
  selectedBookId: 1,
  selectedChapter: 1,
  selectedVerse: 1,
  viewMode: 'grid',
  autoAdvance: true
};

window.openBibleNavOverlay = function() {
  console.log("➡️ [Debug] 開啟聖經目錄選單");
  const overlay = document.getElementById("bible-nav-overlay");
  if (!overlay) return;
  
  navOverlayState.selectedBookId = state.readerState.bookId;
  navOverlayState.selectedChapter = state.readerState.chapter;
  navOverlayState.selectedVerse = 1;
  
  openReaderLayer(overlay);
  
  const gridBtn = document.getElementById("view-mode-grid");
  const listBtn = document.getElementById("view-mode-list");
  if (gridBtn && listBtn) {
    gridBtn.classList.toggle("active", navOverlayState.viewMode === 'grid');
    listBtn.classList.toggle("active", navOverlayState.viewMode === 'list');
  }

  const tabs = document.querySelectorAll("#bible-nav-overlay .segmented-tab");
  tabs.forEach(tab => {
    if (!tab.dataset.bound) {
      tab.dataset.bound = "true";
      tab.addEventListener("click", () => {
        window.switchNavTab(tab.dataset.tab);
      });
    }
  });

  if (gridBtn && !gridBtn.dataset.bound) {
    gridBtn.dataset.bound = "true";
    gridBtn.addEventListener("click", () => {
      navOverlayState.viewMode = 'grid';
      gridBtn.classList.add("active");
      if (listBtn) listBtn.classList.remove("active");
      renderBibleNavContent();
    });
  }
  if (listBtn && !listBtn.dataset.bound) {
    listBtn.dataset.bound = "true";
    listBtn.addEventListener("click", () => {
      navOverlayState.viewMode = 'list';
      listBtn.classList.add("active");
      if (gridBtn) gridBtn.classList.remove("active");
      renderBibleNavContent();
    });
  }

  const backBtn = document.getElementById("bible-nav-back-btn");
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "true";
    backBtn.addEventListener("click", () => {
      if (navOverlayState.activeTab === 'verse') {
        window.switchNavTab('chapter');
      } else if (navOverlayState.activeTab === 'chapter') {
        window.switchNavTab('book');
      } else {
        closeReaderLayer(overlay);
      }
    });
  }

  window.switchNavTab('book');
};

window.switchNavTab = function(tabName) {
  console.log(`➡️ [Debug] 切換聖經目錄分頁至: ${tabName}`);
  navOverlayState.activeTab = tabName;
  
  document.querySelectorAll("#bible-nav-overlay .segmented-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  
  updateNavOverlayHeader();
  renderBibleNavContent();
};

function updateNavOverlayHeader() {
  const titleEl = document.getElementById("bible-nav-title");
  if (!titleEl) return;
  
  const book = BIBLE_BOOKS.find(b => b.id === navOverlayState.selectedBookId);
  if (navOverlayState.activeTab === 'book') {
    titleEl.textContent = "選擇書卷";
  } else if (navOverlayState.activeTab === 'chapter') {
    titleEl.textContent = book ? book.name : "選擇章節";
  } else if (navOverlayState.activeTab === 'verse') {
    titleEl.textContent = book ? `${book.name} ${navOverlayState.selectedChapter}章` : "選擇節";
  }
}

function renderBibleNavContent() {
  const container = document.getElementById("bible-nav-content");
  if (!container) return;
  
  container.innerHTML = "";
  const book = BIBLE_BOOKS.find(b => b.id === navOverlayState.selectedBookId);
  
  if (navOverlayState.activeTab === 'book') {
    document.querySelector("#bible-nav-overlay .mode-selector-bar").style.display = "flex";
    
    if (navOverlayState.viewMode === 'grid') {
      const oldSection = document.createElement("div");
      oldSection.className = "bible-nav-section-title";
      oldSection.textContent = "舊約聖經";
      container.appendChild(oldSection);
      
      const oldGrid = document.createElement("div");
      oldGrid.className = "bible-nav-grid";
      
      const newSection = document.createElement("div");
      newSection.className = "bible-nav-section-title";
      newSection.textContent = "新約聖經";
      
      const newGrid = document.createElement("div");
      newGrid.className = "bible-nav-grid";
      
      BIBLE_BOOKS.forEach(b => {
        const item = document.createElement("div");
        item.className = "grid-item-book";
        item.classList.toggle("active", b.id === navOverlayState.selectedBookId);
        item.innerHTML = `
          <span class="abbrev-title">${b.abbrev}</span>
          <span class="full-title">${b.name}</span>
        `;
        item.addEventListener("click", () => selectNavBook(b.id));
        
        if (b.section === 'old') {
          oldGrid.appendChild(item);
        } else {
          newGrid.appendChild(item);
        }
      });
      
      container.appendChild(oldGrid);
      container.appendChild(newSection);
      container.appendChild(newGrid);
    } else {
      const oldSection = document.createElement("div");
      oldSection.className = "bible-nav-section-title";
      oldSection.textContent = "舊約聖經";
      container.appendChild(oldSection);
      
      const oldList = document.createElement("div");
      oldList.className = "bible-nav-list";
      
      const newSection = document.createElement("div");
      newSection.className = "bible-nav-section-title";
      newSection.textContent = "新約聖經";
      
      const newList = document.createElement("div");
      newList.className = "bible-nav-list";
      
      BIBLE_BOOKS.forEach(b => {
        const item = document.createElement("div");
        item.className = "book-list-item-asym";
        item.classList.toggle("active", b.id === navOverlayState.selectedBookId);
        item.innerHTML = `
          <div class="book-brand-box">${escapeHTML(b.abbrev)}</div>
          <div class="book-names-box">
            <span class="book-full-title">${escapeHTML(b.name)}</span>
            <span class="book-english-sub">${escapeHTML(b.eng)}</span>
          </div>
        `;
        item.addEventListener("click", () => selectNavBook(b.id));
        
        if (b.section === 'old') {
          oldList.appendChild(item);
        } else {
          newList.appendChild(item);
        }
      });
      
      container.appendChild(oldList);
      container.appendChild(newSection);
      container.appendChild(newList);
    }
  } else if (navOverlayState.activeTab === 'chapter') {
    document.querySelector("#bible-nav-overlay .mode-selector-bar").style.display = "none";
    
    const grid = document.createElement("div");
    grid.className = "chapter-nav-grid";
    
    const totalChapters = book ? book.chapters : 50;
    for (let c = 1; c <= totalChapters; c++) {
      const item = document.createElement("div");
      item.className = "grid-item-number";
      item.classList.toggle("active", c === navOverlayState.selectedChapter);
      item.textContent = c;
      item.addEventListener("click", () => selectNavChapter(c));
      grid.appendChild(item);
    }
    container.appendChild(grid);
  } else if (navOverlayState.activeTab === 'verse') {
    document.querySelector("#bible-nav-overlay .mode-selector-bar").style.display = "none";
    
    const grid = document.createElement("div");
    grid.className = "verse-nav-grid";
    
    let totalVerses = 30;
    let localData = null;
    if (book && typeof BIBLE_VERSE_COUNTS !== "undefined") {
      const bookCounts = BIBLE_VERSE_COUNTS[book.eng];
      if (bookCounts && bookCounts[navOverlayState.selectedChapter - 1]) {
        totalVerses = bookCounts[navOverlayState.selectedChapter - 1];
        localData = {
          book: book.name,
          chapter: navOverlayState.selectedChapter,
          totalVerses: totalVerses
        };
      }
    }
    
    console.log('📦 [本地讀取成功] 已從 Local 讀取出卷章節數據：', localData);
    
    for (let v = 1; v <= totalVerses; v++) {
      const item = document.createElement("div");
      item.className = "grid-item-number";
      item.classList.toggle("active", v === navOverlayState.selectedVerse);
      item.textContent = v;
      item.addEventListener("click", () => selectNavVerse(v));
      grid.appendChild(item);
    }
    container.appendChild(grid);
  }
}

function selectNavBook(bookId) {
  console.log(`➡️ [Debug] 聖經目錄選擇書卷 ID: ${bookId}`);
  navOverlayState.selectedBookId = bookId;
  navOverlayState.selectedChapter = 1;
  window.switchNavTab('chapter');
}

function selectNavChapter(chNum) {
  console.log(`➡️ [Debug] 聖經目錄選擇章節數: ${chNum}`);
  navOverlayState.selectedChapter = chNum;
  window.switchNavTab('verse');
}

async function selectNavVerse(vNum) {
  console.log(`➡️ [Debug] 聖經目錄選擇節數: ${vNum}`);
  navOverlayState.selectedVerse = vNum;
  
  closeReaderLayer(document.getElementById("bible-nav-overlay"));
  
  state.readerState.bookId = navOverlayState.selectedBookId;
  state.readerState.chapter = navOverlayState.selectedChapter;
  
  const bookSelect = document.getElementById("reader-book-select");
  if (bookSelect) {
    bookSelect.value = String(navOverlayState.selectedBookId);
    populateChapterSelector();
  }
  const chapterSelect = document.getElementById("reader-chapter-select");
  if (chapterSelect) {
    chapterSelect.value = String(navOverlayState.selectedChapter);
  }
  
  saveReaderPreferences();
  updatePillLabels();
  
  try {
    await renderReaderText();
    
    const container = document.getElementById("bible-content");
    if (container) {
      setTimeout(() => {
        const verses = container.querySelectorAll(".bible-verse");
        for (let v of verses) {
          const numEl = v.querySelector(".verse-num");
          if ((v.dataset.verse && parseInt(v.dataset.verse) === vNum) || (numEl && parseInt(numEl.textContent) === vNum)) {
            v.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            const oldBg = v.style.backgroundColor;
            v.style.backgroundColor = 'var(--color-brand-subtle, rgba(4,169,210,0.22))';
            setTimeout(() => {
              v.style.backgroundColor = oldBg;
            }, 1500);
            break;
          }
        }
      }, 100);
    }
  } catch (err) {
    console.error(err);
  }
}

window.__BIBLE_SEARCH_CORPUS = window.__BIBLE_SEARCH_CORPUS || null;

window.setBibleSearchCorpus = function(corpus) {
  window.__BIBLE_SEARCH_CORPUS = Array.isArray(corpus) ? corpus : null;
};

function searchLocalBibleCorpus(query) {
  const corpus = window.__BIBLE_SEARCH_CORPUS;
  if (!Array.isArray(corpus) || !query) return null;
  const needle = query.toLowerCase();
  return corpus
    .filter(item => String(item.text || "").toLowerCase().includes(needle))
    .slice(0, 120)
    .map(item => ({
      bookName: item.bookName || item.book || "",
      bookEng: item.bookEng || "",
      chapter: Number(item.chapter || 1),
      verse: Number(item.verse || 1),
      text: String(item.text || "")
    }));
}

window.searchBibleText = async function(query, translation = "CUNP") {
  const localResults = searchLocalBibleCorpus(query);
  if (localResults) return localResults;

  const url = `https://bolls.life/search/${encodeURIComponent(translation)}/?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search request failed");
  const data = await res.json();
  
  return data.map(item => {
    const book = BIBLE_BOOKS.find(b => b.id === item.book);
    return {
      bookName: book ? book.name : String(item.book),
      bookEng: book ? book.eng : "",
      chapter: item.chapter,
      verse: item.verse,
      text: item.text
    };
  });
};

export function updateReaderBottomActionBar() {
  const bar = document.getElementById("reader-bottom-action-bar");
  if (!bar) return;
  bar.style.display = "none";
  bar.classList.add("hidden");
}

function getNextPlanChapterInfo(plan, planDay, currentChIndex, dayChapters) {
  if (currentChIndex !== -1 && currentChIndex < dayChapters.length - 1) {
    return {
      book: dayChapters[currentChIndex + 1].book,
      chapter: dayChapters[currentChIndex + 1].chapter,
      dayNum: planDay
    };
  }
  
  const nextDays = plan.days.filter(d => d.dayNum > planDay);
  for (const d of nextDays) {
    const firstUnread = d.chapters.find(ch => !ch.isRead);
    if (firstUnread) {
      return {
        book: firstUnread.book,
        chapter: firstUnread.chapter,
        dayNum: d.dayNum
      };
    }
  }
  return null;
}

function triggerPredictivePrefetch() {
  const currentBook = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  if (!currentBook) return;

  let nextBookEng = currentBook.eng;
  let nextChapter = state.readerState.chapter + 1;

  if (nextChapter > currentBook.chapters) {
    const nextBook = BIBLE_BOOKS.find(b => b.id === currentBook.id + 1);
    if (nextBook) {
      nextBookEng = nextBook.eng;
      nextChapter = 1;
    } else {
      return;
    }
  }

  const cacheKey = `${nextBookEng}_${nextChapter}`;
  if (window._bibleChapterCache && window._bibleChapterCache[cacheKey]) {
    return;
  }

  console.log(`📡 [背景預載啟動] 正在預載下一章: ${nextBookEng} ${nextChapter}章`);
  fetchBibleChapter(nextBookEng, nextChapter)
    .then(data => {
      if (window._bibleChapterCache) {
        window._bibleChapterCache[cacheKey] = data;
        console.log(`💾 [背景預載完成] 已快取下一章: ${cacheKey}`);
      }
    })
    .catch(err => {
      console.warn(`⚠️ [背景預載失敗] 無法預載下一章: ${cacheKey}`, err);
    });
}

function getReaderScrollSurface() {
  const readerSurface = document.querySelector(".reader-reading-surface");
  const mainSurface = document.querySelector(".main-content");
  if (readerSurface && Number(readerSurface.scrollHeight) > Number(readerSurface.clientHeight) + 1) return readerSurface;
  if (mainSurface && Number(mainSurface.scrollHeight) > Number(mainSurface.clientHeight) + 1) return mainSurface;
  return readerSurface || mainSurface;
}

function checkReaderBottomDwell(surface = getReaderScrollSurface(), isAtBottom = null) {
  if (!readerBottomDwellController || !surface) return;
  const taskContext = getCurrentPlanReaderTask();
  readerBottomDwellController.check(surface, {
    eligible: Boolean(
      taskContext &&
      window.appRouter && window.appRouter.currentTab === "reader-view" &&
      !isCurrentPlanReaderTaskRead(taskContext) &&
      !state.readerState.autoMarked &&
      !state.readerState.autoMarkInFlight
    ),
    targetKey: getCurrentPlanReaderTargetKey(),
    isAtBottom
  });
}

function bindReaderEndObserver() {
  readerEndObserver?.disconnect();
  readerEndObserver = null;
  readerEndVisible = false;
  const root = getReaderScrollSurface();
  const sentinel = document.getElementById("reader-end-sentinel");
  if (!root || !sentinel) return;
  readerEndObserver = observeReaderEndSentinel({
    root,
    sentinel,
    onChange: isVisible => {
      readerEndVisible = isVisible;
      if (isVisible) {
        const targetKey = getCurrentPlanReaderTargetKey();
        const noticeKey = targetKey || `missing|${state.readerState?.bookId}|${state.readerState?.chapter}`;
        if (state.readerState?.fromPlan && readerAutoReadNoticeKey !== noticeKey) {
          readerAutoReadNoticeKey = noticeKey;
          console.info("[AutoRead] Reader bottom detected", {
            targetKey: targetKey || null,
            planContextId: state.readerState?.planContextId || null,
            bookId: state.readerState?.bookId || null,
            chapter: state.readerState?.chapter || null
          });
        }
        checkReaderBottomDwell(root, () => readerEndVisible);
      } else readerBottomDwellController?.cancel();
    }
  });
}
function scheduleReaderBottomDwellCheck() {
  requestAnimationFrame(() => requestAnimationFrame(() => checkReaderBottomDwell()));
}

function handleReaderScroll(event) {
  const bar = document.getElementById("reader-bottom-action-bar");
  if (bar) {
    bar.style.display = "none";
    bar.classList.add("hidden");
  }

  checkReaderBottomDwell(getReaderScrollSurface() || event.currentTarget || event.target);
}

function isTodayScheduleCompleted() {
  if (!state.activePlan) return false;
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const todayDayObj = state.activePlan.days.find(d => {
    if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
    const parts = d.date.split('/');
    return parts.length === 2 && Number(parts[1]) === todayDay;
  });

  if (!todayDayObj || !todayDayObj.chapters || todayDayObj.chapters.length === 0) return false;

  const currentRound = state.activePlan.currentRound || 1;
  return todayDayObj.chapters.every(ch => {
    const r = ch.round || currentRound;
    if (r === 1) return Boolean(ch.isReadR1 || ch.isRead);
    if (r === 2) return Boolean(ch.isReadR2);
    if (r >= 3) return Boolean(ch.isReadR3);
    return Boolean(ch.isRead);
  });
}

function showPlanNavigationPrompt(options = {}) {
  let onCatchUp = options.onCatchUp;
  let onReadAhead = options.onReadAhead;
  let readAheadDayNum = options.readAheadDayNum || 2;
  let hasCatchUp = options.hasCatchUp || false;
  let catchUpDayNum = options.catchUpDayNum || null;

  if (typeof options === "function") {
    onCatchUp = arguments[0];
    onReadAhead = arguments[1];
    readAheadDayNum = arguments[2] || 2;
    hasCatchUp = false;
  }

  // Remove existing dialog if any
  const existing = document.getElementById("plan-nav-prompt-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "plan-nav-prompt-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
    animation: fadeIn 0.2s ease;
  `;

  const catchUpBtnHtml = hasCatchUp
    ? `<button id="plan-nav-catchup-btn" type="button" style="
        padding: 0.75rem; border-radius: var(--radius-md, 12px); font-size: 0.9rem; font-weight: 500;
        border: none; background: var(--color-brand); color: white; cursor: pointer;
      ">繼續補讀第 ${catchUpDayNum || ''} 天未完進度</button>`
    : '';

  const readAheadStyle = hasCatchUp
    ? `border: 1.5px solid var(--color-brand); background: var(--bg-input); color: var(--color-brand);`
    : `border: none; background: var(--color-brand); color: white;`;

  overlay.innerHTML = `
    <div id="plan-nav-prompt-dialog" style="
      background: var(--bg-card, white);
      border-radius: 16px;
      padding: 1.5rem;
      width: 100%; max-width: 400px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      animation: slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
      text-align: center;
    ">
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.6rem; margin-bottom:1.2rem;">
        <span style="font-size: 2.2rem; display: block; margin-bottom: 0.4rem;">🎉</span>
        <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text-primary);">恭喜完成今日進度！</h3>
        <p style="margin:0.5rem 0 0; font-size:0.88rem; color:var(--text-secondary); line-height: 1.5;">
          您已讀完今日計畫的所有章節。接下來，您想要繼續做什麼？
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:0.75rem; width:100%;">
        ${catchUpBtnHtml}

        <button id="plan-nav-readahead-btn" type="button" style="
          padding: 0.75rem; border-radius: var(--radius-md, 12px); font-size: 0.9rem; font-weight: 500;
          cursor: pointer; ${readAheadStyle}
        ">超前閱讀第 ${readAheadDayNum} 天進度</button>

        <button id="plan-nav-cancel-btn" type="button" style="
          padding: 0.6rem; border-radius: var(--radius-md, 12px); font-size: 0.85rem; font-weight: 500;
          border: none; background: transparent; color: var(--text-muted); cursor: pointer;
        ">取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Bind actions
  overlay.querySelector("#plan-nav-catchup-btn").onclick = () => {
    overlay.remove();
    if (typeof onCatchUp === "function") onCatchUp();
  };

  overlay.querySelector("#plan-nav-readahead-btn").onclick = () => {
    overlay.remove();
    if (typeof onReadAhead === "function") onReadAhead();
  };

  overlay.querySelector("#plan-nav-cancel-btn").onclick = () => {
    overlay.remove();
  };

  // Close when clicking overlay backdrop
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };
}

export function init() {
  initReaderControls();
}

window.renderReaderText = renderReaderText;
window.saveReaderPreferences = saveReaderPreferences;
window.populateBookSelector = populateBookSelector;
window.populateChapterSelector = populateChapterSelector;
window.updatePillLabels = updatePillLabels;
window.updateReaderFontSize = updateReaderFontSize;
window.navigateToChapter = navigateToChapter;
window.initReaderControls = init;
