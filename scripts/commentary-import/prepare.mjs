// 產生某一卷的翻譯輸入檔（#542）：.cache/commentary/input/<英文書名>.json（不進版控）。
// 每則附預處理稿、片語、這幾節的和合本＋Strong's 用詞對照、當代譯本經文、原文字對照、用語表條目。
// 先跑 extract.mjs。第一次會從信望愛（按章、限速）、ebible.org、Open Scriptures 下載並快取。
//
//   node scripts/commentary-import/prepare.mjs <書名> [--all] [--write-glossary]
//     --all             連已經翻好的也輸出（預設只輸出還沒翻的）
//     --write-glossary  把拼音對到、用語表還沒有的原文字補進 content/commentary/glossary.json（auto: true）

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, bookSlug, loadVerseCounts, resolveBook } from "./tosn-books.mjs";
import { readBookFile } from "./extract.mjs";
import { CACHE_DIR, loadCcbBook, loadFhlStrongBook, loadLexicon } from "./sources.mjs";
import { buildTranslationInput, glossaryCandidates, serializeGlossary } from "./input.mjs";

export const GLOSSARY_PATH = join(REPO_ROOT, "content/commentary/glossary.json");

export function readGlossary() {
  return existsSync(GLOSSARY_PATH) ? JSON.parse(readFileSync(GLOSSARY_PATH, "utf8")) : { terms: [] };
}

async function main() {
  const args = process.argv.slice(2);
  const bookName = args.find(arg => !arg.startsWith("--"));
  if (!bookName) {
    console.error("用法：node scripts/commentary-import/prepare.mjs <書名> [--all] [--write-glossary]");
    process.exit(1);
  }
  const { book, index } = resolveBook(bookName);
  const { file } = readBookFile(bookName);
  const glossary = readGlossary();
  console.log(`${book.name}：讀取和合本 Strong's（${book.chapters} 章）、當代譯本、Strong's 詞典…`);
  const deps = {
    cuv: await loadFhlStrongBook(book),
    ccb: await loadCcbBook(index),
    lexicon: await loadLexicon(),
    glossary,
    verseCounts: loadVerseCounts()[book.eng] || []
  };
  const input = buildTranslationInput(file, deps, { all: args.includes("--all") });
  const outDir = join(CACHE_DIR, "input");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${bookSlug(book)}.json`);
  writeFileSync(outPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  const matched = input.notes.flatMap(note => note.original_words).filter(word => word.strong).length;
  const words = input.notes.flatMap(note => note.original_words).length;
  console.log(`翻譯輸入檔：${input.notes.length} 則 → ${outPath}（原文字對到編號 ${matched}/${words}）`);

  if (args.includes("--write-glossary")) {
    const candidates = glossaryCandidates(buildTranslationInput(file, deps, { all: true }), glossary, book.name);
    if (candidates.length) {
      glossary.terms = [...(glossary.terms || []), ...candidates];
      writeFileSync(GLOSSARY_PATH, serializeGlossary(glossary), "utf8");
    }
    console.log(`用語表：補了 ${candidates.length} 條原文字對照 → ${GLOSSARY_PATH}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}
