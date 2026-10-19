// 閱讀器「經文注釋」（#447、#470）：主 App 聖經閱讀器（bible.js）和 /read 讀經頁共用。
// - 整章注釋：工具列的燈泡按鈕，這章有整章注釋才顯示。
// - 節注釋＋詞彙：有內容的節右邊一顆注釋 icon；點選經文後工具列的「注釋」（呼叫端用
//   versesWithCommentary() 決定要不要顯示）。兩個入口都打開同一個底部面板。
// 經文本身不加任何標記（不畫底線），滑動和點節選取不受影響。
// 換章時不擋經文：經文畫完後才在閒置時查索引（多半直接命中 localStorage），
// 索引說這章有內容才抓那一章；詞條解釋等打開面板才抓。

import {
  buildCommentaryBodyHTML,
  buildVerseCommentaryHTML,
  formatVerseRuns,
  indexMayHaveCommentary,
  resolveChapterCommentary
} from "../data/passage-commentary.mjs";

const IDS = Object.freeze({
  button: "reader-commentary-btn",
  backdrop: "reader-commentary-backdrop",
  subtitle: "reader-commentary-subtitle",
  body: "reader-commentary-body",
  close: "reader-commentary-close-btn"
});

export const VERSE_COMMENTARY_BUTTON_CLASS = "verse-commentary-btn";

function defaultSchedule(callback) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1500 });
  } else {
    setTimeout(callback, 250);
  }
}

