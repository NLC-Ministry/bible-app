// TOSN 書卷代碼與 App 的 66 卷（js/data/bible_data.js 的 BIBLE_BOOKS）。匯入工具共用（#471、#542）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// TOSN 的書卷代碼，順序同 BIBLE_BOOKS（創世記 → 啟示錄）。
export const TOSN_BOOK_CODES = Object.freeze([
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "ISam", "IISam", "IKgs", "IIKgs",
  "IChr", "IIChr", "Ezra", "Neh", "Esth", "Job", "Ps", "Pr", "Eccl", "Song", "Isa", "Jer", "Lam",
  "Ezek", "Dan", "Hos", "Joel", "Amos", "Obad", "Jon", "Mic", "Nah", "Hab", "Zeph", "Hagg", "Zech",
  "Mal", "Matt", "Mark", "Luke", "John", "Acts", "Rom", "ICor", "IICor", "Gal", "Eph", "Phil", "Col",
  "IThes", "IIThes", "ITim", "IITim", "Titus", "Phlm", "Heb", "Jas", "IPet", "IIPet", "IJn", "IIJn",
  "IIIJn", "Jude", "Rev"
]);

let cachedBooks = null;

export function loadBibleBooks() {
  if (cachedBooks) return cachedBooks;
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(REPO_ROOT, "js/data/bible_data.js"), "utf8"), context);
  cachedBooks = context.window.BIBLE_BOOKS || context.BIBLE_BOOKS;
  return cachedBooks;
}

export function loadVerseCounts() {
  const source = readFileSync(join(REPO_ROOT, "js/data/bible_verse_counts.js"), "utf8")
    .replace("window.BIBLE_VERSE_COUNTS = BIBLE_VERSE_COUNTS;", "");
  return new Function(`${source}; return BIBLE_VERSE_COUNTS;`)();
}

// 書名（例如 利未記）→ { book, index, code }；找不到就丟錯。
export function resolveBook(bookName) {
  const books = loadBibleBooks();
  const index = books.findIndex(book => book.name === bookName);
  if (index < 0) throw new Error(`找不到書卷：${bookName}`);
  return { book: books[index], index, code: TOSN_BOOK_CODES[index] };
}

export function bookSlug(book) {
  return book.eng.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
