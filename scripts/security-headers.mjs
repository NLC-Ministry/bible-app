// 整站安全標頭（#553）：vercel.json 的 Content-Security-Policy-Report-Only 用雜湊放行行內腳本，
// 這支負責算出那些雜湊。改了任何 HTML 的行內 <script> 之後跑：
//   node scripts/security-headers.mjs
// 把印出的 'sha256-…' 換進 vercel.json；scripts/security-headers.test.mjs 會擋住沒更新的雜湊。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 會出現在正式站的 HTML 入口（建置只改 <script src>／<link>，行內腳本原樣保留）
export const HTML_ENTRY_FILES = ["index.html", "read.html", "exam.html", "grade.html", "repair.html"];

const INLINE_SCRIPT_RE = /<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

// 瀏覽器對行內腳本的「文字內容」逐字算雜湊。Windows 本機是 CRLF、CI／Vercel 是 LF，
// 一律以 LF 計算（部署的是 CI 檢出的版本）。
export function inlineScriptHashes(html) {
  const text = String(html).replace(/\r\n/g, "\n");
  return [...text.matchAll(INLINE_SCRIPT_RE)]
    .map((match) => match[1])
    .filter((body) => body.trim().length > 0)
    .map((body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
}

export function collectInlineScriptHashes(root) {
  const hashes = new Set();
  for (const file of HTML_ENTRY_FILES) {
    for (const hash of inlineScriptHashes(readFileSync(join(root, file), "utf8"))) hashes.add(hash);
  }
  return [...hashes];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(collectInlineScriptHashes(root).join(" "));
}
