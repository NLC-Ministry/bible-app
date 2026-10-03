// 選取經文的複製／分享格式與選取標籤合併規則（#423）：主 App 讀經頁（bible.js）和
// 快速啟動的讀經頁 /read 共用，兩邊複製出來的文字一模一樣。
//
// sorted：已依「書卷順序 → 章 → 節」排好的 [{ bookId, bookName, chapter, verse, text }]。

// 複製／分享文字：依「書→章」分段；同章連續節壓成 a-b、非連續用逗號。
// 不同章或不同卷 → 每段自己一個【參照】標題 + 該段經文，段與段直接換行相接。
export function formatVerseSelectionText(sorted) {
  if (!Array.isArray(sorted) || sorted.length === 0) return "";
  const groups = [];
  sorted.forEach(v => {
    const g = groups[groups.length - 1];
    if (g && g.bookName === v.bookName && g.chapter === v.chapter) g.verses.push(v);
    else groups.push({ bookName: v.bookName, chapter: v.chapter, verses: [v] });
  });
  return groups.map(g => {
    const runs = [];
    g.verses.forEach(v => {
      const last = runs[runs.length - 1];
      if (last && v.verse === last.end + 1) last.end = v.verse;
      else runs.push({ start: v.verse, end: v.verse });
    });
    const nums = runs.map(r => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
    const body = g.verses.map(v => `${v.verse} ${v.text}`).join("\n");
    return `【${g.bookName} ${g.chapter}:${nums}】\n${body}`;
  }).join("\n");
}

// 選取工具列的標籤：連續節（同卷同章、號碼相鄰）合併成一顆，例如 25:23-28；一顆 ✕ 移除整段。
export function groupVerseSelectionRuns(sorted, keyOf) {
  const runs = [];
  (Array.isArray(sorted) ? sorted : []).forEach(v => {
    const last = runs[runs.length - 1];
    if (last && last.bookId === v.bookId && last.chapter === v.chapter && v.verse === last.endVerse + 1) {
      last.endVerse = v.verse;
      last.keys.push(keyOf(v));
    } else {
      runs.push({
        bookId: v.bookId, bookName: v.bookName, chapter: v.chapter,
        startVerse: v.verse, endVerse: v.verse,
        keys: [keyOf(v)]
      });
    }
  });
  return runs;
}
