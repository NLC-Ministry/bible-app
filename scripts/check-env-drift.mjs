// 部署前檢查：repo 的 migration 與 Edge Function 是否已經到了 staging／正式站（#593）。
//
//   node scripts/check-env-drift.mjs                       兩個環境都查，以 origin/staging 為準
//   node scripts/check-env-drift.mjs --env staging         只查 staging
//   node scripts/check-env-drift.mjs --ref origin/main     以別的 git ref 為準
//   node scripts/check-env-drift.mjs --pr <上線 PR 編號>   另外把結果寫進該 PR 的同一則留言（有就更新）
//
// 由整合者在本機跑（需要先 `npx supabase login`）：CI 不放 Supabase 金鑰，因為 access token
// 無法限定只讀（#593 定案）。只提示、不擋——exit code 只在查詢本身失敗時不為 0。
//
// - Migration：repo 有、但環境的 supabase_migrations.schema_migrations 沒有的版本。
// - Edge Function：環境上的部署時間（updated_at）早於 repo 裡這個函式（含它 import 的
//   函式資料夾外的檔案，例如 _shared/）最後一個 commit 的時間，就標「需要重新部署」。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROD_REF, STAGING_REF, runSql } from "./lib/supabase-cli-query.mjs";

export const COMMENT_MARKER = "<!-- bible-app-env-drift-check -->";
export const ENVIRONMENTS = {
  staging: { label: "staging", ref: STAGING_REF, expectComplete: true },
  production: { label: "正式站", ref: PROD_REF, expectComplete: false }
};
const MIGRATIONS_DIR = "supabase/migrations";
const FUNCTIONS_DIR = "supabase/functions";

// ── 純函式 ──────────────────────────────────────────────────────────────────

/** migration 檔名 → [{ version, file }]：早期的 0001～0214 和之後的 timestamp 檔（legacy/ 子資料夾不算）。 */
export function parseMigrationFiles(paths) {
  return paths
    .map(path => posix.basename(path))
    .map(file => ({ file, match: /^(\d{4}|\d{14})_.+\.sql$/.exec(file) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({ version: match[1], file }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/** repo 有、環境沒有的 migration；以及環境有、repo 沒有的版本。 */
export function diffMigrations(local, appliedVersions) {
  const applied = new Set(appliedVersions.map(String));
  const localVersions = new Set(local.map(m => m.version));
  return {
    pending: local.filter(m => !applied.has(m.version)),
    remoteOnly: [...applied].filter(v => !localVersions.has(v)).sort()
  };
}

/** 從原始碼找出相對路徑的 import（含 export … from、動態 import）。 */
export function findRelativeImports(source) {
  const specs = new Set();
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of source.matchAll(re)) specs.add(match[1]);
  return [...specs];
}

/**
 * 一個函式部署時會帶上的檔案：資料夾內全部檔案，加上沿相對 import 走到的資料夾外檔案。
 * listFiles(dir) 回傳 dir 底下所有檔案路徑；readFile(path) 回傳內容（不存在回傳 null）。
 */
export function collectFunctionFiles(name, { listFiles, readFile }) {
  const dir = `${FUNCTIONS_DIR}/${name}`;
  const files = new Set(listFiles(dir));
  const queue = [...files];
  while (queue.length) {
    const path = queue.shift();
    if (!/\.(m?[jt]s|tsx?)$/.test(path)) continue;
    const source = readFile(path);
    if (source == null) continue;
    for (const spec of findRelativeImports(source)) {
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (files.has(target) || target.startsWith("../")) continue;
      files.add(target);
      queue.push(target);
    }
  }
  return [...files].sort();
}

/**
 * local：[{ name, changedAt(ms), commit }]；remote：`supabase functions list -o json` 的陣列。
 * 回傳 { stale, missing, remoteOnly, ok }。
 */
export function diffFunctions(local, remote) {
  const remoteBySlug = new Map(remote.map(fn => [fn.slug || fn.name, fn]));
  const localNames = new Set(local.map(fn => fn.name));
  const result = { stale: [], missing: [], remoteOnly: [], ok: [] };
  for (const fn of local) {
    const deployed = remoteBySlug.get(fn.name);
    if (!deployed) result.missing.push(fn);
    else if (Number(deployed.updated_at) < fn.changedAt) {
      result.stale.push({ ...fn, deployedAt: Number(deployed.updated_at), version: deployed.version });
    } else result.ok.push(fn);
  }
  result.remoteOnly = [...remoteBySlug.keys()].filter(slug => !localNames.has(slug)).sort();
  return result;
}

const formatTime = ms =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(ms));

/** 一個環境的結果 → markdown 行。 */
export function renderEnvironment({ env, migrations, functions }) {
  const bad = env.expectComplete ? "🔴 " : "";
  const lines = [`### ${env.label}`];

  if (!migrations.pending.length) lines.push("- Migration：✅ 全部已套用");
  else {
    const title = env.expectComplete ? `還沒套用 ${migrations.pending.length} 支` : "資料庫要更新的項目";
    lines.push(`- ${bad}Migration ${title}：`);
    for (const m of migrations.pending) lines.push(`  - \`${m.file}\``);
  }
  if (migrations.remoteOnly.length) {
    lines.push(`- ⚠️ 環境有、repo 沒有的 migration 版本：${migrations.remoteOnly.map(v => `\`${v}\``).join("、")}`);
  }

  const redeploy = [...functions.stale, ...functions.missing];
  if (!redeploy.length) lines.push("- Edge Function：✅ 都比 repo 最後修改還新");
  else {
    const title = env.expectComplete ? "需要重新部署" : "要重新部署的 Edge Function";
    lines.push(`- ${bad}${title}：`);
    for (const fn of functions.stale) {
      lines.push(`  - \`${fn.name}\`：部署於 ${formatTime(fn.deployedAt)}（v${fn.version}），repo 最後修改 ${formatTime(fn.changedAt)}（${fn.commit}）`);
    }
    for (const fn of functions.missing) lines.push(`  - \`${fn.name}\`：環境上沒有這個函式`);
  }
  if (functions.remoteOnly.length) {
    lines.push(`- ⚠️ 環境有、repo 沒有的函式：${functions.remoteOnly.map(s => `\`${s}\``).join("、")}`);
  }
  return lines;
}

export function renderReport({ gitRef, commit, checkedAt, results, prNumber }) {
  const rerun = prNumber ? `node scripts/check-env-drift.mjs --pr ${prNumber}` : "node scripts/check-env-drift.mjs";
  return [
    COMMENT_MARKER,
    `## 環境一致檢查（以 \`${gitRef}\` ${commit} 為準，${formatTime(checkedAt)}）`,
    "",
    ...results.flatMap(result => [...renderEnvironment(result), ""]),
    `<sub>只提示、不擋（#593）。由整合者在本機重跑：\`${rerun}\`</sub>`
  ].join("\n");
}

