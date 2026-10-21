// 兩個 Supabase 專案（正式站、staging）的 project ref 不寫進 repo（公開，#609）。
// 來源：環境變數 SUPABASE_PRODUCTION_REF／SUPABASE_STAGING_REF；本機沒設時讀 .env
// （先找這份 repo 的根目錄，再找 git worktree 對應的主資料夾，兩邊都沒有就視為沒設）。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const REF_ENV_NAMES = Object.freeze({
  production: "SUPABASE_PRODUCTION_REF",
  staging: "SUPABASE_STAGING_REF"
});

const REF_RE = /^[a-z0-9]{20}$/;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 解析 .env 文字（# 註解、KEY=value、可有引號）。 */
export function parseDotEnv(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const at = trimmed.indexOf("=");
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

/** 這份 checkout 的主資料夾（worktree 時是 .git 所在的那份）；找不到回 null。 */
function mainCheckoutRoot(root) {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  const gitDir = String(result.stdout || "").trim();
  return gitDir ? dirname(gitDir) : null;
}

function readDotEnvFrom(dir) {
  const path = join(dir, ".env");
  return existsSync(path) ? parseDotEnv(readFileSync(path, "utf8")) : null;
}

/**
 * 讀出兩個 ref。優先順序：環境變數 → root 的 .env → 主資料夾的 .env。
 * 回傳 { production, staging }，沒設定的是空字串（呼叫端用 requireProjectRef 擋）。
 */
export function loadProjectRefs({ env = process.env, root = REPO_ROOT } = {}) {
  const refs = { production: "", staging: "" };
  let dotEnv = null;
  for (const [name, key] of Object.entries(REF_ENV_NAMES)) {
    let value = String(env[key] ?? "").trim();
    if (!value) {
      if (dotEnv === null) {
        const main = readDotEnvFrom(root) ?? ((mainRoot) => (mainRoot ? readDotEnvFrom(mainRoot) : null))(mainCheckoutRoot(root));
        dotEnv = main || {};
      }
      value = String(dotEnv[key] ?? "").trim();
    }
    refs[name] = REF_RE.test(value) ? value : "";
  }
  return refs;
}

/** 取某個環境的 ref；沒設定就丟出說明怎麼設的錯誤（絕不退回寫死的值）。 */
export function requireProjectRef(environment, refs = loadProjectRefs()) {
  const key = REF_ENV_NAMES[environment];
  if (!key) throw new Error(`不認得的環境：${environment}（只有 staging、production）`);
  const ref = refs[environment];
  if (!ref) {
    throw new Error(`沒有設定 ${key}。請在專案主資料夾的 .env 加一行 ${key}=<20 碼 project ref>（或設成環境變數）。ref 不放進 repo，見 docs/staging.md。`);
  }
  return ref;
}

/** 這個 ref 屬於哪個環境；都不是回 null。 */
export function environmentOfRef(ref, refs = loadProjectRefs()) {
  if (!ref) return null;
  if (ref === refs.production) return "production";
  if (ref === refs.staging) return "staging";
  return null;
}
