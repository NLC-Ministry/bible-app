// 譯完之後（#542）：把 content/commentary/tosn/<書>.json 每則的出處標籤對齊譯文裡的實際寫法，
// 被解釋的片語填上和合本字句（譯文裡用「」框起來、又出現在那幾節和合本的字句）。只改 cross_refs
// 與 excerpts，不動譯文。已經匯入的書卷，跑完再用 build-sql.mjs --structure 補進資料庫。
//
//   node scripts/commentary-import/align.mjs <書名>

import { fileURLToPath } from "node:url";
import { loadBibleBooks, loadVerseCounts, resolveBook } from "./tosn-books.mjs";
import { readBookFile, writeBookFile } from "./extract.mjs";
import { loadFhlStrongBook, loadLexicon } from "./sources.mjs";
import { readGlossary } from "./prepare.mjs";
import { alignNote, storedExcerpts } from "./tosn.mjs";
import { findRefLabelRanges } from "../../js/data/passage-commentary.mjs";

async function main() {
  const [bookName] = process.argv.slice(2);
  if (!bookName) {
    console.error("用法：node scripts/commentary-import/align.mjs <書名>");
    process.exit(1);
  }
  const { book } = resolveBook(bookName);
  const { path, file } = readBookFile(bookName);
  const cuv = await loadFhlStrongBook(book);
  const deps = {
    cuvVerse: (chapter, verse) => cuv.get(chapter)?.get(verse) || null,
    verseCounts: loadVerseCounts()[book.eng] || [],
    books: loadBibleBooks(),
    book: book.name,
    lexicon: await loadLexicon(),
    glossary: readGlossary()
  };
  file.notes = file.notes.map(note => alignNote(note, deps));
  writeBookFile(path, file);

  const refs = file.notes.flatMap(note => (note.cross_refs || []).map(ref => ({ ref, zh: note.zh || "" })));
  const linked = refs.filter(({ ref, zh }) => findRefLabelRanges(zh, ref.label).length).length;
  const excerpts = file.notes.flatMap(note => note.excerpts || []).length;
  const filled = file.notes.flatMap(note => storedExcerpts(note)).length;
  console.log(`${book.name}：出處在譯文裡找得到 ${linked}/${refs.length}；片語有和合本字句 ${filled}/${excerpts} → ${path}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}
