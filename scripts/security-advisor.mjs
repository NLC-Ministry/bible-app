// Supabase Security Advisor（Splinter）對 staging／正式站跑一次，只列資安類、不在允許清單裡的項目（#594）。
//
//   node scripts/security-advisor.mjs                  staging
//   node scripts/security-advisor.mjs --env production
//
// 由整合者在本機跑（需要先 `npx supabase login`）：CI 不放 Supabase 金鑰（#593／#594 定案）。
// Splinter 的 repo 沒有授權檔，不能把 SQL 複製進這個公開 repo，所以每次從固定的 commit
// 下載、比對 sha256 後才執行。它是唯讀的查詢（只有一個 set_config 給自己用的 session 變數）。
// 要升級 Splinter：改 SPLINTER_COMMIT／SPLINTER_SHA256，先讀過新版的 diff。
//
// 有不在允許清單（supabase/security-allowlist.json 的 security_advisor）裡的項目時 exit code 1。

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROD_REF, STAGING_REF, runSqlFile } from "./lib/supabase-cli-query.mjs";
import { loadAllowlist } from "./lib/db-security-checks.mjs";

export const SPLINTER_COMMIT = "fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975"; // 2026-09-29
export const SPLINTER_SHA256 = "d8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349";
const SPLINTER_URL = `https://raw.githubusercontent.com/supabase/splinter/${SPLINTER_COMMIT}/splinter.sql`;
const ENVIRONMENTS = { staging: STAGING_REF, production: PROD_REF };

/** 只留資安類；依允許清單分成「已接受」與「要處理」。 */
export function classifyFindings(rows, { lints = {}, cache_keys: cacheKeys = {} } = {}) {
  const security = rows.filter(row => (row.categories || []).includes("SECURITY"));
  const accepted = [];
  const unexpected = [];
  for (const row of security) {
    const reason = cacheKeys[row.cache_key] ?? lints[row.name];
    (reason ? accepted : unexpected).push(reason ? { ...row, reason } : row);
  }
  return { accepted, unexpected };
}

export function renderFindings({ envLabel, ref, accepted, unexpected }) {
  const lines = [`## Security Advisor：${envLabel}（\`${ref}\`）`, ""];
  if (!unexpected.length) lines.push("✅ 沒有要處理的資安項目");
  else {
    lines.push(`🔴 要處理 ${unexpected.length} 項：`);
    for (const row of unexpected) {
      lines.push(`- **${row.level}** \`${row.name}\`：${row.detail.replace(/\\`/g, "`")}`);
      lines.push(`  - cache_key：\`${row.cache_key}\`${row.remediation ? `；說明：${row.remediation}` : ""}`);
    }
  }
  const acceptedByLint = Object.entries(Object.groupBy(accepted, row => row.name));
  if (acceptedByLint.length) {
    lines.push("", "已接受（supabase/security-allowlist.json）：");
    for (const [name, items] of acceptedByLint) lines.push(`- \`${name}\` × ${items.length}：${items[0].reason}`);
  }
  return lines.join("\n");
}

async function downloadSplinter() {
  const response = await fetch(SPLINTER_URL);
  if (!response.ok) throw new Error(`下載 Splinter 失敗：HTTP ${response.status}`);
  const sql = await response.text();
  const hash = createHash("sha256").update(sql).digest("hex");
  if (hash !== SPLINTER_SHA256) throw new Error(`Splinter 的 sha256 不符（${hash}），不執行`);
  return sql;
}

export function parseArgs(argv) {
  if (!argv.length) return { env: "staging" };
  if (argv.length === 2 && argv[0] === "--env" && ENVIRONMENTS[argv[1]]) return { env: argv[1] };
  throw new Error("用法：node scripts/security-advisor.mjs [--env staging|production]");
}

async function main(argv) {
  const { env } = parseArgs(argv);
  const ref = ENVIRONMENTS[env];
  const sql = await downloadSplinter();
  const dir = mkdtempSync(join(tmpdir(), "splinter-"));
  let rows;
  try {
    const file = join(dir, "splinter.sql");
    writeFileSync(file, sql);
    rows = runSqlFile(ref, file.replace(/\\/g, "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const { accepted, unexpected } = classifyFindings(rows, loadAllowlist().security_advisor);
  console.log(renderFindings({ envLabel: env === "staging" ? "staging" : "正式站", ref, accepted, unexpected }));
  return unexpected.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
