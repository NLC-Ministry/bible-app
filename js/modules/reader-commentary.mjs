// 閱讀器「經文注釋」（#447）：工具列按鈕＋底部面板。
// 只在聖經閱讀器（bible.js）使用；計畫裡的內嵌閱讀器不載入注釋。
// 換章時不擋經文：經文畫完後才在閒置時查「這章有沒有注釋」（多半直接命中
// localStorage 索引），使用者點開面板才抓內容與圖片。

import { buildCommentaryBodyHTML, commentaryChapterKey } from "../data/passage-commentary.mjs";

const IDS = Object.freeze({
  button: "reader-commentary-btn",
  backdrop: "reader-commentary-backdrop",
  subtitle: "reader-commentary-subtitle",
  body: "reader-commentary-body",
  close: "reader-commentary-close-btn"
});

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
  schedule = defaultSchedule
}) {
  let chapterToken = 0;
  let openToken = 0;
  let current = null; // { book, chapter, label }
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

  // 換章一開始呼叫：馬上藏起按鈕、關掉面板，避免顯示上一章的注釋。
  function resetForChapter() {
    chapterToken += 1;
    current = null;
    setButtonVisible(false);
    close();
  }

  // 經文畫完才呼叫。回傳 promise 方便測試；呼叫端不需要 await。
  function refreshForChapter(book, chapter, label = "") {
    const token = ++chapterToken;
    current = null;
    return new Promise(resolve => {
      schedule(async () => {
        let hasCommentary = false;
        try {
          const index = await db.fetchPassageCommentaryIndex();
          hasCommentary = Boolean(index && index.has(commentaryChapterKey(book, chapter)));
        } catch (_error) {
          hasCommentary = false;
        }
        if (token !== chapterToken) return resolve(false);
        current = hasCommentary ? { book, chapter, label } : null;
        setButtonVisible(hasCommentary);
        resolve(hasCommentary);
      });
    });
  }

  function renderState(body, message, withRetry) {
    body.innerHTML = `
      <div class="reader-commentary-state">
        <p>${escapeHTML(message)}</p>
        ${withRetry ? '<button type="button" class="pill-btn" data-commentary-retry>再試一次</button>' : ""}
      </div>`;
  }

  async function open() {
    if (!current) return false;
    const target = current;
    const token = ++openToken;
    const backdrop = getElement(IDS.backdrop);
    const body = getElement(IDS.body);
    const subtitle = getElement(IDS.subtitle);
    if (!backdrop || !body) return false;
    if (subtitle) subtitle.textContent = target.label || `${target.book} ${target.chapter} 章`;
    body.innerHTML = '<div class="reader-commentary-state" aria-busy="true"><p>注釋載入中…</p></div>';
    body.scrollTop = 0;
    openLayer(backdrop);

    let row;
    try {
      row = await db.fetchPassageCommentary(target.book, target.chapter);
    } catch (_error) {
      if (token !== openToken) return false;
      renderState(body, "注釋暫時無法載入，請稍後再試。", true);
      return false;
    }
    if (token !== openToken) return false;
    if (!row) {
      renderState(body, "這一章的注釋已經下架了。", false);
      return false;
    }
    body.innerHTML = buildCommentaryBodyHTML(row, escapeHTML);
    if (typeof hydrateIcons === "function") hydrateIcons(body);
    return true;
  }

  function bind() {
    if (bound) return;
    const button = getElement(IDS.button);
    const backdrop = getElement(IDS.backdrop);
    const closeButton = getElement(IDS.close);
    const body = getElement(IDS.body);
    if (!button || !backdrop) return;
    bound = true;
    button.addEventListener("click", event => {
      event.stopPropagation();
      void open();
    });
    closeButton?.addEventListener("click", () => close());
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) close();
    });
    body?.addEventListener("click", event => {
      if (event.target.closest?.("[data-commentary-retry]")) {
        void open();
        return;
      }
      const frame = event.target.closest?.("[data-commentary-zoom]");
      if (!frame) return;
      const zoomed = frame.classList.toggle("is-zoomed");
      frame.setAttribute("aria-pressed", zoomed ? "true" : "false");
    });
    backdrop.ownerDocument?.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
    });
  }

  return { bind, resetForChapter, refreshForChapter, open, close, isOpen };
}
