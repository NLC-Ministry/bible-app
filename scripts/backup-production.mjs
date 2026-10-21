// 正式環境每週備份（#345）。
//
//   node scripts/backup-production.mjs run
//       從正式環境只讀匯出：結構（pg_dump --schema-only）、每張 public 表一個 CSV
//       （依主鍵排序，沒變的行每次輸出都一樣）、cron / storage / 政策 / 序列等
//       中繼資料。寫進本機備份倉庫並 git commit，git 只存有變的行。
//       每月第一次執行另存一份 pg_dump -Fc 完整檔（保留 3 份）。
//       最後把整個倉庫打包成 git bundle，用 7-Zip AES-256 加密（含檔名）放到雲端
//       資料夾（保留 4 份）。
//
// 平常由 scripts/backup-production.ps1 呼叫（它從 DPAPI 檔讀出壓縮密碼放進
// 環境變數 BACKUP_ARCHIVE_PASSWORD），不要直接排程這支。
// 不存 DB 密碼：每一步連線前用已登入的 Supabase CLI（`supabase db dump --dry-run`）
// 換一組臨時帳號，跟 `supabase db push` 同一套機制。
// 備份內容含會友個資：本機明文只放在專案 repo 和 OneDrive 外面。見 docs/backup.md。

import { spawnSync } from "node:child_process";
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
// 備份只在 Windows 上跑（backup-production.ps1 排程）；固定用 Windows 路徑規則，
// CI（Linux）跑測試時才會和實際環境一致（#352）。
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

const { isAbsolute, join, relative, resolve } = win32;

// 正式站 ref 來自環境變數／.env（#609），和 scripts/lib/supabase-cli-query.mjs 同一個來源
import { PROD_REF } from "./lib/supabase-cli-query.mjs";
export { PROD_REF };
export const MONTHLY_FULL_KEEP = 3;
export const CLOUD_KEEP = 4;
export const LOG_KEEP = 30;
export const MIN_PG_MAJOR = 17;

export const DEFAULT_CONFIG = {
  pgBinDir: "C:/Program Files/PostgreSQL/17/bin",
  sevenZipPath: "C:/Program Files/7-Zip/7z.exe",
  cloudDir: join(process.env.OneDrive || join(homedir(), "OneDrive"), "bible-speed-reading-backups"),
  projectDir: ""
};

// ── 路徑 ─────────────────────────────────────────────────────────────────────

