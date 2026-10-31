// #645：曾經登入過的人 token 失效時，不先顯示登入卡，直接轉去 SSO。
// Logto 那邊還登入著就無感回到 App；也過期了就直接落在 Logto 登入頁。
//
// 不轉的情況：
// - 第一次來（本機沒有 30 天內的身分快照）：照舊顯示歡迎卡。主動登出會清掉快照，也不轉。
// - LINE／FB 等內建瀏覽器：照現有規則先顯示「請用瀏覽器開啟」。
// - 離線：照現有規則走離線閱讀。
// - 5 分鐘內已經自動轉過一次：轉過去回來還是失效，就改顯示登入卡，不會無限轉。
// 會員中心阻擋狀態（缺姓名等）不會走到這裡，那是 applyLoginGateView 的畫面。
import { detectAuthenticationEnvironment, shouldGateInteractiveAuth } from "./auth-environment.js";
import { OFFLINE_IDENTITY_KEY, parseOfflineIdentity, resolveUsableOfflineIdentity } from "./data/offline-identity.mjs";

export const AUTO_SSO_REDIRECT_KEY = "nlc_auto_sso_redirect_at";
export const AUTO_SSO_REDIRECT_COOLDOWN_MS = 5 * 60 * 1000;

export function shouldAutoRedirectToSso({ hasIdentitySnapshot, embedded, online, lastRedirectAt, now }) {
  if (!hasIdentitySnapshot || embedded || !online) return false;
  const last = Number(lastRedirectAt) || 0;
  return now - last > AUTO_SSO_REDIRECT_COOLDOWN_MS;
}

function isEmbeddedBrowser() {
  try {
    return shouldGateInteractiveAuth(detectAuthenticationEnvironment(), { authEnvironmentAcknowledged: false });
  } catch (_) {
    return false;
  }
}

function defaultLaunch() {
  const launcher = typeof window !== "undefined" ? window.authLaunch : null;
  if (launcher && typeof launcher.startInteractiveAuth === "function") {
    return launcher.startInteractiveAuth({ intent: "login", returnTo: "/" });
  }
  return false;
}

/** 符合條件就記下時間並轉去 SSO，回傳 true；不轉就回 false，由呼叫端顯示登入卡。 */
export function maybeAutoRedirectToSso({
  storage = typeof localStorage !== "undefined" ? localStorage : null,
  online = typeof navigator === "undefined" || navigator.onLine !== false,
  embedded = isEmbeddedBrowser(),
  now = Date.now(),
  launch = defaultLaunch,
  beforeLaunch = null
} = {}) {
  if (!storage) return false;
  let identity = null;
  let lastRedirectAt = 0;
  try {
    identity = resolveUsableOfflineIdentity(parseOfflineIdentity(storage.getItem(OFFLINE_IDENTITY_KEY)), { hasTokens: false, now });
    lastRedirectAt = Number(storage.getItem(AUTO_SSO_REDIRECT_KEY) || 0);
  } catch (_) {
    return false;
  }
  if (!shouldAutoRedirectToSso({ hasIdentitySnapshot: !!identity, embedded, online, lastRedirectAt, now })) return false;
  // 記不下時間就沒辦法防循環，寧可顯示登入卡。
  try {
    storage.setItem(AUTO_SSO_REDIRECT_KEY, String(now));
  } catch (_) {
    return false;
  }
  // 先換成乾淨的登入畫面再轉：轉址失敗（抓不到 Logto 設定等）時畫面上至少有登入按鈕。
  if (typeof beforeLaunch === "function") {
    try { beforeLaunch(); } catch (_) {}
  }
  return launch() !== false;
}
