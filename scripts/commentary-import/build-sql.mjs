// 把翻好的 content/commentary/tosn/<書>.json 轉成匯入 SQL（待審、未發布）。還有沒翻的就停下來。
//
//   node scripts/commentary-import/build-sql.mjs content/commentary/tosn/leviticus.json > 匯入.sql
//   node scripts/commentary-import/build-sql.mjs content/commentary/tosn/leviticus.json --structure > 補結構.sql
//   npx supabase db query --linked --project-ref <ref> -f 匯入.sql
//
// 先匯入 staging 確認，再匯入正式站。重跑安全：source_ref 已存在的會略過。
// --structure：已經匯入的書卷補上 #542 的新欄位（結束章、交叉引用、片語、來源版本、指紋），
// 不動譯文、標題與審核狀態。先跑 align.mjs。
// 匯入後到後台「經文注釋」指派這一卷的審核者（審核者會收到通知）。流程見 docs/commentary-import.md。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildImportSql, buildStructureUpdateSql } from "./tosn.mjs";

function main() {
  const args = process.argv.slice(2);
  const jsonPath = args.find(arg => !arg.startsWith("--"));
  if (!jsonPath) {
    console.error("用法：node scripts/commentary-import/build-sql.mjs <content/commentary/tosn/書.json> [--structure]");
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(jsonPath, "utf8"));
  process.stdout.write(args.includes("--structure") ? buildStructureUpdateSql(file) : buildImportSql(file));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
