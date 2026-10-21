// #609：repo 是公開的，Supabase project ref 與 Google 試算表 ID 不能出現在任何已追蹤的檔案裡。
// 不需要知道真正的 ref：抓「長得像 ref 的值」（20 碼小寫英數 + .supabase.co／--project-ref 後面），
// 只放行明確的假值。真值放 .env（見 docs/staging.md）。
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { FAKE_PRODUCTION_REF, FAKE_STAGING_REF } from "../vitest.shared.mjs";

const ALLOWED_REFS = new Set([FAKE_PRODUCTION_REF, FAKE_STAGING_REF]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".mp3", ".mp4", ".pdf", ".zip", ".gz", ".lock"]);
const MAX_BYTES = 3 * 1024 * 1024;

const HOST_RE = /(?<![a-z0-9])([a-z0-9]{20})\.supabase\.co(?![a-z0-9])/g;
const FLAG_RE = /--project-ref[ =]["']?([a-z0-9]{20})(?![a-z0-9])/g;
const SHEET_RE = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/g;

/** 掃一段文字，回傳不被允許的「像 ref／ID 的值」（只回前後文，不回整個值，避免測試輸出又印出真值）。 */
export function findForbiddenIds(text) {
  const found = [];
  for (const re of [HOST_RE, FLAG_RE]) {
    for (const match of text.matchAll(re)) {
      if (!ALLOWED_REFS.has(match[1])) found.push(`${match[0].slice(0, 6)}…（project ref）`);
    }
  }
  for (const match of text.matchAll(SHEET_RE)) found.push("spreadsheets/d/…（試算表 ID）");
  return found;
}

function trackedTextFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean).filter((path) => {
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return false;
    try {
      return statSync(path).size <= MAX_BYTES;
    } catch (_err) {
      return false; // 已追蹤但工作樹裡不存在
    }
  });
}

// 範例值用拼接的，讓這個測試檔本身也通過自己的掃描
const SAMPLE_REF = ["abcdefghij", "klmnopqrst"].join("");
const SAMPLE_SHEET_ID = ["1AbCdEfGhI", "jKlMnOpQrS", "tUvWxYz"].join("");

describe("findForbiddenIds", () => {
  it("抓得到 ref 形狀的值，放行假值與占位符", () => {
    expect(findForbiddenIds(`https://${SAMPLE_REF}.supabase.co/functions/v1/x`)).toHaveLength(1);
    expect(findForbiddenIds(`npx supabase db push --project-ref ${SAMPLE_REF}`)).toHaveLength(1);
    expect(findForbiddenIds(`https://docs.google.com/spreadsheets/d/${SAMPLE_SHEET_ID}/edit`)).toHaveLength(1);
    expect(findForbiddenIds(`https://${FAKE_STAGING_REF}.supabase.co`)).toEqual([]);
    expect(findForbiddenIds("https://YOUR-PROJECT-REF.supabase.co https://placeholder.supabase.co https://example.supabase.co")).toEqual([]);
    expect(findForbiddenIds("https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit")).toEqual([]);
    expect(findForbiddenIds("--project-ref <ref> --project-ref x")).toEqual([]);
  });

  it("輸出不含完整的值", () => {
    const [hit] = findForbiddenIds(`https://${SAMPLE_REF}.supabase.co`);
    expect(hit).not.toContain(SAMPLE_REF);
  });
});

describe("repo 內沒有 project ref／試算表 ID（#609）", () => {
  it("所有已追蹤的文字檔都乾淨", () => {
    const offenders = [];
    for (const path of trackedTextFiles()) {
      const hits = findForbiddenIds(readFileSync(path, "utf8"));
      if (hits.length) offenders.push(`${path}: ${[...new Set(hits)].join("、")}`);
    }
    expect(offenders, `這些檔案含有不該公開的 ID，改成讀 .env／占位符（見 docs/staging.md）：\n${offenders.join("\n")}`).toEqual([]);
  });
});
