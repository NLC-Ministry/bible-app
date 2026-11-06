// #664：同一台裝置換了登入方式，驗證舊的登入方式後把計畫找回來。
//
//   1. 提示卡的主按鈕 → startPlanRecovery：向 recover-plan 拿一次性的 nonce，帶 prompt=login、max_age=0
//      跳到 Logto。本機的登入狀態不動。
//   2. 登入回來 → finishPlanRecoveryAfterCallback：舊方式的 token 只放記憶體，先顯示確認畫面，
//      不等會友回答就讓開機走下去。按「確認找回」才送出，伺服器驗過並合併，成功後才換 token、重新載入。
//   3. 按取消、中途取消、重新整理、離開 → 舊方式的 token 就消失了，會友還是原本的登入狀態。
//
// 裝置紀錄只決定要不要顯示提示卡；真正合併的依據是兩個都由伺服器驗過的 token。
// 伺服器還沒部署或出錯時，這裡只顯示訊息，不丟例外、不動登入狀態。
import { readLastLoginMethod } from "./login-method-memory.mjs";
import { currentLoginMethod } from "./modules/account-switch-hint.mjs";
import { fetchWithTimeout } from "./net-timeout.mjs";

const REQUEST_TIMEOUT_MS = 12000;
const COMPLETE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function defaultAuth() {
  return typeof window !== "undefined" ? window.auth : null;
}

function defaultConfig() {
  return (typeof state !== "undefined" && state.supabaseConfig) || null;
}

function planRecoveryCopy() {
  return (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.planRecovery) || {};
}

/** 要不要改顯示「找回」版的提示卡。只看裝置紀錄，不是合併的依據。回傳 { method, masked } 或 null。 */
export function planRecoveryOffer(appState, { storage, now = Date.now() } = {}) {
  const record = readLastLoginMethod({ ...(storage ? { storage } : {}), now });
  if (!record || !record.method || !record.masked) return null;
  if (record.profileId && record.profileId === appState?.currentProfileId) return null;
  const current = currentLoginMethod(appState?.currentUser);
  if (current.method === record.method && current.masked === record.masked) return null;
  return { method: record.method, masked: record.masked };
}

async function postRecoverPlan(config, body, { fetchImpl = fetchWithTimeout } = {}) {
  const url = `${String(config.url).replace(/\/+$/, "")}/functions/v1/recover-plan`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, REQUEST_TIMEOUT_MS);
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload: payload && typeof payload === "object" ? payload : {} };
}

export function planRecoveryMessage(code) {
  const copy = planRecoveryCopy();
  const messages = {
    merged: copy.merged || "已找回你的計畫和閱讀紀錄。之後用之前或現在的方式登入都可以。",
    cancelled: copy.cancelled || "這次沒有完成確認，你的資料都沒有變動。想再試一次時，可以再按一次「找回我的計畫」。",
    same_account: copy.sameMethod || "剛才登入的還是現在這個方式，所以沒有找到計畫。請換成你之前用的方式再試一次。",
    not_eligible: copy.notEligible || "這個方式沒有辦法自動找回計畫。如果你的計畫還是不見，請找教會同工協助。",
    rate_limited: copy.rateLimited || "嘗試太多次了，請過一段時間再試。",
    unavailable: copy.unavailable || "暫時無法找回計畫，請稍後再試。你現在的登入狀態沒有變動。",
    failed: copy.failed || "暫時無法完成找回，請稍後再試，還是不行請找教會同工協助。"
  };
  return messages[code] || messages.failed;
}

/**
 * 確認畫面的說明。遮罩取自剛登入的 id_token，只用來顯示：
 * 裝置紀錄不一定是剛才登入的那個帳號，不能拿來告訴會友他用什麼確認了身分。
 * #682：id_token 分不出密碼、Google、LINE，所以只說帳號，不斷定登入方式。
 */
export function planRecoveryConfirmBody(idClaims) {
  const copy = planRecoveryCopy();
  const { method, masked } = currentLoginMethod({ phone: idClaims?.phone_number, email: idClaims?.email });
  if (!method) {
    return copy.confirmBodyUnknown || "你已完成身分確認。找回後，用之前或現在的方式登入都會看到同一份計畫和閱讀紀錄，這個動作無法復原。如果這不是你的計畫，請按取消。";
  }
  const template = copy.confirmBody || "你已用 {account} 確認身分。找回後，用之前或現在的方式登入都會看到同一份計畫和閱讀紀錄，這個動作無法復原。如果這不是你的計畫，請按取消。";
  return template.replace("{account}", () => masked);
}

/**
 * 主按鈕。回傳 { ok: true }（正在跳轉）或 { ok: false, code, message }（留在原畫面）。
 * 這一步失敗時什麼都沒變：沒有跳轉、登入狀態不動。
 */
export async function startPlanRecovery({
  auth = defaultAuth(),
  config = defaultConfig(),
  fetchImpl
} = {}) {
  const fail = code => {
    try {
      auth?.clearPlanRecoveryFlow?.();
    } catch (_) {}
    return { ok: false, code, message: planRecoveryMessage(code) };
  };
  try {
    if (!auth?.startPlanRecoveryLogin || !config?.url) return fail("unavailable");
    const sourceToken = await auth.getValidAccessToken(false);
    const { status, payload } = await postRecoverPlan(config, { action: "start", source_token: sourceToken }, { fetchImpl });
    if (status !== 200 || !payload.ok || !payload.nonce) {
      return fail(payload.error === "rate_limited" || payload.error === "not_eligible" ? payload.error : "unavailable");
    }
    // 從 Logto 按返回、瀏覽器還原這一頁（bfcache）：頁面不會重跑開機流程，登入流程要在這裡清
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", event => {
        if (event.persisted) abandonPlanRecovery({ auth });
      }, { once: true });
    }
    await auth.startPlanRecoveryLogin({ nonce: payload.nonce });
    return { ok: true };
  } catch (err) {
    console.warn("Plan recovery could not start:", err?.message || "unknown");
    return fail("unavailable");
  }
}

