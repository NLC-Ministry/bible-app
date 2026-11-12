// 把 align.py 每章一個的輸出打包成 App 用的時間表：assets/audio-timing/<書卷編號>.json（#637）。
// 格式見 js/modules/reader-audio-timing.mjs。只留節數和開始秒數，對齊分數與診斷資料不進 App。
//
// 用法：node scripts/human-audio-timing/pack.mjs <align 輸出資料夾> [assets/audio-timing]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIO_TIMING_FORMAT_VERSION, normalizeChapterTimings } from "../../js/modules/reader-audio-timing.mjs";

// 每章輸出 → { [書卷]: { v, book, chapters: { [章]: [[節, 秒], ...] } } }。
// 一章的資料不合格式（節重複、秒數倒退）就整章不放，App 那章退回整章播放。
// 沒對到的節（信望愛和合本把它併進前一節，經文是 "a"，例如民 1:20–21 合成一段念）用前一節的秒數，
// App 看到同一個秒數就當成「第 20–21 節」一起標示，共幾節也不會少算。
export function packTimings(chapterDocs) {
  const books = new Map();
  const skipped = [];
  for (const doc of chapterDocs) {
    const rows = [];
    for (const [verse, start] of doc.verses || []) {
      if (start != null) rows.push([Number(verse), Math.round(Number(start) * 100) / 100]);
      else if (rows.length) rows.push([Number(verse), rows[rows.length - 1][1]]);
    }
    if (!normalizeChapterTimings(rows)) {
      skipped.push(`${doc.book}:${doc.chapter}`);
      continue;
    }
    const book = books.get(doc.book) || { v: AUDIO_TIMING_FORMAT_VERSION, book: doc.book, chapters: {} };
    book.chapters[String(doc.chapter)] = rows;
    books.set(doc.book, book);
  }
  return { books, skipped };
}

function main([inputDir, outputDir = "assets/audio-timing"]) {
  if (!inputDir) {
    console.error("用法：node scripts/human-audio-timing/pack.mjs <align 輸出資料夾> [assets/audio-timing]");
    return 1;
  }
  const docs = readdirSync(inputDir)
    .filter(name => /^\d+_\d+\.json$/.test(name))
    .map(name => JSON.parse(readFileSync(join(inputDir, name), "utf8")));
  const { books, skipped } = packTimings(docs);
  mkdirSync(outputDir, { recursive: true });
  let chapters = 0;
  for (const [bookId, data] of [...books].sort((a, b) => a[0] - b[0])) {
    // 章依數字排序，diff 才好讀。
    const ordered = Object.fromEntries(Object.entries(data.chapters).sort((a, b) => Number(a[0]) - Number(b[0])));
    chapters += Object.keys(ordered).length;
    writeFileSync(join(outputDir, `${bookId}.json`), `${JSON.stringify({ ...data, chapters: ordered })}\n`);
  }
  console.log(`打包 ${books.size} 卷、${chapters} 章到 ${outputDir}`);
  if (skipped.length) console.warn(`格式不對沒放進去：${skipped.join(", ")}`);
  return 0;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
