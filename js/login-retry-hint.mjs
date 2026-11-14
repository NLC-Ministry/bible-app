// #707：會友在教會登入頁（Logto）卡住——頁面放太久或回到已結束的頁面，按 Google／LINE
// 只跳「未找到會話」。那一頁 App 管不到（Logto 全站 CSS 已在提示後補一句「關掉回 App」）；
// 會友回到 App 時，如果剛才開始的登入沒有回來，就在登入按鈕上方提醒再按一次。
//
// 開始時間由 auth._redirectToAuthorization 記（找回計畫的登入不記），和其他登入流程暫存一起
// 由 _clearFlowState 清掉：登入成功、失敗、登出、再按一次登入都會清。
export const LOGIN_FLOW_STARTED_AT_KEY = "nlc_auth_flow_started_at"; // 同 auth.js 的 keys.flowStartedAt
const PLAN_RECOVERY_FLOW_KEY = "nlc_auth_plan_recovery"; // 同 auth.js 的 keys.planRecoveryFlow
// 按下登入到頁面離開之間不算：太快回來多半是跳轉還沒完成，或會友自己馬上按返回。
export const MIN_AWAY_MS = 5 * 1000;
// 太久以前開始的登入不說「剛才」。Logto 的登入流程約一小時失效，留足夠寬的範圍。
export const MAX_AWAY_MS = 12 * 60 * 60 * 1000;
const CALLBACK_PARAMS = ["code", "state", "error"];
const DEFAULT_TEXT = "剛才沒有登入成功嗎？再按一次「登入」就可以了。登入頁如果出現「未找到會話」，也是這樣處理。";

function defaultStorage() {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function defaultSearch() {
  return typeof window !== "undefined" && window.location ? window.location.search : "";
}

/** 剛才開始的登入沒有回來（沒有登入結果、不是找回計畫、時間在範圍內）。 */
export function hasAbandonedLoginFlow({ storage = defaultStorage(), now = Date.now(), search = defaultSearch() } = {}) {
  if (!storage) return false;
  try {
    const params = new URLSearchParams(String(search || ""));
    // 有登入結果就交給 handleCallback：成功會進 App，失敗會顯示原因。
    if (CALLBACK_PARAMS.some(key => params.has(key))) return false;
    if (storage.getItem(PLAN_RECOVERY_FLOW_KEY)) return false;
    const startedAt = Number(storage.getItem(LOGIN_FLOW_STARTED_AT_KEY));
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    const away = now - startedAt;
    return away >= MIN_AWAY_MS && away <= MAX_AWAY_MS;
  } catch (_) {
    return false;
  }
}

export function loginRetryHintText() {
  const copy = typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.loginRetryHint;
  return (copy && copy.text) || DEFAULT_TEXT;
}

/** 畫在登入卡上；visible=false 用在不是要會友按登入的畫面（沒註冊、資料讀不到等）。 */
export function renderLoginRetryHint(loginGate, { visible = true, ...options } = {}) {
  const el = loginGate && typeof loginGate.querySelector === "function"
    ? loginGate.querySelector("[data-login-retry-hint]")
    : null;
  if (!el) return;
  const show = visible && hasAbandonedLoginFlow(options);
  if (show) el.textContent = loginRetryHintText();
  el.classList.toggle("hidden", !show);
}

/**
 * 從瀏覽器的上一頁快取（bfcache）回來時頁面不會重跑開機，登入卡停在離開前的樣子：
 * 登入卡顯示中、而且是要會友按登入的畫面，才重新判斷一次。
 */
export function refreshLoginRetryHint(loginGate, options = {}) {
  if (!loginGate || loginGate.classList.contains("hidden")) return;
  const button = loginGate.querySelector("#btn-gate-nlc-login");
  const mode = button && button.dataset ? button.dataset.loginGateMode : "";
  renderLoginRetryHint(loginGate, { ...options, visible: !mode || mode === "sso" });
}
