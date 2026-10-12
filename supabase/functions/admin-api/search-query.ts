// 搜尋字的規則（#547）：admin-api（policy.ts）和後台畫面（admin/src/views/UserSearch.tsx）共用。
// 獨立成一個沒有其他 import 的檔案：後台畫面只會打包到這幾行，不會把 admin-api 的伺服器程式一起帶進去。
// CJK 統一表意文字（含擴充 A）與相容表意文字
const CJK_RE = /[㐀-鿿豈-﫿]/;

/** 搜尋字串：去頭尾空白後至少 1 個中日韓文字或 2 個英數字，最多 100 字。 */
export function validateSearchQuery(value: unknown): { ok: true; query: string } | { ok: false; error: string } {
  const query = typeof value === "string" ? value.trim() : "";
  if (query.length > 100) return { ok: false, error: "query_too_long" };
  const alnum = query.replace(/[^A-Za-z0-9]/g, "").length;
  if (!CJK_RE.test(query) && alnum < 2) return { ok: false, error: "query_too_short" };
  return { ok: true, query };
}
