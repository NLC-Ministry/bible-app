// 站內導回路徑的唯一驗證點（?return= 等參數）。
// 只用字串開頭判斷擋不住 `/\evil.com`（瀏覽器把 `\` 當 `/`），所以交給 URL 解析，
// 解析後 origin 不同一律拒絕；通過才回傳站內的 pathname + search + hash。
export function resolveSafeReturnPath(raw, origin) {
  if (typeof raw !== "string" || !raw || typeof origin !== "string" || !origin) return null;
  // 只接受以單一 `/` 開頭的站內路徑；`//`、`/\`、`\` 開頭與絕對網址一律不收。
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return null;
  try {
    const base = new URL(origin);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch (_) {
    return null;
  }
}
