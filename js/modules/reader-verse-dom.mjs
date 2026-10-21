// 讀經畫面的 DOM 小零件（#423）：主 App 讀經頁（bible.js）和 /read 讀經頁共用，
// 兩邊的經文、章末連結是同一份 HTML、同一套 CSS。

import { resolveAdjacentChapter } from "./reader-chapter-nav.mjs";

// 一節經文：<div class="bible-verse" data-verse> <span class="verse-num"> <span class="verse-text">。
// 點一下＝切換這一節的選取（事件由呼叫端在容器上委派）。
// 經文一律以純文字（textContent）放入，不經 innerHTML：來源就算被汙染也不會變成標籤。
export function createVerseElement(doc, verse, { highlightColor = "" } = {}) {
  const verseDiv = doc.createElement("div");
  verseDiv.className = "bible-verse";
  verseDiv.dataset.verse = String(verse.verse);
  verseDiv.id = `reader-verse-${verse.verse}`;
  verseDiv.tabIndex = 0;
  verseDiv.setAttribute("role", "button");
  verseDiv.setAttribute("aria-pressed", "false");
  verseDiv.setAttribute("aria-label", `第 ${verse.verse} 節，點一下選取或取消選取`);

  if (highlightColor) {
    verseDiv.style.setProperty("--verse-highlight-color", highlightColor);
    verseDiv.setAttribute("data-highlight", highlightColor);
  }

  const num = doc.createElement("span");
  num.className = "verse-num";
  num.textContent = String(verse.verse);
  const text = doc.createElement("span");
  text.className = "verse-text";
  text.textContent = String(verse.text ?? "");
  verseDiv.append(num, text);
  return verseDiv;
}

// 目錄選好某一節、輸入出處跳轉後：捲到那一節（置中），並讓要求的節閃一下底色（#362 範圍／頓號）。
export function revealVerses(container, verse, highlightVerses = null, { schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  if (!container || !verse) return;
  const flashVerses = new Set(Array.isArray(highlightVerses) && highlightVerses.length ? highlightVerses : [verse]);
  schedule(() => {
    const verses = container.querySelectorAll(".bible-verse");
    for (const v of verses) {
      const numEl = v.querySelector(".verse-num");
      const verseNum = v.dataset.verse ? parseInt(v.dataset.verse, 10) : (numEl ? parseInt(numEl.textContent, 10) : NaN);
      if (!flashVerses.has(verseNum)) continue;
      if (verseNum === verse && typeof v.scrollIntoView === "function") v.scrollIntoView({ behavior: "smooth", block: "center" });
      const oldBg = v.style.backgroundColor;
      v.style.backgroundColor = "var(--color-brand-subtle, rgba(4,169,210,0.22))";
      schedule(() => {
        v.style.backgroundColor = oldBg;
      }, 1500);
    }
  }, 100);
}

// 章末換章連結（#347）：「‹ 上一章｜下一章 ›」，跟在經文後面、不浮動。
// 沒有上一章（創 1）或下一章（啟 22）的那一側不顯示。按鈕帶 data-chapter-nav=±1，由呼叫端委派處理。
export function buildChapterEndNav({ doc, books, bookId, chapter, copy = {}, hydrateIcons = null }) {
  const hasPrev = Boolean(resolveAdjacentChapter(books, bookId, chapter, -1));
  const hasNext = Boolean(resolveAdjacentChapter(books, bookId, chapter, 1));
  const nav = doc.createElement("nav");
  nav.className = "reader-chapter-end-nav";
  nav.setAttribute("aria-label", copy.chapterNavLabel || "換章");

  const makeIcon = name => {
    const icon = doc.createElement("span");
    icon.className = "nlc-icon nlc-icon--sm";
    icon.dataset.icon = name;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  };
  const makeLink = (direction, label, available) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "reader-chapter-end-link";
    button.dataset.chapterNav = String(direction);
    button.hidden = !available;
    const text = doc.createElement("span");
    text.textContent = label;
    if (direction < 0) button.append(makeIcon("chevronLeft"), text);
    else button.append(text, makeIcon("chevronRight"));
    return button;
  };
  const separator = doc.createElement("span");
  separator.className = "reader-chapter-end-sep";
  separator.setAttribute("aria-hidden", "true");
  separator.textContent = "｜";
  separator.hidden = !(hasPrev && hasNext);

  nav.append(
    makeLink(-1, copy.prevChapter || "上一章", hasPrev),
    separator,
    makeLink(1, copy.nextChapter || "下一章", hasNext)
  );
  if (typeof hydrateIcons === "function") hydrateIcons(nav);
  return nav;
}
