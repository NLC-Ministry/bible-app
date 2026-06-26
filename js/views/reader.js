// Bible Reader tab view controller

function initReaderControls() {
  const bookSelect = document.getElementById("reader-book-select");
  const chapterSelect = document.getElementById("reader-chapter-select");
  const testamentSelect = document.getElementById("reader-testament-select");

  // Load books list
  populateBookSelector("all");
  populateChapterSelector();

  testamentSelect.addEventListener("change", (e) => {
    populateBookSelector(e.target.value);
    populateChapterSelector();
  });

  bookSelect.addEventListener("change", () => {
    populateChapterSelector();
    saveReaderPreferences();
    renderReaderText();
  });

  chapterSelect.addEventListener("change", () => {
    state.readerState.chapter = parseInt(chapterSelect.value);
    saveReaderPreferences();
    renderReaderText();
  });

  // Font adjustments
  document.getElementById("increase-font").addEventListener("click", () => {
    if (state.readerState.fontSize < 36) {
      state.readerState.fontSize += 2;
      updateReaderFontSize();
    }
  });

  document.getElementById("decrease-font").addEventListener("click", () => {
    if (state.readerState.fontSize > 12) {
      state.readerState.fontSize -= 2;
      updateReaderFontSize();
    }
  });

  // Prev / Next Chapter Buttons
  document.getElementById("prev-chapter-btn").addEventListener("click", () => {
    navigateToChapter(-1);
  });

  document.getElementById("next-chapter-btn").addEventListener("click", () => {
    navigateToChapter(1);
  });

  // Mark chapter read checkbox
  const markReadBtn = document.getElementById("mark-read-btn");
  markReadBtn.addEventListener("click", async () => {
    const isChecked = !markReadBtn.classList.contains("checked");
    const bookObj = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
    
    loader.show(isChecked ? "標記已讀中..." : "取消標記中...");
    await db.logChapterRead(bookObj.name, state.readerState.chapter, isChecked);
    
    if (isChecked) {
      markReadBtn.classList.add("checked");
    } else {
      markReadBtn.classList.remove("checked");
    }
    
    // Auto update reading plan progress checkbox if exists
    if (state.activePlan) {
      const planDayChKey = `${bookObj.name}_${state.readerState.chapter}`;
      updatePlanCheckboxState(planDayChKey, isChecked);
    }
    loader.hide();
  });
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
  const heading = document.getElementById("bible-title");
  const markReadBtn = document.getElementById("mark-read-btn");
  
  const book = BIBLE_BOOKS.find(b => b.id === state.readerState.bookId);
  const chapter = state.readerState.chapter;

  heading.textContent = `${book.name} ${chapter}章`;
  container.innerHTML = `<div class="loader-inline">讀取經文中...</div>`;
  
  // Set checked button status
  const isRead = state.readingLogs.some(l => l.book === book.name && l.chapter === chapter);
  if (isRead) {
    markReadBtn.classList.add("checked");
  } else {
    markReadBtn.classList.remove("checked");
  }

  // Load Bible text
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
