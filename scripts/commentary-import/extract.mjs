#!/usr/bin/env node
// 從 Tyndale Open Study Notes 的 StudyNotes.xml 取出某一卷，寫成 content/commentary/tosn/<英文書名>.json。
// 已經翻好的中文（zh、title）會保留，只更新英文原文與範圍。
//
//   node scripts/commentary-import/extract.mjs <StudyNotes.xml 路徑> <書名，例如 利未記>
//
// StudyNotes.xml 在 https://tyndaleopenresources.com/ 的 tyndale_open-studynotes.zip 裡（CC BY-SA 4.0）。
// 壓縮檔不要放進 repo；只有轉出來的 JSON（含英文原文與譯文）放 content/commentary/tosn/。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { TOSN_ATTRIBUTION, TOSN_BOOK_CODES, mergeTranslations, parseTosnStudyNotes } from "./tosn.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadBibleBooks() {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(root, "js/data/bible_data.js"), "utf8"), context);
  return context.window.BIBLE_BOOKS || context.BIBLE_BOOKS;
}

export function outputPathFor(book) {
  return join(root, "content/commentary/tosn", `${book.eng.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
}

function main() {
  const [xmlPath, bookName] = process.argv.slice(2);
  if (!xmlPath || !bookName) {
    console.error("用法：node scripts/commentary-import/extract.mjs <StudyNotes.xml> <書名>");
    process.exit(1);
  }
  const books = loadBibleBooks();
  const index = books.findIndex(book => book.name === bookName);
  if (index < 0) throw new Error(`找不到書卷：${bookName}`);
  const book = books[index];
  const code = TOSN_BOOK_CODES[index];
  const notes = parseTosnStudyNotes(readFileSync(xmlPath, "utf8"), code);
  const outPath = outputPathFor(book);
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")).notes : [];
  const file = {
    book: book.name,
    tosnCode: code,
    attribution: TOSN_ATTRIBUTION,
    notes: mergeTranslations(notes, existing)
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  const translated = file.notes.filter(note => String(note.zh || "").trim()).length;
  console.log(`${book.name}：${file.notes.length} 則（已翻 ${translated} 則）→ ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
