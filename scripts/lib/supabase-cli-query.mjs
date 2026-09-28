// 透過 Supabase CLI（Management API）對指定專案跑 SQL，回傳 rows。
// 一律明確指定 --project-ref，不依賴 `supabase link`；不需要資料庫密碼
// （需要先 `npx supabase login`）。見 docs/staging.md。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const PROD_REF = "ztozevcqkfrohgjmngcj";
export const STAGING_REF = "dbtjsljrytzonjvclgrd";

/** 解析 `supabase db query` 的輸出：前面可能有 "Initialising login role..." 之類的訊息。 */
export function parseCliRows(output) {
  const start = output.indexOf("{");
  if (start === -1 || !/"rows"\s*:/.test(output)) {
    throw new Error(`查詢失敗：${output.slice(0, 1500)}`);
  }
  const parsed = JSON.parse(output.slice(start));
  if (!Array.isArray(parsed.rows)) throw new Error(`查詢失敗：${output.slice(0, 1500)}`);
  return parsed.rows;
}

function assertRef(ref) {
  if (!/^[a-z]{20}$/.test(ref)) throw new Error(`不合法的 project ref：${ref}`);
}

/** 執行一個 SQL 檔案。 */
export function runSqlFile(ref, sqlPath) {
  assertRef(ref);
  if (/["\r\n]/.test(sqlPath)) throw new Error(`不支援的路徑：${sqlPath}`);
  // Windows 的 npx 是 .cmd，必須透過 shell；ref 已驗證、路徑加引號
  const command = `npx supabase db query --linked --project-ref ${ref} -f "${sqlPath}"`;
  const result = spawnSync(command, { encoding: "utf8", shell: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`查詢 ${ref} 失敗：\n${`${result.stderr || ""}${result.stdout || ""}`.slice(0, 1500)}`);
  }
  return parseCliRows(result.stdout || "");
}

/** 執行一段 SQL 文字：寫到只有自己能讀的暫存檔，執行完立刻刪除。 */
export function runSql(ref, sql) {
  const dir = mkdtempSync(join(tmpdir(), "supabase-query-"));
  const file = join(dir, "query.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    return runSqlFile(ref, file.replace(/\\/g, "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