export function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** 備份根目錄的配置。明文（repo/full）不能在專案 repo 或 OneDrive 裡。 */
export function resolvePaths({ root, projectRoots, oneDriveDir }) {
  if (!root || !isAbsolute(root)) throw new Error(`備份目錄必須是絕對路徑：${root}`);
  for (const projectRoot of projectRoots.filter(Boolean)) {
    if (isInside(root, projectRoot)) throw new Error(`備份目錄不能在專案 repo 裡：${root}`);
  }
  if (oneDriveDir && isInside(root, oneDriveDir)) {
    throw new Error(`備份目錄不能在 OneDrive 裡（明文個資會被同步上雲端）：${root}`);
  }
  if (/'/.test(root)) throw new Error(`備份目錄路徑不能含單引號：${root}`);
  return {
    root,
    repoDir: join(root, "repo"),
    fullDir: join(root, "full"),
    logsDir: join(root, "logs"),
    configFile: join(root, "backup.config.json")
  };
}

export function assertCloudDir(cloudDir, { root, projectRoots }) {
  if (!cloudDir || !isAbsolute(cloudDir)) throw new Error(`雲端目錄必須是絕對路徑：${cloudDir}`);
  for (const dir of [root, ...projectRoots.filter(Boolean)]) {
    if (isInside(cloudDir, dir)) throw new Error(`雲端目錄不能在備份目錄或專案 repo 裡：${cloudDir}`);
  }
}

/** psql 的 \copy 路徑用正斜線、單引號包起來。 */
export function psqlPath(path) {
  if (/['\r\n]/.test(path)) throw new Error(`路徑不能含單引號或換行：${path}`);
  return path.replace(/\\/g, "/");
}

// ── SQL ─────────────────────────────────────────────────────────────────────

export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function assertTableName(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`不支援的表名：${name}`);
}

/** 列出 public 的表：可寫入的欄位（排除 generated 欄位）＋主鍵。 */
export const CATALOG_SQL = `SELECT coalesce(json_agg(t ORDER BY t.name), '[]'::json) FROM (
  SELECT c.relname AS name,
    (SELECT json_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS columns,
    (SELECT json_agg(a.attname ORDER BY array_position(i.indkey::int2[], a.attnum)) FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
) t;`;

export function parseCatalog(output) {
  const tables = JSON.parse(String(output).trim());
  if (!Array.isArray(tables) || tables.length === 0) throw new Error("讀不到 public 的資料表清單");
  return tables.map(({ name, columns, pk }) => {
    assertTableName(name);
    if (!Array.isArray(columns) || columns.length === 0) throw new Error(`${name} 沒有欄位`);
    return { name, columns, pk: Array.isArray(pk) ? pk : [] };
  });
}

/** 固定排序：有主鍵用主鍵，沒有就用整列文字（json 欄位不能直接比大小）。 */
export function orderByClause(table) {
  return table.pk.length ? table.pk.map(quoteIdent).join(", ") : "t::text";
}

export function dataFileName(table) {
  assertTableName(table.name);
  return `public.${table.name}.csv`;
}

function columnList(table) {
  return table.columns.map(quoteIdent).join(", ");
}

/** 中繼資料：pg_dump -n public 不含，或還原後要對照用的。 */
export const META_QUERIES = [
  ["cron_jobs.csv", "SELECT jobid, jobname, schedule, command, database, username, active FROM cron.job ORDER BY jobid"],
  ["storage_buckets.csv", "SELECT * FROM storage.buckets ORDER BY id"],
  ["storage_objects.csv", "SELECT bucket_id, name, metadata->>'size' AS size, metadata->>'mimetype' AS mimetype, created_at, updated_at FROM storage.objects ORDER BY bucket_id, name"],
  ["policies.csv", "SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies ORDER BY schemaname, tablename, policyname"],
  ["sequences.csv", "SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY schemaname, sequencename"],
  ["extensions.csv", "SELECT e.extname, e.extversion, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname"],
  ["vault_secret_names.csv", "SELECT name, description, created_at, updated_at FROM vault.secrets ORDER BY name"],
  ["migrations.csv", "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version"]
];

export function rowCountSql(tables) {
  return tables
    .map((t) => `SELECT '${t.name}' AS table_name, count(*) AS row_count FROM public.${quoteIdent(t.name)}`)
    .join(" UNION ALL ") + " ORDER BY 1";
}

function copyOut(query, file) {
  // \copy 整行是一個指令，查詢不能換行
  return `\\copy (${query.replace(/\s+/g, " ")}) TO '${psqlPath(file)}' WITH (FORMAT csv, HEADER true)`;
}

// CLI 臨時帳號本身讀不到 cron / vault，要切成 postgres；pooler 會忽略 PGOPTIONS，唯讀要連上後自己設
export const SESSION_SETUP = ["SET ROLE postgres", "SET default_transaction_read_only = on"];

/** 所有表在同一個 REPEATABLE READ 唯讀交易裡匯出，是同一瞬間的快照。 */
export function buildExportScript(tables, { dataDir, metaDir }) {
  const lines = [
    "\\set ON_ERROR_STOP on",
    ...SESSION_SETUP.map((sql) => `${sql};`),
    "SET TimeZone = 'UTC';",
    "SET DateStyle = 'ISO, YMD';",
    "SET IntervalStyle = 'postgres';",
    "SET extra_float_digits = 1;",
    "SET bytea_output = 'hex';",
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
  ];
  for (const t of tables) {
    const query = `SELECT ${columnList(t)} FROM public.${quoteIdent(t.name)} t ORDER BY ${orderByClause(t)}`;
    lines.push(copyOut(query, join(dataDir, dataFileName(t))));
  }
  for (const [file, query] of META_QUERIES) lines.push(copyOut(query, join(metaDir, file)));
  lines.push(copyOut(rowCountSql(tables), join(metaDir, "row_counts.csv")));
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

/** 資料還原腳本（在倉庫根目錄執行，先載入 schema.sql）。見 docs/backup.md。 */
export function buildRestoreScript(tables) {
  const lines = [
    "-- 自動產生（scripts/backup-production.mjs），不要手改。",
    "-- 在備份倉庫根目錄執行：先 psql -f schema.sql，再 psql -f restore-data.sql。",
    "-- 只能還原到空的測試資料庫（本機 supabase start），絕不還原到 staging 或正式站。",
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SET session_replication_role = replica; -- 不觸發 trigger、不檢查外鍵順序"
  ];
  for (const t of tables) {
    lines.push(`\\copy public.${quoteIdent(t.name)} (${columnList(t)}) FROM 'data/${dataFileName(t)}' WITH (FORMAT csv, HEADER true)`);
  }
  lines.push(
    "CREATE TEMP TABLE backup_sequences (schemaname text, sequencename text, last_value bigint);",
    "\\copy backup_sequences FROM 'meta/sequences.csv' WITH (FORMAT csv, HEADER true)",
    "SELECT setval(format('%I.%I', schemaname, sequencename), last_value) FROM backup_sequences WHERE last_value IS NOT NULL;",
    "COMMIT;"
  );
  return `${lines.join("\n")}\n`;
}

// pg_dump 17.6+ 每次會在 schema.sql 寫一個隨機的 \restrict 金鑰，每週都會多出假差異；
// 用固定金鑰讓沒變的結構輸出完全一樣。
export const RESTRICT_KEY = "biblespeedreadingbackup";

// ── 版本 / 輪替 ───────────────────────────────────────────────────────────────

export function parsePgMajor(versionOutput) {
  const m = String(versionOutput).match(/\(PostgreSQL\)\s+(\d+)/);
  if (!m) throw new Error(`看不懂 pg_dump 版本：${versionOutput}`);
  return Number(m[1]);
}

export function monthlyDumpName(date) {
  return `prod-public-${date.toISOString().slice(0, 7)}.dump`;
}

export function timestampName(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
}

export function cloudArchiveName(date) {
  return `bible-speed-reading-backup-${timestampName(date)}.7z`;
}

/** 依檔名排序（名稱裡有時間），回傳要刪掉的舊檔。 */
export function filesToRotate(files, pattern, keep) {
  const matched = files.filter((f) => pattern.test(f)).sort();
  return matched.slice(0, Math.max(0, matched.length - keep));
}

// ── 執行 ─────────────────────────────────────────────────────────────────────

let LOG_FILE = "";
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (LOG_FILE) appendFileSync(LOG_FILE, `${line}\n`);
}

function startLog(logsDir, now) {
  mkdirSync(logsDir, { recursive: true });
  for (const old of filesToRotate(readdirSync(logsDir), /^backup-.+\.log$/, LOG_KEEP - 1)) rmSync(join(logsDir, old));
  LOG_FILE = join(logsDir, `backup-${timestampName(now)}.log`);
}

function run(cmd, args, { env, cwd, input, shell = false, secrets = [], sensitiveOutput = false } = {}) {
  const options = { env, cwd, input, shell, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true };
  // shell 模式只用在參數全是固定值的 npx 指令；Node 24 不建議 shell 搭配參數陣列，所以組成一整串
  const result = shell ? spawnSync([cmd, ...args].join(" "), options) : spawnSync(cmd, args, options);
  if (result.error) throw new Error(`無法執行 ${cmd}：${result.error.message}`);
  if (result.status !== 0) {
    // 臨時帳號的輸出含密碼：失敗時只留 stderr
    let output = `${result.stderr || ""}${sensitiveOutput ? "" : result.stdout || ""}`.slice(0, 2000);
    for (const s of secrets) if (s) output = output.split(s).join("***");
    throw new Error(`${cmd} 失敗（exit ${result.status}）：\n${output}`);
  }
  return result.stdout || "";
}

export function loadConfig(configFile) {
  if (!existsSync(configFile)) return { ...DEFAULT_CONFIG };
  // PowerShell 5.1 寫的 UTF-8 帶 BOM
  const saved = JSON.parse(readFileSync(configFile, "utf8").replace(/^﻿/, ""));
  return { ...DEFAULT_CONFIG, ...saved };
}

const CREDENTIAL_KEYS = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];

/** 解析 `supabase db dump --dry-run` 印出的 `export PGxxx="..."`，確認是正式站。 */
export function parseCliCredentials(output) {
  const creds = {};
  for (const line of String(output).split(/\r?\n/)) {
    const m = line.match(/^export (PG[A-Z]+)=(.*)$/);
    if (!m || !CREDENTIAL_KEYS.includes(m[1])) continue;
    const value = m[2].trim().match(/^"([A-Za-z0-9._-]+)"$/);
    if (!value) throw new Error(`看不懂 Supabase CLI 給的 ${m[1]} 格式（CLI 改版了？）`);
    creds[m[1]] = value[1];
  }
  const missing = CREDENTIAL_KEYS.filter((k) => !creds[k]);
  if (missing.length) throw new Error(`Supabase CLI 沒給出 ${missing.join("、")}（CLI 沒登入或改版了？）`);
  if (!PROD_REF) throw new Error("沒有設定 SUPABASE_PRODUCTION_REF（放在專案主資料夾的 .env），無法確認臨時帳號是正式站");
  if (!creds.PGUSER.endsWith(`.${PROD_REF}`)) throw new Error("臨時帳號不是正式站");
  if (!/\.pooler\.supabase\.com$/.test(creds.PGHOST)) throw new Error(`連線主機不是 Supabase pooler：${creds.PGHOST}`);
  return creds;
}

/** 每次連線前重新拿一組臨時帳號，避免備份到一半臨時密碼過期。 */
function pgEnv(config) {
  if (!config.projectDir) throw new Error("backup.config.json 沒有 projectDir（請重跑 backup-production.ps1 -Install）");
  const out = run("npx", ["supabase", "db", "dump", "--dry-run", "--linked", "--project-ref", PROD_REF], {
    cwd: config.projectDir, shell: true, sensitiveOutput: true // npx 是 .cmd，要經過 shell；參數都是固定值
  });
  return {
    ...process.env,
    ...parseCliCredentials(out),
    PGSSLMODE: "require",
    PGCLIENTENCODING: "UTF8", // 不跟著 Windows 主控台的字碼頁（Big5）走
    PGAPPNAME: "bible-speed-reading-backup"
  };
}

function initRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true });
  if (!existsSync(join(repoDir, ".git"))) {
    run("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    log(`建立備份倉庫 ${repoDir}`);
  }
  // 永遠不設 remote；CSV 不做換行轉換
  run("git", ["config", "core.autocrlf", "false"], { cwd: repoDir });
  run("git", ["config", "user.name", "bible-speed-reading-backup"], { cwd: repoDir });
  run("git", ["config", "user.email", "backup@localhost"], { cwd: repoDir });
  const remotes = run("git", ["remote"], { cwd: repoDir }).trim();
  if (remotes) throw new Error(`備份倉庫不能有 remote（發現 ${remotes}）`);
}

