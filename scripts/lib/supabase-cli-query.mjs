// 透過 Supabase CLI（Management API）對指定專案跑 SQL，回傳 rows。
// 一律明確指定 --remote=<ref>，不依賴 `supabase link`；不需要資料庫密碼
// （需要先 `npx supabase login`）。見 docs/staging.md。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadProjectRefs } from "./project-refs.mjs";

// 釘住 CLI 版本：沒釘的話 `npx supabase` 會自己升級，3.0.0 就是這樣讓環境檢查腳本全部失敗（#680）。
// 要升級就改這裡，先讀過 release notes，再用 staging 跑一次 check-env-drift 和 security-advisor。
export const SUPABASE_CLI = "supabase@3.0.0";

// ref 來自環境變數／.env，不寫進 repo（#609）；沒設定時是空字串，真的要連線前由 assertRef 擋下。
const REFS = loadProjectRefs();
export const PROD_REF = REFS.production;
export const STAGING_REF = REFS.staging;

/** CLI 的輸出常帶 ref（例如 "Target: project <ref>"），錯誤訊息可能被貼到公開的 issue，先遮掉。 */
function maskRef(text, ref) {
  return ref ? String(text).split(ref).join("<ref>") : String(text);
}

/**
 * 解析 `supabase db query --output-format json` 的輸出，前面可能有 "Initialising login role..." 之類的訊息。
 * CLI 3.0.0 在人手動跑時輸出純陣列 `[...]`，在 AI agent 裡輸出 `{ "rows": [...] }`（#717），兩種都收。
 */
export function parseCliRows(output, { ref } = {}) {
  const text = String(output || "");
  const start = text.search(/^[[{]/m);
  let parsed;
  if (start !== -1) {
    try { parsed = JSON.parse(text.slice(start)); } catch { parsed = undefined; }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error(
    "查詢失敗：Supabase CLI 的輸出不是預期的 JSON，可能是輸出格式不對（例如表格），"
    + "請確認指令有帶 --output-format json。輸出開頭：\n"
    + maskRef(text, ref).slice(0, 300)
  );
}

function assertRef(ref) {
  if (!/^[a-z0-9]{20}$/.test(String(ref || ""))) throw new Error("沒有可用的 project ref（SUPABASE_PRODUCTION_REF／SUPABASE_STAGING_REF 沒設定或格式不對，見 docs/staging.md）");
}

/** 指定專案的旗標；ref 不對就擋下。 */
export function remoteFlag(ref) {
  assertRef(ref);
  return `--remote=${ref}`;
}

/** 組出要交給 shell 的 CLI 指令（Windows 的 npx 是 .cmd，必須透過 shell）。 */
export function supabaseCommand(args) {
  return ["npx", SUPABASE_CLI, ...args].join(" ");
}

/**
 * `db query` 的指令。預設 --read-only：只接受 SELECT 這類語句，代理程式模式下也不用使用者同意。
 * write 才帶 --yes，代表使用者已經同意這次寫入（CLI 的要求，見 runSqlWrite）。
 * 一律帶 --output-format json：不帶的話 CLI 只在偵測到 AI agent 時輸出 JSON，人手動跑會輸出表格（#717）。
 * 不要改用 --agent 來切換格式：那會改變 CLI 的安全行為判斷。
 */
export function buildQueryCommand(ref, sqlPath, { write = false } = {}) {
  if (/["\r\n]/.test(sqlPath)) throw new Error(`不支援的路徑：${sqlPath}`);
  return supabaseCommand(["db", "query", remoteFlag(ref), write ? "--yes" : "--read-only", "--output-format", "json", "-f", `"${sqlPath}"`]);
}

function execSqlFile(ref, sqlPath, options) {
  const command = buildQueryCommand(ref, sqlPath, options);
  const result = spawnSync(command, { encoding: "utf8", shell: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    const output = maskRef(`${result.stderr || ""}${result.stdout || ""}`, ref);
    throw new Error(`查詢失敗：\n${output.slice(0, 1500)}`);
  }
  return parseCliRows(result.stdout || "", { ref });
}

function withTempSqlFile(sql, callback) {
  const dir = mkdtempSync(join(tmpdir(), "supabase-query-"));
  const file = join(dir, "query.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    return callback(file.replace(/\\/g, "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 唯讀執行一個 SQL 檔案。 */
export function runSqlFile(ref, sqlPath) {
  return execSqlFile(ref, sqlPath);
}

/** 唯讀執行一段 SQL 文字：寫到只有自己能讀的暫存檔，執行完立刻刪除。 */
export function runSql(ref, sql) {
  return withTempSqlFile(sql, file => execSqlFile(ref, file));
}

/**
 * 寫入 staging。呼叫端要先確認使用者同意了這次執行（CLI 要求逐次同意，#680），不要當預設。
 * 腳本不寫正式站：要動正式站走 migration。
 */
export function runSqlWrite(ref, sql) {
  if (ref === PROD_REF) throw new Error("runSqlWrite 不寫正式站");
  return withTempSqlFile(sql, file => execSqlFile(ref, file, { write: true }));
}
