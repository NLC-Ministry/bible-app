// 身分快照（localStorage offline_trusted_identity）：上次跟 nlc-session 確認過的會員資料。
// 開機時拿它先把畫面打開（背景再同步），離線時拿它進離線讀經。它只是顯示用的資料、
// 不是登入憑證——真正的權限檢查都在伺服器端驗 token。
//
// #417：快照記住是哪個 Logto 帳號（logtoSub）。手機上有 token 時，只有同一個帳號的快照
// 才能用；否則同一支手機換人登入時，會先閃出上一個人的姓名、計畫、進度。

export const OFFLINE_IDENTITY_KEY = "offline_trusted_identity";
export const OFFLINE_IDENTITY_SCHEMA_VERSION = 2;
export const OFFLINE_IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function buildOfflineIdentity({ profile, lockedFields = [], logtoSub = null, now = Date.now() }) {
  if (!profile?.id) return null;
  return {
    schemaVersion: OFFLINE_IDENTITY_SCHEMA_VERSION,
    verifiedAt: new Date(now).toISOString(),
    logtoSub: logtoSub || null,
    profile,
    lockedFields: Array.isArray(lockedFields) ? lockedFields : []
  };
}

export function parseOfflineIdentity(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// 回傳可以用的快照，不能用就回 null。
// - hasTokens：手機上有登入 token。此時一定要有 currentSub 且跟快照的 logtoSub 相同；
//   舊版快照（沒有 logtoSub）或讀不出目前帳號都不用（寧可多等一次同步，也不要顯示錯的人）。
// - 沒有 token（離線、token 已被清掉）：沒有東西可比對，沿用原本的規則，可用來離線讀經。
export function resolveUsableOfflineIdentity(identity, {
  hasTokens = false,
  currentSub = null,
  now = Date.now(),
  maxAgeMs = OFFLINE_IDENTITY_MAX_AGE_MS
} = {}) {
  if (!identity?.profile?.id) return null;
  const verifiedAt = Date.parse(identity.verifiedAt || "");
  if (!Number.isFinite(verifiedAt) || now - verifiedAt > maxAgeMs) return null;
  if (hasTokens) {
    if (!currentSub || !identity.logtoSub || identity.logtoSub !== currentSub) return null;
  }
  return identity;
}
