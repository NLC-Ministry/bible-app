// 經文純文字化的唯一規則。經文來源（Bolls／信望愛／bible-api）偶爾夾 HTML 標籤，
// 顯示、比對、引用前都先過這裡。單次 replace(/<[^>]*>/g, "") 擋不住 `<scr<b>ipt>`
// 這種拼接，所以重複移除到不再變化，最後連殘留的 `<`、`>` 一併拿掉。
// 注意：js/data/bible_data.js 是不能 import 的傳統腳本，內有一份同邏輯的副本，
// scripts/verse-text.test.mjs 的對照測試會確認兩邊輸出一致——改這裡要連那邊一起改。
export function toPlainVerseText(raw) {
  let text = String(raw ?? "");
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text.replace(/[<>]/g, "");
}
