import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { formatVerseSelectionText, groupVerseSelectionRuns } from "../js/modules/verse-selection-format.mjs";

const bible = readFileSync("js/modules/bible.js", "utf8");
const sharedFormat = readFileSync("js/modules/verse-selection-format.mjs", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

// 2026-09-08：合併「單節 / 長按複選」兩套模式 → 一律「點一下切換選取」，
// 選取集合跨章保留，工具列上方一條 chip 列，✕ 一鍵全清。

describe("reader verse selection — 統一點選多節模型", () => {
  it("移除長按複選：不再有 longPress / multiSelectState / 兩套模式函式", () => {
    expect(bible).not.toContain("longPressTimer");
    expect(bible).not.toContain("MULTI_SELECT_LONG_PRESS_MS");
    expect(bible).not.toContain("multiSelectState");
    expect(bible).not.toContain("function startMultiSelection");
    expect(bible).not.toContain("function openMultiSelectBottomBar");
    expect(bible).not.toContain("function openIntegratedSelectionBottomBar");
    expect(bible).not.toContain("function setReaderStartSelection");
    // 也不再監聽 touchstart/mousedown 之類做長按判定
    expect(bible).not.toContain('verseDiv.addEventListener("touchstart"');
  });

  it("點一下 = 切換該節在選取集合裡的有無（跨章保留）", () => {
    expect(bible).toContain("const verseSelection = new Map();");
    expect(bible).toContain("function verseSelKey(bookId, chapter, verse)");
    expect(bible).toContain("function toggleVerseSelection(entry)");
    // #347：改成容器上的事件委派（不再每節各掛監聽），點到哪一節就切換哪一節
    const events = bible.slice(bible.indexOf("function bindReaderContentEvents("), bible.indexOf("function renderVersesList("));
    expect(events).toContain("toggleVerseSelection({ bookId, bookName, chapter, verse, text: textByVerse.get(verse) })");
    expect(events).toContain('container.addEventListener("click"');
    expect(events).toContain('event.target.closest?.(".bible-verse[data-verse]")');
    const rvl = bible.slice(bible.indexOf("function renderVersesList("), bible.indexOf("function loadVerseNotesForChapter"));
    expect(rvl).toContain("bindReaderContentEvents(container);");
    expect(rvl).not.toContain("verseDiv.addEventListener");
    // 換章後把仍在集合裡、屬於本章的節重新標記
    expect(rvl).toContain("applySelectionClassesToDom();");
  });

  it("選取集合不進 state.js（Map 不能序列化），且換章不清空", () => {
    // renderReaderText 只拆舊工具列 DOM，不動 verseSelection
    expect(bible).toContain('closeSelectionBottomBar({ clearSelection: false });');
    expect(bible).toContain("refreshVerseSelectionUI();   // 跨章");
    expect(bible).not.toContain("state.readerState.selectedVerses");
  });

  it("chip 列：連續節合併成一顆（25:23-28），一顆 ✕ 移除整段；動作列 ✕ 一鍵全清", () => {
    const bar = bible.slice(bible.indexOf("function renderUnifiedSelectionBar()"), bible.indexOf("function closeVerseNoteEditor"));
    expect(bar).toContain('class="yv-selection-strip"');
    // 連續節合併：相鄰號碼併進同一個 run，chip 上帶該段所有 key（規則與 /read 共用，#423）
    expect(bar).toContain("groupVerseSelectionRuns(sorted, v => verseSelKey(v.bookId, v.chapter, v.verse))");
    expect(sharedFormat).toContain("v.verse === last.endVerse + 1");
    expect(bar).toContain("r.startVerse === r.endVerse ? `${r.startVerse}` : `${r.startVerse}-${r.endVerse}`");
    expect(bar).toContain('data-remove-keys="${escapeHTML(r.keys.join(","))}"');
    expect(bar).toContain('removeVersesFromSelection(chip.getAttribute("data-remove-keys"))');
    expect(bible).toContain("function removeVersesFromSelection(keys)");
    expect(bar).toContain('data-action="clear-all"');
    expect(bar).toContain("clearAllVerseSelection()");
    expect(bar).toContain('aria-label="全部取消"');
    // 跨章時 chip 用「縮寫書名 + 不留空格」（出25:30），同章省略書名；aria-label 仍是完整書名
    expect(bar).toContain("BIBLE_BOOKS.find(b => b.id === r.bookId)?.abbrev");
    expect(bar).toContain("crossChapter ? `${abbrev}${r.chapter}:${vpart}` : `${r.chapter}:${vpart}`");
    expect(bar).toContain('aria-label="移除 ${escapeHTML(r.bookName)} ${r.chapter}:${vpart}"');
  });

  it("複製文字用完整書名，chip 才用縮寫（分開的兩套）", () => {
    // 格式邏輯和 /read 共用（#423），bible.js 只轉呼叫。
    const fmt = bible.slice(bible.indexOf("function formatSelectionText()"), bible.indexOf("function copySelectionText"));
    expect(fmt).toContain("return formatVerseSelectionText(getSelectedVersesSorted());");
    expect(sharedFormat).toContain("`【${g.bookName} ${g.chapter}:${nums}】");
    expect(sharedFormat).not.toContain("abbrev");
  });

  it("點經文區外面不關閉工具列、不清選取（只收合色盤）", () => {
    const bar = bible.slice(bible.indexOf("function renderUnifiedSelectionBar()"), bible.indexOf("function closeVerseNoteEditor"));
    // onDocClick 只在色盤開著時收合色盤，barDiv 以外不做別的事
    expect(bar).toMatch(/const onDocClick = e => \{\s*if \(barDiv\.contains\(e\.target\)\) return;\s*if \(highlightPalette && !highlightPalette\.classList\.contains\("hidden"\)\) setHighlightPaletteOpen\(false\);\s*\};/);
    expect(bar).not.toContain("closeSelectionBottomBar()"); // 不會因點外面而關
  });

  it("螢光筆一色套用到所有選取節；筆記僅單節可用", () => {
    expect(bible).toContain("function applyHighlightToSelection(color)");
    expect(bible).toContain("已為 ${entries.length} 節加上標註");
    expect(bible).toContain("已清除 ${entries.length} 節的標註");
    const bar = bible.slice(bible.indexOf("function renderUnifiedSelectionBar()"), bible.indexOf("function closeVerseNoteEditor"));
    // note 按鈕在 !single 時 disabled
    expect(bar).toContain('data-action="note"${single ? "" : \' disabled aria-disabled="true"\'}');
    expect(bar).toContain("if (!single) return;");
  });

  it("複製/分享：同章連續節壓成 a-b、非連續用逗號；不同章/卷各自一個【參照】標題段", () => {
    expect(bible).toContain("function formatSelectionText()");
    // 每段 = 【書 章:節】 + 換行 + 該段經文；段與段用換行相接（不是把所有參照塞進同一個【】）
    const text = formatVerseSelectionText([
      { bookId: 43, bookName: "約翰福音", chapter: 3, verse: 16, text: "甲" },
      { bookId: 43, bookName: "約翰福音", chapter: 3, verse: 17, text: "乙" },
      { bookId: 43, bookName: "約翰福音", chapter: 3, verse: 19, text: "丙" },
      { bookId: 45, bookName: "羅馬書", chapter: 8, verse: 28, text: "丁" }
    ]);
    expect(text).toBe("【約翰福音 3:16-17,19】\n16 甲\n17 乙\n19 丙\n【羅馬書 8:28】\n28 丁");
    expect(sharedFormat).not.toContain('.join("；")');
  });

  it("選取 chip：同卷同章連續節合併成一顆，keys 帶齊整段", () => {
    const runs = groupVerseSelectionRuns([
      { bookId: 1, bookName: "創世記", chapter: 1, verse: 1 },
      { bookId: 1, bookName: "創世記", chapter: 1, verse: 2 },
      { bookId: 1, bookName: "創世記", chapter: 2, verse: 3 }
    ], v => `${v.bookId}_${v.chapter}_${v.verse}`);
    expect(runs.map(r => [r.chapter, r.startVerse, r.endVerse, r.keys.length])).toEqual([[1, 1, 2, 2], [2, 3, 3, 1]]);
  });

  it("朗讀起點：恰好一節且在本章 → 那一節；0/2+/在別章 → null（從第 1 節）", () => {
    expect(bible).toContain("function syncReaderStartVerse()");
    expect(bible).toMatch(/state\.readerState\.selectedVerseNum =\s*\(sorted\.length === 1 && sorted\[0\]\.bookId === currentReaderBookId\(\) && sorted\[0\]\.chapter === currentReaderChapter\(\)\)\s*\? sorted\[0\]\.verse : null;/);
    // TTS 讀取點不變
    expect(bible).toContain("const selectedVerseNum = startVerseNum ?? state.readerState?.selectedVerseNum ?? null;");
  });

  it("does not let collapsed browser text-selection events hide the bar", () => {
    expect(bible).not.toContain("selectionchange");
  });
});

describe("selection bar CSS", () => {
  it("被選取的節有 .verse-selected 底色（沿用 .multi-selected 視覺）", () => {
    expect(css).toMatch(/#reader-view \.bible-verse\.multi-selected,\s*#reader-view \.bible-verse\.verse-selected \{/);
  });

  it("chip 列橫向可捲動、chip 為圓角 pill、disabled tile 變灰", () => {
    expect(css).toMatch(/\.youversion-action-bar \.yv-selection-strip \{[\s\S]*overflow-x: auto;[\s\S]*scrollbar-width: none;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-selection-strip::-webkit-scrollbar \{[\s\S]*display: none;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-chip \{[\s\S]*border-radius: 999px;/);
    expect(css).toMatch(/\.youversion-action-bar \.yv-tile\[disabled\],\s*\.youversion-action-bar \.yv-tile\[aria-disabled="true"\] \{[\s\S]*opacity: 0\.4;/);
  });

  it("工具列仍貼齊螢幕底部（rounded-top sheet）", () => {
    const base = css.match(/\.youversion-action-bar \{([\s\S]*?)\}/)?.[1] || "";
    expect(base).toMatch(/bottom:\s*0;/);
    expect(base).toContain("border-radius: 1rem 1rem 0 0;");
    expect(base).toContain("box-shadow: 0 -8px 30px");
  });
});
