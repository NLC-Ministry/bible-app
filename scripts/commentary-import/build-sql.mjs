// 把翻好的 content/commentary/tosn/<書>.json 轉成匯入 SQL（待審、未發布）。還有沒翻的就停下來。
//
//   node scripts/commentary-import/build-sql.mjs content/commentary/tosn/leviticus.json > 匯入.sql
//   npx supabase db query --linked --project-ref <ref> -f 匯入.sql
//
// 先匯入 staging 確認，再匯入正式站。重跑安全：source_ref 已存在的會略過。
// 匯入後到後台「經文注釋」指派這一卷的審核者（審核者會收到通知）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildImportSql } from "./tosn.mjs";

function main() {
  const [jsonPath] = process.argv.slice(2);
  if (!jsonPath) {
    console.error("用法：node scripts/commentary-import/build-sql.mjs <content/commentary/tosn/書.json>");
    process.exit(1);
  }
  process.stdout.write(buildImportSql(JSON.parse(readFileSync(jsonPath, "utf8"))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
