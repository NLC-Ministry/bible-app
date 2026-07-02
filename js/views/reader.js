// Bible Reader tab view controller

function openReaderLayer(element) {
  if (!element) return;
  element.classList.remove("hidden");
  element.setAttribute("aria-hidden", "false");
  document.body.classList.add("reader-modal-open");
}

function closeReaderLayer(element) {
  if (!element) return;
  element.classList.add("hidden");
  element.setAttribute("aria-hidden", "true");
  const stillOpen = document.querySelector(".full-page-overlay:not(.hidden), .bottom-sheet-backdrop:not(.hidden), .loader-overlay:not(.hidden)");
  document.body.classList.toggle("reader-modal-open", Boolean(stillOpen));
}

function initReaderControls() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  const drawer = document.getElementById("reader-nav-drawer");
  const bookBadge = document.getElementById("reader-book-badge");
  const chapterBadge = document.getElementById("reader-chapter-badge");
  const readerBackBtn = document.getElementById("reader-back-btn");

  if (readerBackBtn) {
    readerBackBtn.addEventListener("click", () => {
      const globalBackBtn = document.getElementById("global-back-btn");
      if (globalBackBtn) globalBackBtn.click();
    });
  }

  // Load books list
  populateBookSelector("all");
  populateChapterSelector();
  updatePillLabels();
  renderReaderPicker();

  function toggleDrawer(forceOpen) {
    if (!drawer) return;
    const isOpen = drawer.classList.contains("open");
    const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
    drawer.classList.toggle("open", shouldOpen);
    if (shouldOpen) renderReaderPicker();
    if (bookBadge) bookBadge.classList.toggle("active", shouldOpen);
    if (chapterBadge) chapterBadge.classList.toggle("active", shouldOpen);
    
    const dirBtn = document.getElementById("reader-nav-directory-btn");
    if (dirBtn) dirBtn.classList.toggle("active", shouldOpen);
  }

  if (bookBadge) bookBadge.addEventListener("click", () => toggleDrawer());
  if (chapterBadge) chapterBadge.addEventListener("click", () => toggleDrawer());

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#reader-nav-drawer") && !e.target.closest("#reader-pill-bar") && !e.target.closest("#reader-top-navbar")) {
      toggleDrawer(false);
    }
  }, true);

  // ── New navigation and settings controls (Mockup Screenshot Design) ──
  const navDirectoryBtn = document.getElementById("reader-nav-directory-btn");
  if (navDirectoryBtn) {
    navDirectoryBtn.addEventListener("click", () => {
      if (typeof window.openBibleNavOverlay === "function") {
        window.openBibleNavOverlay();
      }
    });
  }

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

  // Global Search overlay hooks
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
      }, 400); // 400ms debounce
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

  // Display Settings Bottom Sheet hooks
  const settingsTrigger = document.getElementById("reader-settings-trigger-btn");
  const settingsBackdrop = document.getElementById("typography-settings-backdrop");
  const settingsCloseBtn = document.getElementById("typography-sheet-close-btn");

  if (settingsTrigger && settingsBackdrop) {
    settingsTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      openReaderLayer(settingsBackdrop);
      updateSheetActiveStates();
    });
  }

  if (settingsCloseBtn && settingsBackdrop) {
    settingsCloseBtn.addEventListener("click", () => {
      closeReaderLayer(settingsBackdrop);
    });
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === settingsBackdrop) {
        closeReaderLayer(settingsBackdrop);
      }
    });
  }

  // Bind font size buttons in bottom sheet
  document.querySelectorAll(".font-size-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const size = parseInt(btn.dataset.size);
      state.readerState.fontSize = size;
      updateReaderFontSize();
      updateSheetActiveStates();
    });
  });

  // Bind theme buttons in bottom sheet
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

  // Reader picker controls
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
      toggleDrawer(false);
    });
  }

  if (chapterSelect) {
    chapterSelect.addEventListener("change", () => {
      state.readerState.chapter = parseInt(chapterSelect.value);
      saveReaderPreferences();
      renderReaderText();
      renderReaderPicker();
      updatePillLabels();
      toggleDrawer(false);
    });
  }

  // ── Font size buttons (new pill bar IDs) ──
  const incFont = document.getElementById("reader-font-increase");
  const decFont = document.getElementById("reader-font-decrease");
  if (incFont) incFont.addEventListener("click", () => {
    if (state.readerState.fontSize < 36) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (decFont) decFont.addEventListener("click", () => {
    if (state.readerState.fontSize > 12) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });
  // Legacy font buttons (kept for safety)
  const legacyInc = document.getElementById("increase-font");
  const legacyDec = document.getElementById("decrease-font");
  if (legacyInc) legacyInc.addEventListener("click", () => {
    if (state.readerState.fontSize < 36) { state.readerState.fontSize += 2; updateReaderFontSize(); }
  });
  if (legacyDec) legacyDec.addEventListener("click", () => {
    if (state.readerState.fontSize > 12) { state.readerState.fontSize -= 2; updateReaderFontSize(); }
  });

  // ── Prev / Next Chapter Buttons ──
  const prevChapterBtn = document.getElementById("prev-chapter-btn");
  const nextChapterBtn = document.getElementById("next-chapter-btn");
  if (prevChapterBtn) prevChapterBtn.addEventListener("click", () => navigateToChapter(-1));
  if (nextChapterBtn) nextChapterBtn.addEventListener("click", () => navigateToChapter(1));

  // ── Floating Prev / Next Chapter Buttons ──
  const floatPrev = document.getElementById("floating-prev-btn");
  const floatNext = document.getElementById("floating-next-btn");
  if (floatPrev) floatPrev.addEventListener("click", () => navigateToChapter(-1));
  if (floatNext) floatNext.addEventListener("click", () => navigateToChapter(1));



  // Mark chapter read checkbox
  const markReadBtn = document.getElementById("mark-read-btn");
  if (markReadBtn) {
    markReadBtn.addEventListener("click", () => {
      const wasChecked = markReadBtn.classList.contains("checked");
      const isChecked = !wasChecked;
      const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
      if (!bookObj) return;

      // 1. 💡 立即在本機更新記憶體與按鈕打勾狀態（完全零延遲）
      markReadBtn.classList.toggle("checked", isChecked);

      let planDayChKey = null;
      if (state.activePlan) {
        planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
        updatePlanCheckboxState(planDayChKey, isChecked);
        calculatePlanProgress();
        if (typeof updateDashboardView === "function") {
          updateDashboardView();
        }
      }

      // 2. 💡 背景非同步向 Supabase 發送進度更新，不阻塞 UI 操作
      db.logChapterRead(bookObj.name, state.readerState.chapter, isChecked)
        .then(async () => {
          if (state.activePlan) {
            if (state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
              await handleRoundCompletion(state.activePlan);
            }
          }
        })
        .catch(error => {
          console.error("Failed to update reader progress in background", error);
          // 💡 同步失敗時，自動還原按鈕打勾狀態與進度
          markReadBtn.classList.toggle("checked", wasChecked);
          if (state.activePlan && planDayChKey) {
            updatePlanCheckboxState(planDayChKey, wasChecked);
            calculatePlanProgress();
            if (typeof updateDashboardView === "function") {
              updateDashboardView();
            }
          }
          showToast("讀經進度同步失敗，請稍後再試");
        });
    });
  }
  // Reading progress is updated only by the user's explicit check action.
}

function renderReaderPicker() {
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
      const drawer = document.getElementById("reader-nav-drawer");
      const bookBadge = document.getElementById("reader-book-badge");
      const chapterBadge = document.getElementById("reader-chapter-badge");
      if (drawer) drawer.classList.remove("open");
      if (bookBadge) bookBadge.classList.remove("active");
      if (chapterBadge) chapterBadge.classList.remove("active");
    });
    grid.appendChild(btn);
  }
}

