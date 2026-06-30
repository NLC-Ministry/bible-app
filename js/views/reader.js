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
  }

  if (bookBadge) bookBadge.addEventListener("click", () => toggleDrawer());
  if (chapterBadge) chapterBadge.addEventListener("click", () => toggleDrawer());

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#reader-nav-drawer") && !e.target.closest("#reader-pill-bar")) {
      toggleDrawer(false);
    }
  }, true);

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
    markReadBtn.addEventListener("click", async () => {
      if (markReadBtn.dataset.saving === "true") return;

      const wasChecked = markReadBtn.classList.contains("checked");
      const isChecked = !wasChecked;
      const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
      if (!bookObj) return;

      markReadBtn.dataset.saving = "true";
      markReadBtn.disabled = true;
      markReadBtn.classList.toggle("checked", isChecked);

      try {
        await db.logChapterRead(bookObj.name, state.readerState.chapter, isChecked);

        if (state.activePlan) {
          const planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
          updatePlanCheckboxState(planDayChKey, isChecked);
          calculatePlanProgress();
          if (state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
            await handleRoundCompletion(state.activePlan);
          }
        }
      } catch (error) {
        console.error("Failed to update reader progress", error);
        markReadBtn.classList.toggle("checked", wasChecked);
        showToast("讀經進度更新失敗，請稍後再試");
      } finally {
        markReadBtn.dataset.saving = "false";
        markReadBtn.disabled = false;
      }
    });
  }
  // Scroll to bottom detection to automatically mark as read
  window.addEventListener("scroll", async () => {
    const readerView = document.getElementById("reader-view");
    if (!readerView || readerView.classList.contains("hidden")) return;

    if (state.readerState.autoMarked) return;

    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;

    // Use a 50px buffer to account for mobile zooming/elastic scroll
    if (scrollTop + windowHeight >= docHeight - 50) {
      state.readerState.autoMarked = true; // prevent double trigger
      
      const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
      const chapter = state.readerState.chapter;
      
      if (!bookObj) return;

      const isAlreadyRead = state.readingLogs.some(l => l.book === bookObj.name && l.chapter === chapter);
      if (!isAlreadyRead) {
        // Log chapter read in DB
        await db.logChapterRead(bookObj.name, chapter, true);
        
        // Update states and recalculate progress
        calculatePlanProgress();
        db.saveLocalUserStats();

        // Update plan list page checkbox if matching
        updatePlanCheckboxState(`${bookObj.name}_${chapter}`, true);

        // Check if active plan finishes
        if (state.activePlan && state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
          await handleRoundCompletion(state.activePlan);
        }

        // Show premium toast alert
        showToast(`📖 已自動將 ${bookObj.name} 第 ${chapter} 章標記為已讀！`);
      }
    }
  });
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
  const bookLabel = document.getElementById("reader-pill-book-label");
  const chapterLabel = document.getElementById("reader-pill-chapter-label");
  if (bookLabel && book) bookLabel.textContent = book.name;
  if (chapterLabel) chapterLabel.textContent = `第 ${state.readerState.chapter} 章`;
}

// Keep a version in memory and store locally
function updateReaderFontSize() {
  document.getElementById("bible-content").style.fontSize = state.readerState.fontSize + "px";
  document.getElementById("font-size-label").textContent = state.readerState.fontSize + "px";
  localStorage.setItem("reader_font_size", state.readerState.fontSize);
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
