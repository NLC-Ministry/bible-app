// 從 Tyndale Open Study Notes 的 StudyNotes.xml 取出某一卷，寫成 content/commentary/tosn/<英文書名>.json。
// 已經翻好的中文（zh、title、片語的中文）會保留，只更新英文原文、預處理稿、交叉引用、片語與指紋；
// 原文指紋變了的那幾則會清空譯文等重翻（舊譯文留在 zh_previous）。流程見 docs/commentary-import.md。
//
//   node scripts/commentary-import/extract.mjs <StudyNotes.xml 路徑> <書名，例如 利未記>
//
// StudyNotes.xml 在 https://tyndaleopenresources.com/ 的 tyndale_open-studynotes.zip 裡（CC BY-SA 4.0）。
// 壓縮檔不要放進 repo；只有轉出來的 JSON（含英文原文與譯文）放 content/commentary/tosn/。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, bookSlug, loadBibleBooks, resolveBook } from "./tosn-books.mjs";
import { TOSN_ATTRIBUTION, mergeTranslations, parseTosnStudyNotes, tosnReleaseOf } from "./tosn.mjs";

export { loadBibleBooks };

export function outputPathFor(book) {
  return join(REPO_ROOT, "content/commentary/tosn", `${bookSlug(book)}.json`);
}

export function readBookFile(bookName) {
  const { book } = resolveBook(bookName);
  const path = outputPathFor(book);
  if (!existsSync(path)) throw new Error(`還沒有 ${path}，先跑 extract.mjs`);
  return { path, file: JSON.parse(readFileSync(path, "utf8")) };
}

export function writeBookFile(path, file) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function main() {
  const [xmlPath, bookName] = process.argv.slice(2);
  if (!xmlPath || !bookName) {
    console.error("用法：node scripts/commentary-import/extract.mjs <StudyNotes.xml> <書名>");
    process.exit(1);
  }
  const { book, code } = resolveBook(bookName);
  const xml = readFileSync(xmlPath, "utf8");
  const notes = parseTosnStudyNotes(xml, code);
  const outPath = outputPathFor(book);
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")).notes : [];
  const file = {
    book: book.name,
    tosnCode: code,
    sourceVersion: tosnReleaseOf(xml),
    attribution: TOSN_ATTRIBUTION,
    notes: mergeTranslations(notes, existing)
  };
  writeBookFile(outPath, file);
  const translated = file.notes.filter(note => String(note.zh || "").trim()).length;
  const changed = file.notes.filter(note => note.zh_previous && !String(note.zh || "").trim()).length;
  console.log(`${book.name}：${file.notes.length} 則（已翻 ${translated} 則${changed ? `，原文有變動待重翻 ${changed} 則` : ""}）→ ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