function writeEdgeFunctionSecretNames(config, metaDir) {
  const file = join(metaDir, "edge_function_secret_names.json");
  if (!config.projectDir) return log("略過 Edge Function 環境變數名稱：沒有設定 projectDir");
  try {
    const out = run("npx", ["supabase", "secrets", "list", "--project-ref", PROD_REF, "-o", "json"], {
      cwd: config.projectDir, env: process.env, shell: true // npx 是 .cmd，要經過 shell；參數都是固定值
    });
    const parsed = JSON.parse(out.slice(out.indexOf("[")));
    const names = parsed.map((s) => s.name).filter(Boolean).sort();
    writeFileSync(file, `${JSON.stringify(names, null, 2)}\n`);
  } catch (e) {
    // 名稱清單很少變，保留上一次的檔案，不讓整個備份失敗
    log(`⚠ 讀不到 Edge Function 環境變數名稱（沿用上次的檔案）：${e.message.split("\n")[0]}`);
  }
}

function commitRepo(repoDir, now) {
  run("git", ["add", "-A"], { cwd: repoDir });
  const status = run("git", ["status", "--porcelain"], { cwd: repoDir }).trim();
  if (!status) return log("資料沒有變化，不產生新 commit");
  const changed = status.split("\n").length;
  run("git", ["commit", "-q", "-m", `backup ${now.toISOString()}`], { cwd: repoDir });
  run("git", ["gc", "--quiet"], { cwd: repoDir }); // 打包成 delta，才真的只存差異
  log(`已 commit（${changed} 個檔案有變化）`);
}

