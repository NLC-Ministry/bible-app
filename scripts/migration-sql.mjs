// 測試用：讀 migration 的 SQL 函式「現在的樣子」（#458）。
//
// 很多測試對某個 migration 檔做字串斷言，但同一個函式後來常被更新的 migration
// CREATE OR REPLACE 掉。對舊檔斷言永遠會過，正式資料庫跑的最新版本反而沒人驗。
// 這裡依檔名順序找出每個函式最後一次的定義，讓測試驗的是資料庫實際在跑的那份。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 不用 new URL(…)：jsdom 環境的全域 URL 不是 Node 的，fileURLToPath 會拒收。
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const CREATE_FUNCTION = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
const DROP_FUNCTION = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi;

let cache;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith(".sql")).sort();
}

// 一律換成 LF：Windows 工作目錄是 CRLF，CI 是 LF，斷言不該因此不同。
export function readMigration(file) {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/\r\n/g, "\n");
}

// 一個 CREATE FUNCTION 敘述的範圍：從 CREATE 到函式本體的 dollar-quote 結束後的分號。
function statementEnd(sql, start) {
  const open = /\$(\w*)\$/g;
  open.lastIndex = start;
  const tag = open.exec(sql);
  if (!tag) throw new Error(`migration-sql: no dollar-quoted body after offset ${start}`);
  const close = sql.indexOf(tag[0], tag.index + tag[0].length);
  if (close < 0) throw new Error(`migration-sql: unterminated ${tag[0]} body`);
  const semicolon = sql.indexOf(";", close + tag[0].length);
  return semicolon < 0 ? sql.length : semicolon + 1;
}

// 列出一份 migration 裡每個 CREATE FUNCTION 敘述（同名多次就各列一筆）。
export function functionStatements(sql) {
  const statements = [];
  for (const match of sql.matchAll(CREATE_FUNCTION)) {
    const end = statementEnd(sql, match.index);
    statements.push({ name: match[1].toLowerCase(), start: match.index, end, text: sql.slice(match.index, end) });
  }
  return statements;
}

// DO 區塊裡用 EXECUTE format('DROP FUNCTION %s', …) 依名稱清單刪函式（例如
// 20260929043341、20261004015147）：區塊內出現的已知函式名稱都算在這裡被刪掉。
function dynamicDrops(sql, knownNames) {
  const drops = [];
  for (const block of sql.matchAll(/\bDO\s+(\$\w*\$)([\s\S]*?)\1/gi)) {
    if (!/DROP\s+FUNCTION/i.test(block[2])) continue;
    for (const literal of block[2].matchAll(/'(\w+)'/g)) {
      const name = literal[1].toLowerCase();
      if (knownNames.has(name)) drops.push({ at: block.index, name, dropped: true });
    }
  }
  return drops;
}

function index() {
  if (cache) return cache;
  const files = migrationFiles().map(file => ({ file, sql: readMigration(file) }));
  const knownNames = new Set(files.flatMap(({ sql }) => functionStatements(sql).map(s => s.name)));
  const latest = new Map(); // name → { file, text } | { file, dropped: true }
  for (const { file, sql } of files) {
    const events = [
      ...functionStatements(sql).map(s => ({ at: s.start, name: s.name, text: s.text })),
      ...[...sql.matchAll(DROP_FUNCTION)].map(m => ({ at: m.index, name: m[1].toLowerCase(), dropped: true })),
      ...dynamicDrops(sql, knownNames),
    ].sort((a, b) => a.at - b.at);
    for (const event of events) {
      latest.set(event.name, event.dropped ? { file, dropped: true } : { file, text: event.text });
    }
  }
  return (cache = latest);
}

// 函式目前的定義（最新一份 migration 裡的 CREATE 敘述）。被刪掉或從未定義就丟錯。
export function latestFunctionDefinition(name) {
  const entry = index().get(name.toLowerCase());
  if (!entry) throw new Error(`migration-sql: no migration defines ${name}`);
  if (entry.dropped) throw new Error(`migration-sql: ${name} was dropped in ${entry.file}`);
  return entry;
}

// 一份舊 migration「現在的樣子」：檔內每個 CREATE FUNCTION 換成該函式目前的定義，
// 之後被刪掉的函式換成空字串；資料表、觸發器、GRANT 等其他內容照舊。
export function currentMigrationSql(file) {
  const sql = readMigration(file);
  let out = "";
  let cursor = 0;
  for (const statement of functionStatements(sql)) {
    const entry = index().get(statement.name);
    out += sql.slice(cursor, statement.start) + (entry.dropped ? "" : entry.text);
    cursor = statement.end;
  }
  return out + sql.slice(cursor);
}