export function createReaderCommentaryController({
  db,
  openLayer,
  closeLayer,
  escapeHTML,
  hydrateIcons = null,
  getElement = id => document.getElementById(id),
  getVerseContainer = () => getElement("bible-content"),
  schedule = defaultSchedule,
  onChange = () => {},
  // 點譯文裡的出處（「見出27:21」，#542）：{ book, chapter, verse, chapterEnd, verseEnd }。
  // 沒給就不把出處做成按鈕。
  onNavigateRef = null
}) {
  let chapterToken = 0;
  let openToken = 0;
  let current = null; // { book, chapter, label, textByVerse, chapterRow, entries, iconVerses }
  let reopen = null;
  let bound = false;

  function setButtonVisible(visible) {
    const button = getElement(IDS.button);
    if (!button) return;
    button.classList.toggle("hidden", !visible);
    button.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function isOpen() {
    const backdrop = getElement(IDS.backdrop);
    return Boolean(backdrop && !backdrop.classList.contains("hidden"));
  }

  function close() {
    if (!isOpen()) return false;
    openToken += 1;
    closeLayer(getElement(IDS.backdrop));
    return true;
  }

  function clearVerseButtons() {
    const container = getVerseContainer();
    if (!container) return;
    container.querySelectorAll(`.${VERSE_COMMENTARY_BUTTON_CLASS}`).forEach(button => button.remove());
    container.querySelectorAll(".bible-verse.has-commentary").forEach(verse => verse.classList.remove("has-commentary"));
  }

  // 依目前這章的結果放節旁 icon。呼叫端重畫經文後也可以再呼叫一次。
  function decorateVerses() {
    clearVerseButtons();
    const container = getVerseContainer();
    if (!container || !current) return;
    const doc = container.ownerDocument;
    for (const verse of current.iconVerses) {
      const verseDiv = container.querySelector(`.bible-verse[data-verse="${verse}"]`);
      if (!verseDiv) continue;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = VERSE_COMMENTARY_BUTTON_CLASS;
      button.dataset.verseCommentary = String(verse);
      button.title = "經文注釋";
      button.setAttribute("aria-label", `第 ${verse} 節的注釋`);
      button.setAttribute("aria-haspopup", "dialog");
      const icon = doc.createElement("span");
      icon.className = "nlc-icon";
      icon.dataset.icon = "lightbulb";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      verseDiv.classList.add("has-commentary");
      verseDiv.appendChild(button);
      if (typeof hydrateIcons === "function") hydrateIcons(verseDiv);
    }
  }

  // 換章一開始呼叫：馬上藏起按鈕和節旁 icon、關掉面板，避免顯示上一章的注釋。
  function resetForChapter() {
    chapterToken += 1;
    current = null;
    setButtonVisible(false);
    clearVerseButtons();
    close();
  }

  // 經文畫完才呼叫。textByVerse：Map(節 → 經文)，用來比對詞條。
  // 回傳 promise（有沒有任何注釋）方便測試；呼叫端不需要 await。
  function refreshForChapter(book, chapter, label = "", textByVerse = new Map()) {
    const token = ++chapterToken;
    current = null;
    return new Promise(resolve => {
      schedule(async () => {
        let resolved = null;
        try {
          const index = await db.fetchIndex();
          if (token === chapterToken && indexMayHaveCommentary(index, book, chapter)) {
            const data = await db.fetchChapter(book, chapter);
            resolved = resolveChapterCommentary({ rows: data?.rows, terms: data?.terms, chapter, textByVerse });
          }
        } catch (_error) {
          resolved = null;
        }
        if (token !== chapterToken) return resolve(false);
        const hasAny = Boolean(resolved && (resolved.chapterRow || resolved.entries.size));
        current = hasAny ? { book, chapter: Number(chapter), label, textByVerse, ...resolved } : null;
        setButtonVisible(Boolean(current?.chapterRow));
        decorateVerses();
        onChange();
        resolve(hasAny);
      });
    });
  }

  // 傳入的節裡有注釋或詞彙的那幾節（排序過）；給工具列決定要不要顯示「注釋」。
  function versesWithCommentary(verses) {
    if (!current) return [];
    return Array.from(new Set((verses || []).map(Number)))
      .filter(verse => current.entries.has(verse))
      .sort((a, b) => a - b);
  }

  function renderState(body, message, withRetry) {
    body.innerHTML = `
      <div class="reader-commentary-state">
        <p>${escapeHTML(message)}</p>
        ${withRetry ? '<button type="button" class="pill-btn" data-commentary-retry>再試一次</button>' : ""}
      </div>`;
  }

  function showPanel(subtitleText) {
    const backdrop = getElement(IDS.backdrop);
    const body = getElement(IDS.body);
    if (!backdrop || !body) return null;
    const subtitle = getElement(IDS.subtitle);
    if (subtitle) subtitle.textContent = subtitleText;
    body.scrollTop = 0;
    if (!isOpen()) openLayer(backdrop);
    return body;
  }

  // 整章注釋（工具列燈泡）。內容在換章時已經抓好。
  function open() {
    if (!current?.chapterRow) return false;
    openToken += 1;
    reopen = open;
    const body = showPanel(current.label || `${current.book} ${current.chapter} 章`);
    if (!body) return false;
    body.innerHTML = buildCommentaryBodyHTML(current.chapterRow, escapeHTML);
    if (typeof hydrateIcons === "function") hydrateIcons(body);
    return true;
  }

  // 節注釋＋詞彙（節旁 icon、工具列「注釋」）。
  async function openVerses(verses) {
    const target = current;
    const list = versesWithCommentary(verses);
    if (!target || !list.length) return false;
    const token = ++openToken;
    reopen = () => openVerses(list);
    const body = showPanel(`${target.book} ${target.chapter}:${formatVerseRuns(list)}`);
    if (!body) return false;
    body.innerHTML = '<div class="reader-commentary-state" aria-busy="true"><p>注釋載入中…</p></div>';

    const notes = new Map();
    const termMeta = new Map();
    for (const verse of list) {
      const entry = target.entries.get(verse);
      entry.notes.forEach(note => { if (!notes.has(String(note.id))) notes.set(String(note.id), note); });
      entry.terms.forEach(term => { if (!termMeta.has(String(term.id))) termMeta.set(String(term.id), term); });
    }

    let details = new Map();
    if (termMeta.size) {
      try {
        details = await db.fetchTermDetails(Array.from(termMeta.keys()));
      } catch (_error) {
        if (token !== openToken) return false;
        renderState(body, "注釋暫時無法載入，請稍後再試。", true);
        return false;
      }
    }
    if (token !== openToken || target !== current) return false;

    const terms = Array.from(termMeta.values())
      .map(term => ({ ...term, ...(details.get(String(term.id)) || {}) }))
      .filter(term => String(term.definition || "").trim());
    if (!notes.size && !terms.length) {
      renderState(body, "這幾節的注釋已經下架了。", false);
      return false;
    }
    body.innerHTML = buildVerseCommentaryHTML({
      chapter: target.chapter,
      verses: list.map(verse => ({ verse, text: target.textByVerse.get(verse), terms: target.entries.get(verse).terms })),
      notes: Array.from(notes.values()),
      terms,
      linkRefs: typeof onNavigateRef === "function"
    }, escapeHTML);
    if (typeof hydrateIcons === "function") hydrateIcons(body);
    return true;
  }

  function bind() {
    if (bound) return;
    const button = getElement(IDS.button);
    const backdrop = getElement(IDS.backdrop);
    const closeButton = getElement(IDS.close);
    const body = getElement(IDS.body);
    if (!backdrop) return;
    bound = true;
    button?.addEventListener("click", event => {
      event.stopPropagation();
      open();
    });
    closeButton?.addEventListener("click", () => close());
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) close();
    });
    body?.addEventListener("click", event => {
      if (event.target.closest?.("[data-commentary-retry]")) {
        if (typeof reopen === "function") void reopen();
        return;
      }
      const refButton = event.target.closest?.("[data-commentary-ref]");
      if (refButton && typeof onNavigateRef === "function") {
        const data = refButton.dataset;
        const target = {
          book: data.refBook,
          chapter: Number(data.refChapter),
          verse: data.refVerse ? Number(data.refVerse) : null,
          chapterEnd: data.refChapterEnd ? Number(data.refChapterEnd) : null,
          verseEnd: data.refVerseEnd ? Number(data.refVerseEnd) : null
        };
        if (!target.book || !(target.chapter > 0)) return;
        close();
        void onNavigateRef(target);
        return;
      }
      const frame = event.target.closest?.("[data-commentary-zoom]");
      if (!frame) return;
      const zoomed = frame.classList.toggle("is-zoomed");
      frame.setAttribute("aria-pressed", zoomed ? "true" : "false");
    });
    const doc = backdrop.ownerDocument;
    // 節旁 icon：在捕捉階段攔下，經文容器自己的點擊（切換選取這一節）就不會觸發。
    doc?.addEventListener("click", event => {
      const verseButton = event.target.closest?.(`.${VERSE_COMMENTARY_BUTTON_CLASS}[data-verse-commentary]`);
      if (!verseButton || !getVerseContainer()?.contains(verseButton)) return;
      event.preventDefault();
      event.stopPropagation();
      void openVerses([Number(verseButton.dataset.verseCommentary)]);
    }, true);
    doc?.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
    });
  }

  return {
    bind,
    resetForChapter,
    refreshForChapter,
    decorateVerses,
    versesWithCommentary,
    open,
    openVerses,
    close,
    isOpen
  };
}