function monthlyFullDump(paths, config, now) {
  mkdirSync(paths.fullDir, { recursive: true });
  const name = monthlyDumpName(now);
  const target = join(paths.fullDir, name);
  if (existsSync(target)) return log(`本月完整檔已存在：${name}`);
  const tmp = `${target}.partial`;
  run(pgTool("pg_dump"), ["-Fc", "--schema=public", "--role=postgres", "-f", tmp], { env: pgEnv(config) });
  renameSync(tmp, target);
  log(`已存本月完整檔 ${name}（${(statSync(target).size / 1048576).toFixed(1)} MB）`);
  for (const old of filesToRotate(readdirSync(paths.fullDir), /^prod-public-\d{4}-\d{2}\.dump$/, MONTHLY_FULL_KEEP)) {
    rmSync(join(paths.fullDir, old));
    log(`刪除舊的完整檔 ${old}`);
  }
}

function cloudCopy(paths, config, projectRoots, now) {
  const password = process.env.BACKUP_ARCHIVE_PASSWORD;
  if (!password) throw new Error("沒有 BACKUP_ARCHIVE_PASSWORD（請用 scripts/backup-production.ps1 執行）");
  assertCloudDir(config.cloudDir, { root: paths.root, projectRoots });
  mkdirSync(config.cloudDir, { recursive: true });

  const bundle = join(paths.root, "repo.bundle");
  rmSync(bundle, { force: true });
  run("git", ["bundle", "create", "-q", bundle, "--all"], { cwd: paths.repoDir });

  const name = cloudArchiveName(now);
  const tmp = join(paths.root, `${name}.partial`);
  rmSync(tmp, { force: true });
  try {
    const args = ["a", "-t7z", "-mhe=on", "-mx=9", `-p${password}`, "-y", tmp, bundle];
    run(config.sevenZipPath, args, { secrets: [password] });
    run(config.sevenZipPath, ["t", `-p${password}`, tmp], { secrets: [password] });
    // 先在本機寫完、驗證，再搬進 OneDrive，才不會同步到寫一半的檔案
    const target = join(config.cloudDir, name);
    copyFileSync(tmp, target);
    log(`雲端副本 ${target}（${(statSync(target).size / 1048576).toFixed(1)} MB）`);
  } finally {
    rmSync(tmp, { force: true });
    rmSync(bundle, { force: true });
  }
  for (const old of filesToRotate(readdirSync(config.cloudDir), /^bible-speed-reading-backup-.+\.7z$/, CLOUD_KEEP)) {
    rmSync(join(config.cloudDir, old));
    log(`刪除舊的雲端副本 ${old}`);
  }
}

