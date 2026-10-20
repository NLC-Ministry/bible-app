// 從資料庫匯出審好的經文注釋譯文（#542）：匯入後以資料庫為準（審核者會改譯文），repo 裡的
// content/commentary/tosn/ 只是初稿。CC BY-SA 要求衍生作品同樣公開，這份匯出就是公開的版本。
//
//   node scripts/commentary-import/export.mjs <書名> --project-ref <ref> [--all]
//     預設只匯出審核通過（approved）和已發布（published）的；--all 連待審、退回的一起匯出。
//   → content/commentary/reviewed/<英文書名>.json
//
// 透過 Supabase CLI 查詢（需要先 `npx supabase login`），一律明確指定 --project-ref。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, bookSlug, resolveBook } from "./tosn-books.mjs";
import { TOSN_ATTRIBUTION } from "./tosn.mjs";
import { runSql } from "../lib/supabase-cli-query.mjs";

export const REVIEWED_STATUSES = Object.freeze(["approved", "published"]);
export const ALL_STATUSES = Object.freeze(["pending", "returned", "approved", "published"]);

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

// 匯入的列（source_ref = 'TOSN:…'），照經文順序；一列一則 JSON。
export function buildExportSql(book, statuses = REVIEWED_STATUSES) {
  return `SELECT jsonb_build_object(
  'ref', substring(source_ref FROM 6),
  'chapter', chapter,
  'verse_start', verse_start,
  'verse_end', verse_end,
  'chapter_end', chapter_end,
  'chapter_end_verse', chapter_end_verse,
  'title', title,
  'zh', content,
  'review_status', review_status,
  'published_at', published_at,
  'cross_refs', cross_refs,
  'excerpts', excerpts,
  'source_version', source_version,
  'source_hash', source_hash,
  'updated_at', updated_at
) AS note
FROM public.passage_commentary
WHERE book = ${sqlString(book)}
  AND source_ref LIKE 'TOSN:%'
  AND review_status IN (${statuses.map(sqlString).join(", ")})
ORDER BY chapter, verse_start, verse_end, source_ref;`;
}

// CLI 回傳的 rows → 匯出檔。note 欄可能是物件或 JSON 字串（看 CLI 版本）。
export function buildExportFile(book, rows, { statuses = REVIEWED_STATUSES, exportedAt = new Date().toISOString(), projectRef = "" } = {}) {
  const notes = (rows || []).map(row => (typeof row.note === "string" ? JSON.parse(row.note) : row.note)).filter(Boolean);
  return {
    book,
    attribution: TOSN_ATTRIBUTION,
    license: "CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）",
    exportedAt,
    projectRef,
    statuses: [...statuses],
    sourceVersions: Array.from(new Set(notes.map(note => note.source_version).filter(Boolean))),
    notes
  };
}

export function exportPathFor(book) {
  return join(REPO_ROOT, "content/commentary/reviewed", `${bookSlug(book)}.json`);
}

function main() {
  const args = process.argv.slice(2);
  const bookName = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--project-ref");
  const projectRef = args[args.indexOf("--project-ref") + 1];
  if (!bookName || !args.includes("--project-ref") || !projectRef) {
    console.error("用法：node scripts/commentary-import/export.mjs <書名> --project-ref <ref> [--all]");
    process.exit(1);
  }
  const { book } = resolveBook(bookName);
  const statuses = args.includes("--all") ? ALL_STATUSES : REVIEWED_STATUSES;
  const rows = runSql(projectRef, buildExportSql(book.name, statuses));
  const file = buildExportFile(book.name, rows, { statuses, projectRef });
  const outPath = exportPathFor(book);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  console.log(`${book.name}：匯出 ${file.notes.length} 則（${statuses.join("、")}）→ ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