function populateBookSelector(filter) {
  const bookSelect = document.getElementById("reader-book-select");
  bookSelect.innerHTML = "";

  BIBLE_BOOKS.forEach(book => {
    if (filter === "all" || book.section === filter) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = `${book.name} (${book.abbrev})`;
      if (book.id === state.readerState.bookId) {
        option.selected = true;
      }
      bookSelect.appendChild(option);
    }
  });
}

function populateChapterSelector() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  
  const bookId = parseInt(bookSelect.value);
  state.readerState.bookId = bookId;
  
  const book = BIBLE_BOOKS.find(b => b.id === bookId);
  if (!book) {
    console.error("Book not found for ID:", bookId);
    return;
  }
  
  chapterSelect.innerHTML = "";

  for (let i = 1; i <= book.chapters; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `${i} 章`;
    if (i === state.readerState.chapter) {
      option.selected = true;
    }
    chapterSelect.appendChild(option);
  }

  // Ensure chapter fits within scope
  if (state.readerState.chapter > book.chapters) {
    state.readerState.chapter = 1;
    if (chapterSelect.options.length > 0) {
      chapterSelect.options[0].selected = true;
    }
  }
}

function saveReaderPreferences() {
  localStorage.setItem("reader_state", JSON.stringify({
    bookId: state.readerState.bookId,
    chapter: state.readerState.chapter
  }));
}