let PG_BIN_DIR = DEFAULT_CONFIG.pgBinDir;
function pgTool(name) {
  return join(PG_BIN_DIR, `${name}.exe`);
}

// 排程執行的是複製到 <備份目錄>/bin 的副本，所以專案 repo 位置另外記在 config.projectDir
export const SCRIPT_PARENT = fileURLToPath(new URL("..", import.meta.url));

export function defaultRoot() {
  return process.env.BACKUP_ROOT || join(homedir(), "Documents", "bible-speed-reading-backups");
}

export function runBackup({ root = defaultRoot(), now = new Date() } = {}) {
  const config = loadConfig(join(root, "backup.config.json"));
  const projectRoots = [config.projectDir, isInside(SCRIPT_PARENT, root) ? "" : SCRIPT_PARENT];
  const paths = resolvePaths({ root, projectRoots, oneDriveDir: process.env.OneDrive });
  startLog(paths.logsDir, now);
  PG_BIN_DIR = config.pgBinDir;

  const major = parsePgMajor(run(pgTool("pg_dump"), ["--version"]));
  if (major < MIN_PG_MAJOR) throw new Error(`pg_dump 要 ${MIN_PG_MAJOR} 以上（目前 ${major}）`);
  if (!existsSync(config.sevenZipPath)) throw new Error(`找不到 7-Zip：${config.sevenZipPath}`);

  initRepo(paths.repoDir);
  const dataDir = join(paths.repoDir, "data");
  const metaDir = join(paths.repoDir, "meta");
  mkdirSync(metaDir, { recursive: true });

  log("讀取資料表清單");
  const tables = parseCatalog(run(pgTool("psql"), ["-X", "-A", "-t", "-q", ...SESSION_SETUP.flatMap((sql) => ["-c", sql]), "-c", CATALOG_SQL], { env: pgEnv(config) }));

  log("匯出結構 schema.sql");
  run(pgTool("pg_dump"), [
    "--schema-only", "--schema=public", "--role=postgres", `--restrict-key=${RESTRICT_KEY}`,
    "-f", join(paths.repoDir, "schema.sql")
  ], { env: pgEnv(config) });

  // 先清掉 data/，被刪掉的表才不會留下舊檔
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  log(`匯出 ${tables.length} 張表的資料`);
  const scriptFile = join(paths.root, "export.partial.sql");
  writeFileSync(scriptFile, buildExportScript(tables, { dataDir, metaDir }));
  try {
    run(pgTool("psql"), ["-X", "-q", "-f", scriptFile], { env: pgEnv(config) });
  } finally {
    rmSync(scriptFile, { force: true });
  }

  writeFileSync(join(paths.repoDir, "restore-data.sql"), buildRestoreScript(tables));
  writeEdgeFunctionSecretNames(config, metaDir);
  writeFileSync(join(paths.repoDir, "README.md"),
    "# 新生命聖經速讀 正式站備份\n\n自動產生，不要手改、不要設 remote、不要推到任何地方。\n" +
    "還原步驟見專案 repo 的 docs/backup.md。\n");

  commitRepo(paths.repoDir, now);
  monthlyFullDump(paths, config, now);
  cloudCopy(paths, config, projectRoots, now);
  log("備份完成");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command !== "run") {
    console.error("用法：node scripts/backup-production.mjs run（平常由 backup-production.ps1 呼叫）");
    process.exit(2);
  }
  try {
    runBackup();
  } catch (e) {
    log(`備份失敗：${e.message}`);
    process.exit(1);
  }
}
