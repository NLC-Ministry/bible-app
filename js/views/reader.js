// Bible Reader tab view controller

function initReaderControls() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");
  const drawer = document.getElementById("reader-nav-drawer");
  const bookBadge = document.getElementById("reader-book-badge");
  const chapterBadge = document.getElementById("reader-chapter-badge");

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
    navDirectoryBtn.addEventListener("click", () => toggleDrawer());
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

  const searchBtn = document.getElementById("reader-search-btn");
  const searchPanel = document.getElementById("reader-search-panel");
  const searchInput = document.getElementById("reader-search-input");
  const searchCloseBtn = document.getElementById("reader-search-close-btn");

  if (searchBtn && searchPanel) {
    searchBtn.addEventListener("click", () => {
      const isHidden = searchPanel.classList.contains("hidden");
      searchPanel.classList.toggle("hidden", !isHidden);
      searchBtn.classList.toggle("active", isHidden);
      if (isHidden && searchInput) {
        searchInput.focus();
      } else if (!isHidden && searchInput) {
        searchInput.value = "";
        if (typeof window.searchChapterVerses === "function") window.searchChapterVerses("");
      }
    });
  }

  if (searchCloseBtn && searchPanel && searchBtn) {
    searchCloseBtn.addEventListener("click", () => {
      searchPanel.classList.add("hidden");
      searchBtn.classList.remove("active");
      if (searchInput) {
        searchInput.value = "";
        if (typeof window.searchChapterVerses === "function") window.searchChapterVerses("");
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      if (typeof window.searchChapterVerses === "function") {
        window.searchChapterVerses(e.target.value);
      }
    });
  }

  const settingsTrigger = document.getElementById("reader-settings-trigger-btn");
  const settingsDropdown = document.getElementById("reader-settings-dropdown");

  if (settingsTrigger && settingsDropdown) {
    settingsTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsDropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".reader-settings-container")) {
        settingsDropdown.classList.add("hidden");
      }
    });
  }

  // Bind font size buttons in settings dropdown
  document.querySelectorAll("#reader-settings-dropdown .font-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const size = parseInt(btn.dataset.size);
      state.readerState.fontSize = size;
      updateReaderFontSize();
    });
  });

  // Bind theme buttons in settings dropdown
  document.querySelectorAll("#reader-settings-dropdown .theme-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      if (typeof window.applyAppTheme === "function") {
        window.applyAppTheme(theme);
      }
    });
  });

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
    const label = version === "CUNP" ? "CUNP-神" : (version === "RCUVTS" ? "RCUV-神" : "CUV-神");
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
  }
}

// Keep a version in memory and store locally
function updateReaderFontSize() {
  const bibleContent = document.getElementById("bible-content");
  if (bibleContent) bibleContent.style.fontSize = state.readerState.fontSize + "px";
  
  localStorage.setItem("reader_font_size", state.readerState.fontSize);

  // Update active button state in settings dropdown
  document.querySelectorAll("#reader-settings-dropdown .font-btn").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.size) === state.readerState.fontSize);
  });

  // Update active theme button state in settings dropdown
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
    const label = next === "CUNP" ? "CUNP-神" : (next === "RCUVTS" ? "RCUV-神" : "CUV-神");
    const span = versionBtn.querySelector("span");
    if (span) span.textContent = label;
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
  document.body.className = themeName + "-theme";
  localStorage.setItem("app_theme", themeName);
  
  // Update setting dropdown button active state
  document.querySelectorAll("#reader-settings-dropdown .theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === themeName);
  });
};