/** 會友沒回來：清掉這次的登入流程。登入狀態本來就沒動。 */
export function abandonPlanRecovery({ auth = defaultAuth() } = {}) {
  try {
    auth?.clearPlanRecoveryFlow?.();
  } catch (_) {}
}

// actions 由左到右，每個 { label, primary, onClick }。全部用 textContent，掛在 body 頂層。
function showDialog({ title, body, actions }) {
  const overlay = document.createElement("div");
  overlay.id = "plan-recovery-result";
  overlay.className = "custom-confirm-overlay active";
  overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:var(--z-critical,900);padding:20px;";
  overlay.innerHTML = `
    <div class="custom-confirm-card" role="dialog" aria-modal="true" aria-labelledby="plan-recovery-result-title">
      <div class="custom-confirm-content">
        <h3 class="custom-confirm-title" id="plan-recovery-result-title"></h3>
        <p class="custom-confirm-desc"></p>
      </div>
      <div class="custom-confirm-actions"></div>
    </div>
  `;
  overlay.querySelector(".custom-confirm-title").textContent = title;
  overlay.querySelector(".custom-confirm-desc").textContent = body;
  const row = overlay.querySelector(".custom-confirm-actions");
  for (const { label, primary, onClick } of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "custom-confirm-btn-confirm primary-btn" : "custom-confirm-btn-cancel secondary-btn";
    button.textContent = label;
    button.onclick = () => {
      overlay.remove();
      onClick?.();
    };
    row.appendChild(button);
  }
  document.body.appendChild(overlay);
}

function showResultDialog(message, { onClose } = {}) {
  if (typeof document === "undefined" || !document.body) {
    onClose?.();
    return;
  }
  const copy = planRecoveryCopy();
  showDialog({
    title: copy.dialogTitle || "找回你的計畫",
    body: message,
    actions: [{ label: copy.dialogOk || "知道了", primary: true, onClick: onClose }]
  });
}

function showConfirmDialog(body) {
  const copy = planRecoveryCopy();
  return new Promise(resolve => {
    showDialog({
      title: copy.confirmTitle || "確認找回你的計畫",
      body,
      actions: [
        { label: copy.confirmCancelCta || "取消", onClick: () => resolve(false) },
        { label: copy.confirmCta || "確認找回", primary: true, onClick: () => resolve(true) }
      ]
    });
  });
}

async function sendCompletion({ config, body, fetchImpl, sleep }) {
  for (let attempt = 0; attempt < COMPLETE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const { status, payload } = await postRecoverPlan(config, body, { fetchImpl });
      if (status === 200 && payload.ok) return "merged";
      // 等不到鎖、JWKS 連不上：可以重試，伺服器保證同一個 nonce 不會合併第二次
      if (status !== 503) return payload.error || "failed";
    } catch (_) {
      // 連不上或逾時：合併可能其實成功了，重試會拿到成功
    }
  }
  return "failed";
}

function setLoader(message) {
  const loader = typeof window !== "undefined" ? window.loader : null;
  try {
    if (message) loader?.show?.(message);
    else loader?.hide?.();
  } catch (_) {}
}

function reloadApp() {
  window.location.replace(window.location.pathname + window.location.hash);
}

/**
 * 開機時在 handleCallback 之後呼叫，不要 await：這個 promise 要等會友回答確認畫面才會結束。
 * 不是找回流程回傳 null；按取消回傳 { status: "declined" }，不再多跳一個訊息。
 * 不會丟例外：任何情況都留在目前的登入狀態。
 */
export async function finishPlanRecoveryAfterCallback({
  auth = defaultAuth(),
  config = defaultConfig(),
  fetchImpl,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  confirm = showConfirmDialog,
  showResult = showResultDialog,
  reload = reloadApp
} = {}) {
  let status;
  try {
    const outcome = auth?.consumePlanRecoveryOutcome?.() || null;
    if (!outcome) {
      auth?.clearPlanRecoveryFlow?.();
      return null;
    }

    if (outcome === "cancelled") {
      status = "cancelled";
    } else {
      const tokens = auth.takePlanRecoveryTokens();
      if (!config?.url || !tokens?.access_token || !tokens?.id_token) {
        status = "failed";
      } else {
        if (!await confirm(planRecoveryConfirmBody(auth._parseJwt(tokens.id_token)))) {
          return { status: "declined" };
        }
        setLoader(planRecoveryCopy().working || "正在找回你的計畫...");
        const sourceToken = await auth.getValidAccessToken(false);
        status = await sendCompletion({
          config,
          fetchImpl,
          sleep,
          body: {
            action: "complete",
            source_token: sourceToken,
            target_access_token: tokens.access_token,
            target_id_token: tokens.id_token
          }
        });
        setLoader(null);
        if (status === "merged") {
          auth.commitPlanRecoveryTokens(tokens);
          // 現在換成舊的登入方式了，上一個方式留在裝置上的資料不能混進來
          await auth.clearAccountLocalData?.();
        }
      }
    }
  } catch (err) {
    console.warn("Plan recovery could not finish:", err?.message || "unknown");
    setLoader(null);
    status = "failed";
  }
  try {
    showResult(planRecoveryMessage(status), status === "merged" ? { onClose: reload } : {});
  } catch (_) {}
  return { status };
}