// Update the compact pill bar labels to reflect current book/chapter
function updatePillLabels() {
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

// Keep a version in memory and store locally
function updateReaderFontSize() {
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

function navigateToChapter(direction) {
  const currentBook = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  let newChapter = state.readerState.chapter + direction;
  
  if (newChapter < 1) {
    // Go to previous book
    const prevBookId = state.readerState.bookId - 1;
    if (prevBookId >= 1) {
      const prevBook = BIBLE_BOOKS.find(b => b.id === prevBookId);
      state.readerState.bookId = prevBookId;
      state.readerState.chapter = prevBook.chapters;
      
      document.getElementById("reader-testament-select").value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else if (newChapter > currentBook.chapters) {
    // Go to next book
    const nextBookId = state.readerState.bookId + 1;
    if (nextBookId <= 66) {
      state.readerState.bookId = nextBookId;
      state.readerState.chapter = 1;
      
      document.getElementById("reader-testament-select").value = "all";
      populateBookSelector("all");
      populateChapterSelector();
      saveReaderPreferences();
      renderReaderText();
    }
  } else {
    // Stay in same book
    state.readerState.chapter = newChapter;
    document.getElementById("reader-chapter-select").value = newChapter;
    saveReaderPreferences();
    renderReaderText();
  }
}

async function renderReaderText() {
  const container = document.getElementById("bible-content");
  
  // Reset autoMarked for the newly loaded chapter
  state.readerState.autoMarked = false;
  const heading = document.getElementById("bible-title");
  const markReadBtn = document.getElementById("mark-read-btn");
  
  const book = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  const chapter = state.readerState.chapter;

  heading.textContent = `${book.name} ${chapter}章`;
  updatePillLabels();
  renderReaderPicker();
  container.innerHTML = `<div class="loader-inline">讀取經文中...</div>`;
  
  // Set checked button status
  if (markReadBtn) {
    const isRead = state.readingLogs.some(l => l.book === book.name && l.chapter === chapter);
    if (isRead) {
      markReadBtn.classList.add("checked");
    } else {
      markReadBtn.classList.remove("checked");
    }
  }

  try {
    const data = await fetchBibleChapter(book.eng, chapter);

    container.innerHTML = "";
    data.verses.forEach(v => {
      const verseDiv = document.createElement("div");
      verseDiv.className = "bible-verse";
      verseDiv.dataset.verse = String(v.verse);
      verseDiv.id = `reader-verse-${v.verse}`;

      // Highlight if marked
      const highlightKey = `${book.name}_${chapter}_${v.verse}`;
      if (state.highlights[highlightKey]) {
        verseDiv.style.backgroundColor = state.highlights[highlightKey];
        verseDiv.classList.add("selected");
      }

      verseDiv.innerHTML = `<span class="verse-num">${v.verse}</span><span class="verse-text">${v.text}</span>`;

      // Add Click listeners for highlighting verses
      verseDiv.addEventListener("click", (e) => {
        e.stopPropagation();
        showContextToolbar(verseDiv, highlightKey);
      });

      container.appendChild(verseDiv);
    });
  } catch (error) {
    console.error("Failed to load complete Bible chapter:", error);
    container.innerHTML = "";
    const errorDiv = document.createElement("div");
    errorDiv.className = "reader-error-state";
    errorDiv.textContent = error.message || "目前無法載入完整章節，請稍後再試。";
    container.appendChild(errorDiv);
  }

  // Make sure we apply font size preference
  updateReaderFontSize();
}

// Floating context menu toolbar for highlights
function showContextToolbar(verseElement, highlightKey) {
  const toolbar = document.getElementById("context-toolbar");
  
  // Display floating menu near clicked element
  const rect = verseElement.getBoundingClientRect();
  toolbar.style.top = `${window.scrollY + rect.top}px`;
  toolbar.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
  toolbar.classList.add("active");

  const actionHandler = (e) => {
    e.stopPropagation();
    const action = e.target.getAttribute("data-action");
    const color = e.target.style.backgroundColor;

    if (action === "highlight") {
      verseElement.style.backgroundColor = color;
      verseElement.classList.add("selected");
      state.highlights[highlightKey] = color;
    } else if (action === "clear") {
      verseElement.style.backgroundColor = "";
      verseElement.classList.remove("selected");
      delete state.highlights[highlightKey];
    }
    
    localStorage.setItem("bible_highlights", JSON.stringify(state.highlights));
    
    toolbar.classList.remove("active");
    document.removeEventListener("click", documentClickHandler);
  };

  toolbar.querySelectorAll(".toolbar-action").forEach(btn => {
    btn.onclick = actionHandler;
  });

  const documentClickHandler = () => {
    toolbar.classList.remove("active");
    document.removeEventListener("click", documentClickHandler);
  };

  setTimeout(() => {
    document.addEventListener("click", documentClickHandler);
  }, 10);
}

// ==========================================================================
// Bible Reader Version, Audio, Search, and Theme Helpers
// ==========================================================================
window.toggleBibleVersion = function() {
  const current = state.readerState.version || "CUNP";
  let next = "CUNP";
  if (current === "CUNP") next = "RCUVTS";
  else if (current === "RCUVTS") next = "CUV";
  else next = "CUNP";
  
  state.readerState.version = next;
  localStorage.setItem("reader_bible_version", next);
  
  // Update version button text
  const versionBtn = document.getElementById("reader-nav-version-btn");
  if (versionBtn) {
    const label = next === "CUNP" ? "CUNP" : (next === "RCUVTS" ? "RCUV" : "CUV");
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
    const inlineVersion = document.getElementById("reader-version-inline");
    if (inlineVersion) inlineVersion.textContent = label;
  }
  
  showToast(`已切換譯本至 ${next === "CUNP" ? "新譯標點和合本" : (next === "RCUVTS" ? "和合本修訂版" : "官話和合本")}`);
  renderReaderText();
};

let isSpeaking = false;
let speechUtterance = null;

window.toggleReaderAudio = function() {
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    const btn = document.getElementById("reader-audio-btn");
    if (btn) btn.classList.remove("active");
    showToast("已停止朗讀");
  } else {
    const container = document.getElementById("bible-content");
    if (!container) return;
    const verses = Array.from(container.querySelectorAll(".verse-text")).map(el => el.textContent).join(" ");
    if (!verses) return;
    
    window.speechSynthesis.cancel();
    speechUtterance = new SpeechSynthesisUtterance(verses);
    speechUtterance.lang = "zh-TW";
    speechUtterance.rate = 1.0;
    
    speechUtterance.onend = () => {
      isSpeaking = false;
      const btn = document.getElementById("reader-audio-btn");
      if (btn) btn.classList.remove("active");
    };
    
    speechUtterance.onerror = () => {
      isSpeaking = false;
      const btn = document.getElementById("reader-audio-btn");
      if (btn) btn.classList.remove("active");
    };
    
    window.speechSynthesis.speak(speechUtterance);
    isSpeaking = true;
    const btn = document.getElementById("reader-audio-btn");
    if (btn) btn.classList.add("active");
    showToast("開始朗讀經文...");
  }
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

window.applyAppTheme = function(themeName) {
  state.theme = themeName;
  if (typeof setBodyThemeClass === "function") {
    setBodyThemeClass(themeName);
  } else {
    document.body.classList.remove("light-theme", "warm-theme", "dark-theme");
    document.body.classList.add(themeName + "-theme");
  }
  const isReaderPage = window.appRouter && window.appRouter.currentTab === "reader-view";
  document.body.classList.toggle("reader-page", Boolean(isReaderPage));
  const appLayout = document.querySelector(".app-layout");
  if (appLayout) appLayout.classList.toggle("reader-mode", Boolean(isReaderPage));
  localStorage.setItem("app_theme", themeName);
  
  // Update settings dropdown active state if it exists
  document.querySelectorAll("#reader-settings-dropdown .theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === themeName);
  });

  // Update bottom sheet active state
  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === themeName);
  });
};

