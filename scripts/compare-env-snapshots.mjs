// 比對兩個環境的 supabase/queries/environment_consistency_check.sql 輸出（#266）。
//
//   node scripts/compare-env-snapshots.mjs --run
//       直接用 Supabase CLI 查正式環境和 staging 再比對（需要先 `supabase login`）。
//       一律用 --project-ref 明確指定環境，不依賴 `supabase link`。
//   node scripts/compare-env-snapshots.mjs <prod 檔案> <staging 檔案>
//       比對兩份輸出。可以是 `supabase db query` 的 JSON，或 SQL Editor 匯出的 CSV。
//
// 有「非預期」差異時 exit code 為 1。EXPECTED_DIFFERENCE_SECTIONS 裡的類別
// 仍會列出，但不影響 exit code。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROD_REF, STAGING_REF, runSqlFile } from "./lib/supabase-cli-query.mjs";

export { PROD_REF, STAGING_REF };
// cron_job、vault_secret_name：staging 刻意不設定。extension_version：Supabase 平台自動升級。
export const EXPECTED_DIFFERENCE_SECTIONS = new Set(["cron_job", "vault_secret_name", "extension_version"]);

const SQL_PATH = fileURLToPath(new URL("../supabase/queries/environment_consistency_check.sql", import.meta.url));

// ── 解析 ────────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some(value => value !== "")) records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field);
  if (record.some(value => value !== "")) records.push(record);
  return records;
}

/** 解析一份輸出，回傳 [{ section, object, detail }]。 */
export function parseSnapshot(text) {
  const trimmed = text.replace(/^﻿/, "");
  const jsonStart = trimmed.indexOf("{");
  const looksLikeJson = jsonStart !== -1 && /"rows"\s*:/.test(trimmed);
  if (looksLikeJson) {
    // CLI 會在 JSON 前面印出 "Initialising login role..." 之類的訊息
    const parsed = JSON.parse(trimmed.slice(jsonStart));
    if (!Array.isArray(parsed.rows)) throw new Error("JSON 裡沒有 rows，可能是查詢失敗：" + trimmed.slice(0, 200));
    return parsed.rows.map(({ section, object, detail }) => ({ section, object, detail: detail ?? "" }));
  }
  const [header, ...records] = parseCsv(trimmed);
  const columns = header.map(name => name.trim().toLowerCase());
  const index = name => {
    const position = columns.indexOf(name);
    if (position === -1) throw new Error(`CSV 缺少 ${name} 欄位（要有 section, object, detail）`);
    return position;
  };
  const [s, o, d] = [index("section"), index("object"), index("detail")];
  return records.map(record => ({ section: record[s], object: record[o], detail: record[d] ?? "" }));
}

// ── 比對 ────────────────────────────────────────────────────────────────────

function keyed(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.section}\u0000${row.object}`;
    // 同一個 key 出現多次（理論上不會）就合併，避免默默蓋掉
    map.set(key, map.has(key) ? `${map.get(key)} | ${row.detail}` : row.detail);
  }
  return map;
}

/**
 * 回傳 { unexpected, expected }，每個都是
 * [{ section, object, kind: "only_in_a" | "only_in_b" | "changed", a, b }]
 */
export function diffSnapshots(rowsA, rowsB) {
  const a = keyed(rowsA);
  const b = keyed(rowsB);
  const differences = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const [section, object] = key.split("\u0000");
    const inA = a.has(key);
    const inB = b.has(key);
    if (inA && inB && a.get(key) === b.get(key)) continue;
    differences.push({
      section,
      object,
      kind: !inB ? "only_in_a" : !inA ? "only_in_b" : "changed",
      a: inA ? a.get(key) : null,
      b: inB ? b.get(key) : null
    });
  }
  differences.sort((x, y) => x.section.localeCompare(y.section) || x.object.localeCompare(y.object));
  return {
    unexpected: differences.filter(d => !EXPECTED_DIFFERENCE_SECTIONS.has(d.section)),
    expected: differences.filter(d => EXPECTED_DIFFERENCE_SECTIONS.has(d.section))
  };
}

export function formatReport({ unexpected, expected }, labelA = "prod", labelB = "staging") {
  const describe = d =>
    d.kind === "only_in_a" ? `  - ${d.object}：只有 ${labelA} 有（${d.a}）`
    : d.kind === "only_in_b" ? `  - ${d.object}：只有 ${labelB} 有（${d.b}）`
    : `  - ${d.object}：內容不同\n      ${labelA}: ${d.a}\n      ${labelB}: ${d.b}`;
  const group = list => {
    const lines = [];
    let current = null;
    for (const d of list) {
      if (d.section !== current) { lines.push(`[${d.section}]`); current = d.section; }
      lines.push(describe(d));
    }
    return lines.join("\n");
  };
  const out = [];
  out.push(unexpected.length === 0
    ? `✅ ${labelA} 與 ${labelB} 一致（預期差異除外）`
    : `❌ ${unexpected.length} 項非預期差異：\n${group(unexpected)}`);
  if (expected.length) out.push(`\nℹ️ ${expected.length} 項預期差異（staging 刻意不設定的排程／secret、平台自動升級的 extension 版本）：\n${group(expected)}`);
  return out.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function runSnapshot(ref) {
  return runSqlFile(ref, SQL_PATH.replace(/\\/g, "/"))
    .map(({ section, object, detail }) => ({ section, object, detail: detail ?? "" }));
}

function main(argv) {
  let labelA = "prod";
  let labelB = "staging";
  let rowsA;
  let rowsB;
  if (argv[0] === "--run") {
    rowsA = runSnapshot(PROD_REF);
    rowsB = runSnapshot(STAGING_REF);
  } else if (argv.length === 2) {
    [labelA, labelB] = argv;
    rowsA = parseSnapshot(readFileSync(argv[0], "utf8"));
    rowsB = parseSnapshot(readFileSync(argv[1], "utf8"));
  } else {
    console.error("用法：node scripts/compare-env-snapshots.mjs --run\n   或：node scripts/compare-env-snapshots.mjs <prod 檔案> <staging 檔案>");
    return 2;
  }
  const report = diffSnapshots(rowsA, rowsB);
  console.log(`${labelA}: ${rowsA.length} 列，${labelB}: ${rowsB.length} 列`);
  console.log(formatReport(report, labelA, labelB));
  return report.unexpected.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
