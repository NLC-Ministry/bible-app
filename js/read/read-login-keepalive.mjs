// /read 空閒時默默續期（#416）：經文顯示完才做、不顯示任何東西、失敗就算了。
// 只用讀經頁的人登入也不會慢慢過期，按「回計畫」時仍是快速進入。
// 手機上沒有 refresh token 就什麼都不做——絕不會在這裡觸發登入流程。
// 續期本體是 auth.js 的 refreshTokens()：軟逾時、跨分頁鎖、被拒只清 token（#415、#417）。

export const REFRESH_TOKEN_KEY = "nlc_refresh_token";
export const TOKEN_EXPIRES_AT_KEY = "nlc_token_expires_at";
// access token 剩不到這麼久就續（跟 auth.js 主動續期的提前量一致）。
export const KEEPALIVE_WINDOW_MS = 6 * 60 * 1000;

export function needsBackgroundRefresh(storage, now = Date.now()) {
  let refreshToken = null;
  let expiresAt = 0;
  try {
    refreshToken = storage.getItem(REFRESH_TOKEN_KEY);
    expiresAt = Number(storage.getItem(TOKEN_EXPIRES_AT_KEY) || 0);
  } catch {
    return false;
  }
  if (!refreshToken) return false;
  return !Number.isFinite(expiresAt) || now > expiresAt - KEEPALIVE_WINDOW_MS;
}

export async function keepLoginFresh({ storage, loadAuth, now = Date.now() }) {
  if (!needsBackgroundRefresh(storage, now)) return "skipped";
  try {
    const auth = await loadAuth();
    if (!auth || typeof auth.refreshTokens !== "function") return "unavailable";
    const result = await auth.refreshTokens();
    if (result === true) return "refreshed";
    if (result === false) return "rejected";
    return "unavailable";
  } catch {
    return "failed";
  }
}