// ==========================================================================
// Bible Navigation Overlay (Catalog Shell) State and Handlers
// ==========================================================================
let navOverlayState = {
  activeTab: 'book', // 'book', 'chapter', 'verse'
  selectedBookId: 1,
  selectedChapter: 1,
  selectedVerse: 1,
  viewMode: 'grid', // 'grid', 'list'
  autoAdvance: true
};

window.openBibleNavOverlay = function() {
  const overlay = document.getElementById("bible-nav-overlay");
  if (!overlay) return;
  
  // Sync selections with global reader state
  navOverlayState.selectedBookId = state.readerState.bookId;
  navOverlayState.selectedChapter = state.readerState.chapter;
  navOverlayState.selectedVerse = 1;
  
  openReaderLayer(overlay);
  
  // Initialize grid mode buttons in DOM
  const gridBtn = document.getElementById("view-mode-grid");
  const listBtn = document.getElementById("view-mode-list");
  if (gridBtn && listBtn) {
    gridBtn.classList.toggle("active", navOverlayState.viewMode === 'grid');
    listBtn.classList.toggle("active", navOverlayState.viewMode === 'list');
  }

  // Bind Segmented Tab clicks once
  const tabs = document.querySelectorAll("#bible-nav-overlay .segmented-tab");
  tabs.forEach(tab => {
    if (!tab.dataset.bound) {
      tab.dataset.bound = "true";
      tab.addEventListener("click", () => {
        window.switchNavTab(tab.dataset.tab);
      });
    }
  });

  // Bind view mode triggers once
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

  // Bind back button once
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
  navOverlayState.activeTab = tabName;
  
  // Update segmented control tabs
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
      // 5-Column Grid Mode
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
      // List Mode
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
        item.className = "list-item-book";
        item.classList.toggle("active", b.id === navOverlayState.selectedBookId);
        item.innerHTML = `
          <span>${b.name}</span>
          <span class="abbrev-badge">${b.abbrev}</span>
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
    
    const loader = document.createElement("div");
    loader.className = "loader-inline";
    loader.style.padding = "2.5rem";
    loader.textContent = "讀取章節總節數中...";
    container.appendChild(loader);
    
    if (book) {
      fetchBibleChapter(book.eng, navOverlayState.selectedChapter)
        .then(data => {
          container.innerHTML = "";
          const grid = document.createElement("div");
          grid.className = "verse-nav-grid";
          
          const totalVerses = data.verses.length;
          for (let v = 1; v <= totalVerses; v++) {
            const item = document.createElement("div");
            item.className = "grid-item-number";
            item.textContent = v;
            item.addEventListener("click", () => selectNavVerse(v));
            grid.appendChild(item);
          }
          container.appendChild(grid);
        })
        .catch(err => {
          container.innerHTML = `<div class="reader-error-state" style="margin:1rem;">無法加載節數資訊：${err.message}</div>`;
        });
    }
  }
}

function selectNavBook(bookId) {
  navOverlayState.selectedBookId = bookId;
  navOverlayState.selectedChapter = 1;
  
  const autoAdvance = document.getElementById("bible-nav-auto-advance")?.checked !== false;
  if (autoAdvance) {
    window.switchNavTab('chapter');
  } else {
    renderBibleNavContent();
  }
}

function selectNavChapter(chNum) {
  navOverlayState.selectedChapter = chNum;
  
  const autoAdvance = document.getElementById("bible-nav-auto-advance")?.checked !== false;
  if (autoAdvance) {
    window.switchNavTab('verse');
  } else {
    renderBibleNavContent();
  }
}

async function selectNavVerse(vNum) {
  navOverlayState.selectedVerse = vNum;
  
  // Close overlay
  closeReaderLayer(document.getElementById("bible-nav-overlay"));
  
  // Apply update to state and trigger re-render
  state.readerState.bookId = navOverlayState.selectedBookId;
  state.readerState.chapter = navOverlayState.selectedChapter;
  
  // Sync selects
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
  
  // Show loader overlay since it is a full page transition
  showLoader("讀取經文中...");
  
  try {
    await renderReaderText();
    
    // Scroll to the verse
    const container = document.getElementById("bible-content");
    if (container) {
      setTimeout(() => {
        const verses = container.querySelectorAll(".bible-verse");
        for (let v of verses) {
          const numEl = v.querySelector(".verse-num");
          if ((v.dataset.verse && parseInt(v.dataset.verse) === vNum) || (numEl && parseInt(numEl.textContent) === vNum)) {
            v.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Visual physical flash feedback
            const oldBg = v.style.backgroundColor;
            v.style.backgroundColor = 'rgba(99, 102, 241, 0.22)';
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
  } finally {
    hideLoader();
  }
}

// Helper to show/hide loading spinner overlay
function showLoader(text) {
  const overlay = document.getElementById("loader-overlay");
  if (overlay) {
    const textEl = overlay.querySelector(".loader-text");
    if (textEl) textEl.textContent = text;
    openReaderLayer(overlay);
  }
}

function hideLoader() {
  const overlay = document.getElementById("loader-overlay");
  if (overlay) closeReaderLayer(overlay);
}

// ==========================================================================
// Full-Text Bible Search client (local corpus first, Bolls API fallback)
// ==========================================================================
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
