// #664：同一台裝置換了登入方式，驗證舊的登入方式後把計畫找回來。
//
//   1. 提示卡的主按鈕 → startPlanRecovery：向 recover-plan 拿一次性的 nonce，把現在這個登入的
//      access token 暫存進 sessionStorage，帶 prompt=login 跳到 Logto。本機的登入狀態不動。
//   2. 登入回來 → finishPlanRecoveryAfterCallback：把暫存的 token 和剛拿到的 token 一起送出，
//      由伺服器驗過並合併。暫存的 token 一讀出來就從 sessionStorage 刪掉。
//   3. 沒回來（取消、按返回、關掉）→ abandonPlanRecovery：清掉暫存，回到原本的狀態。
//
// 裝置紀錄只決定要不要顯示提示卡；真正合併的依據是兩個都由伺服器驗過的 token。
// 伺服器還沒部署或出錯時，這裡只顯示訊息，不丟例外、不動登入狀態。
import { readLastLoginMethod } from "./login-method-memory.mjs";
import { currentLoginMethod } from "./modules/account-switch-hint.mjs";
import { fetchWithTimeout } from "./net-timeout.mjs";

export const PLAN_RECOVERY_STASH_KEY = "nlc_plan_recovery_source";
const REQUEST_TIMEOUT_MS = 12000;
const COMPLETE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function defaultSessionStorage() {
  return typeof sessionStorage !== "undefined" ? sessionStorage : null;
}

function defaultAuth() {
  return typeof window !== "undefined" ? window.auth : null;
}

function defaultConfig() {
  return (typeof state !== "undefined" && state.supabaseConfig) || null;
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

function clearStash(storage) {
  try {
    storage?.removeItem(PLAN_RECOVERY_STASH_KEY);
  } catch (_) {}
}

function takeStash(storage) {
  try {
    const raw = storage?.getItem(PLAN_RECOVERY_STASH_KEY);
    clearStash(storage);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.sourceToken === "string" ? parsed : null;
  } catch (_) {
    clearStash(storage);
    return null;
  }
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
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.planRecovery) || {};
  const messages = {
    merged: copy.merged || "已找回你的計畫和閱讀紀錄。之後用手機或 Email 登入都可以。",
    cancelled: copy.cancelled || "這次沒有完成確認，你的資料都沒有變動。想再試一次時，可以再按一次「找回我的計畫」。",
    same_account: copy.sameMethod || "剛才登入的還是現在這個方式，所以沒有找到計畫。請換成你之前用的方式再試一次。",
    not_eligible: copy.notEligible || "這個方式沒有辦法自動找回計畫。如果你的計畫還是不見，請找教會同工協助。",
    rate_limited: copy.rateLimited || "嘗試太多次了，請過一段時間再試。",
    incomplete: copy.incomplete || "這次沒有完成找回。你現在是用剛才確認的方式登入，看到的是這個方式裡的計畫。",
    unavailable: copy.unavailable || "暫時無法找回計畫，請稍後再試。你現在的登入狀態沒有變動。",
    failed: copy.failed || "暫時無法完成找回，請稍後再試，還是不行請找教會同工協助。"
  };
  return messages[code] || messages.failed;
}

/**
 * 主按鈕。回傳 { ok: true }（正在跳轉）或 { ok: false, code, message }（留在原畫面）。
 * 這一步失敗時什麼都沒變：沒有暫存、沒有跳轉、登入狀態不動。
 */
