// Supabase Security Advisor 對 staging／正式站跑一次，只列資安類、不在允許清單裡的項目（#594）。
//
//   node scripts/security-advisor.mjs                  staging
//   node scripts/security-advisor.mjs --env production
//
// 由整合者在本機跑（需要先 `npx supabase login`）：CI 不放 Supabase 金鑰（#593／#594 定案）。
// 用 CLI 內建的 `db advisors`（#680）：唯讀，代理程式模式下也不用使用者同意。
//
// 有不在允許清單（supabase/security-allowlist.json 的 security_advisor）裡的項目時 exit code 1。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROD_REF, STAGING_REF, remoteFlag, supabaseCommand } from "./lib/supabase-cli-query.mjs";
import { loadAllowlist } from "./lib/db-security-checks.mjs";

const ENVIRONMENTS = { staging: STAGING_REF, production: PROD_REF };

// 分級和 exit code 由允許清單決定，所以要全部項目（--level info），CLI 自己不判失敗（--fail-on none）
export function buildAdvisorsCommand(ref) {
  return supabaseCommand(["db", "advisors", remoteFlag(ref), "--type", "security", "--level", "info", "--fail-on", "none", "-o", "json"]);
}

/**
 * 解析 `db advisors` 的輸出。零筆時 stdout 是空的，「No issues found」印在 stderr。
 * 這是安全檢查：看不懂就報錯，不能當成沒問題。
 */
export function parseAdvisorOutput(stdout, stderr) {
  const text = String(stdout || "").trim();
  if (!text && /No issues found/.test(String(stderr || ""))) return [];
  const rows = text.startsWith("[") ? JSON.parse(text) : null;
  if (!rows) throw new Error(`看不懂 db advisors 的輸出（CLI 改版了？）：${text.slice(0, 300)}`);
  return rows;
}

function runAdvisors(ref) {
  const result = spawnSync(buildAdvisorsCommand(ref), { encoding: "utf8", shell: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`db advisors 失敗：\n${`${result.stderr || ""}${result.stdout || ""}`.split(ref).join("<ref>").slice(0, 1500)}`);
  }
  return parseAdvisorOutput(result.stdout, result.stderr);
}

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
  const lines = [`## Security Advisor：${envLabel}`, ""];
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

export function parseArgs(argv) {
  if (!argv.length) return { env: "staging" };
  if (argv.length === 2 && argv[0] === "--env" && ENVIRONMENTS[argv[1]]) return { env: argv[1] };
  throw new Error("用法：node scripts/security-advisor.mjs [--env staging|production]");
}

function main(argv) {
  const { env } = parseArgs(argv);
  const ref = ENVIRONMENTS[env];
  const rows = runAdvisors(ref);
  const { accepted, unexpected } = classifyFindings(rows, loadAllowlist().security_advisor);
  console.log(renderFindings({ envLabel: env === "staging" ? "staging" : "正式站", ref, accepted, unexpected }));
  return unexpected.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
