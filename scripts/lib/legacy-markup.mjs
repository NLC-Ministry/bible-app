// 後台照搬頁（admin-legacy/）的畫面來源（#551）：App 的 index.html，管理分頁那段換成
// admin-legacy/admin-view.html（照搬的舊管理分頁＋全域計畫管理卡）。
// scripts/build-admin.mjs 用它組 iframe 頁；舊管理區塊的測試用 readLegacyIndexHtml() 讀同一份畫面。
// 不 import esbuild 等建置工具，jsdom 測試也能直接用。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ADMIN_VIEW_START = "<!-- admin-view:start -->";
export const ADMIN_VIEW_END = "<!-- admin-view:end -->";

/** 兩個標記各出現一次，中間整段換掉；標記不對就丟錯（不要悄悄組出少一塊的頁面）。 */
export function composeLegacyIndexHtml(indexHtml, legacyAdminViewHtml) {
  const html = String(indexHtml || "");
  const start = html.indexOf(ADMIN_VIEW_START);
  const end = html.indexOf(ADMIN_VIEW_END);
  if (start === -1 || end === -1 || end < start
    || html.indexOf(ADMIN_VIEW_START, start + 1) !== -1 || html.indexOf(ADMIN_VIEW_END, end + 1) !== -1) {
    throw new Error(`build-admin: index.html must contain ${ADMIN_VIEW_START} … ${ADMIN_VIEW_END} exactly once`);
  }
  return html.slice(0, start) + String(legacyAdminViewHtml || "") + html.slice(end + ADMIN_VIEW_END.length);
}

export function readLegacyAdminView(root) {
  return readFileSync(join(root, "admin-legacy", "admin-view.html"), "utf8");
}

/** 舊管理程式看到的完整 index.html。 */
export function readLegacyIndexHtml(root = process.cwd()) {
  return composeLegacyIndexHtml(readFileSync(join(root, "index.html"), "utf8"), readLegacyAdminView(root));
}