export async function startPlanRecovery({
  auth = defaultAuth(),
  config = defaultConfig(),
  storage = defaultSessionStorage(),
  fetchImpl
} = {}) {
  const fail = code => {
    clearStash(storage);
    try {
      auth?.clearPlanRecoveryFlow?.();
    } catch (_) {}
    return { ok: false, code, message: planRecoveryMessage(code) };
  };
  try {
    if (!auth?.startPlanRecoveryLogin || !config?.url || !storage) return fail("unavailable");
    const sourceToken = await auth.getValidAccessToken(false);
    const { status, payload } = await postRecoverPlan(config, { action: "start", source_token: sourceToken }, { fetchImpl });
    if (status !== 200 || !payload.ok || !payload.nonce) {
      return fail(payload.error === "rate_limited" || payload.error === "not_eligible" ? payload.error : "unavailable");
    }
    storage.setItem(PLAN_RECOVERY_STASH_KEY, JSON.stringify({ sourceToken }));
    // 從 Logto 按返回、瀏覽器還原這一頁（bfcache）：頁面不會重跑開機流程，暫存要在這裡清
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", event => {
        if (event.persisted) abandonPlanRecovery({ auth, storage });
      }, { once: true });
    }
    await auth.startPlanRecoveryLogin({ nonce: payload.nonce });
    return { ok: true };
  } catch (err) {
    console.warn("Plan recovery could not start:", err?.message || "unknown");
    return fail("unavailable");
  }
}

/** 會友沒回來：清掉暫存的 token 與這次的登入流程。登入狀態本來就沒動。 */
export function abandonPlanRecovery({ auth = defaultAuth(), storage = defaultSessionStorage() } = {}) {
  clearStash(storage);
  try {
    auth?.clearPlanRecoveryFlow?.();
  } catch (_) {}
}

function showResultDialog(message) {
  if (typeof document === "undefined" || !document.body) return;
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.planRecovery) || {};
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
      <div class="custom-confirm-actions">
        <button type="button" class="custom-confirm-btn-confirm primary-btn"></button>
      </div>
    </div>
  `;
  overlay.querySelector(".custom-confirm-title").textContent = copy.dialogTitle || "找回你的計畫";
  overlay.querySelector(".custom-confirm-desc").textContent = message;
  const close = overlay.querySelector(".custom-confirm-btn-confirm");
  close.textContent = copy.dialogOk || "知道了";
  close.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

async function sendCompletion({ config, body, fetchImpl, sleep }) {
  for (let attempt = 0; attempt < COMPLETE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    // 開機保底看「多久沒有進展」：每次嘗試都算一步，等久一點不會被蓋上保底畫面
    if (typeof window !== "undefined") window.__bootMark?.("plan-recovery-attempt");
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

/**
 * 開機時在 handleCallback 之後呼叫。不是找回流程回傳 null。
 * 不會丟例外：任何情況都要讓開機繼續走下去，會友留在目前的登入狀態。
 */
export async function finishPlanRecoveryAfterCallback({
  auth = defaultAuth(),
  config = defaultConfig(),
  storage = defaultSessionStorage(),
  tokens = typeof localStorage !== "undefined" ? localStorage : null,
  fetchImpl,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  showResult = showResultDialog
} = {}) {
  let status;
  try {
    const outcome = auth?.consumePlanRecoveryOutcome?.() || null;
    const stash = takeStash(storage);
    if (!outcome) {
      auth?.clearPlanRecoveryFlow?.();
      return null;
    }

    if (outcome === "cancelled") {
      status = "cancelled";
    } else {
      // 現在的 token 已經換成剛登入的方式，上一個方式留在裝置上的資料不能混進來
      await auth.clearAccountLocalData?.();
      const targetAccessToken = tokens?.getItem(auth.keys.accessToken);
      const targetIdToken = tokens?.getItem(auth.keys.idToken);
      if (!stash || !config?.url || !targetAccessToken || !targetIdToken) {
        status = "incomplete";
      } else {
        setLoader((window.APP_COPY && window.APP_COPY.planRecovery && window.APP_COPY.planRecovery.working) || "正在找回你的計畫...");
        status = await sendCompletion({
          config,
          fetchImpl,
          sleep,
          body: {
            action: "complete",
            source_token: stash.sourceToken,
            target_access_token: targetAccessToken,
            target_id_token: targetIdToken
          }
        });
        setLoader(null);
      }
    }
  } catch (err) {
    console.warn("Plan recovery could not finish:", err?.message || "unknown");
    setLoader(null);
    status = "failed";
  }
  try {
    showResult(planRecoveryMessage(status));
  } catch (_) {}
  return { status };
}