// ── 讀 git 與環境 ───────────────────────────────────────────────────────────

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 失敗：\n${`${result.stderr || ""}${result.stdout || ""}`.slice(0, 1500)}`);
  }
  return result.stdout;
}

const git = (...args) => run("git", args);

function readGitTree(gitRef) {
  const paths = git("ls-tree", "-r", "--name-only", gitRef, "--", MIGRATIONS_DIR, FUNCTIONS_DIR)
    .split("\n").filter(Boolean);
  const listFiles = dir => paths.filter(path => path.startsWith(`${dir}/`));
  const readFile = path => {
    if (!paths.includes(path)) return null;
    return git("show", `${gitRef}:${path}`);
  };
  const functionNames = [...new Set(paths
    .filter(path => path.startsWith(`${FUNCTIONS_DIR}/`))
    .map(path => path.split("/")[2]))]
    .filter(name => !name.startsWith("_") && paths.includes(`${FUNCTIONS_DIR}/${name}/index.ts`))
    .sort();
  const migrations = parseMigrationFiles(paths.filter(path => posix.dirname(path) === MIGRATIONS_DIR));
  const functions = functionNames.map(name => {
    const files = collectFunctionFiles(name, { listFiles, readFile });
    const [commit, iso] = git("log", "-1", "--format=%h %cI", gitRef, "--", ...files).trim().split(" ");
    return { name, commit, changedAt: Date.parse(iso) };
  });
  return { migrations, functions };
}

function fetchEnvironment(env) {
  const applied = runSql(env.ref, "select version from supabase_migrations.schema_migrations order by version;")
    .map(row => String(row.version));
  // Windows 的 npx 是 .cmd，必須透過 shell；ref 是寫死的常數
  const output = run(`npx supabase functions list --project-ref ${env.ref} -o json`, [], { shell: true });
  const start = output.indexOf("[");
  if (start === -1) throw new Error(`讀不到 ${env.label} 的函式清單：${output.slice(0, 500)}`);
  return { applied, remote: JSON.parse(output.slice(start)) };
}

function upsertPrComment(prNumber, body) {
  const dir = mkdtempSync(join(tmpdir(), "env-drift-"));
  const file = join(dir, "body.md");
  try {
    writeFileSync(file, body);
    const ids = run("gh", [
      "api", "--paginate", `repos/{owner}/{repo}/issues/${prNumber}/comments`,
      "--jq", `.[] | select(.body | startswith(${JSON.stringify(COMMENT_MARKER)})) | .id`
    ]).split("\n").filter(Boolean);
    if (ids.length) {
      run("gh", ["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${ids[0]}`, "-F", `body=@${file}`, "--silent"]);
      return "更新";
    }
    run("gh", ["api", `repos/{owner}/{repo}/issues/${prNumber}/comments`, "-F", `body=@${file}`, "--silent"]);
    return "新增";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const options = { gitRef: "origin/staging", envs: ["staging", "production"], prNumber: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ref") options.gitRef = argv[++i];
    else if (arg === "--env") {
      const env = argv[++i];
      if (!ENVIRONMENTS[env]) throw new Error(`--env 只能是 ${Object.keys(ENVIRONMENTS).join("／")}`);
      options.envs = [env];
    } else if (arg === "--pr") {
      options.prNumber = Number(argv[++i]);
      if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) throw new Error("--pr 要接 PR 編號");
    } else throw new Error(`不認得的參數：${arg}`);
  }
  if (!options.gitRef || options.gitRef.startsWith("-")) throw new Error("--ref 要接 git ref");
  return options;
}

function main(argv) {
  const { gitRef, envs, prNumber } = parseArgs(argv);
  const local = readGitTree(gitRef);
  const results = envs.map(key => {
    const env = ENVIRONMENTS[key];
    const { applied, remote } = fetchEnvironment(env);
    return {
      env,
      migrations: diffMigrations(local.migrations, applied),
      functions: diffFunctions(local.functions, remote)
    };
  });
  const report = renderReport({
    gitRef,
    commit: git("rev-parse", "--short", gitRef).trim(),
    checkedAt: Date.now(),
    results,
    prNumber
  });
  console.log(report);
  if (prNumber) console.log(`\n已${upsertPrComment(prNumber, report)} PR #${prNumber} 的檢查留言。`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
