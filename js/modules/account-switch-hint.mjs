// #615：會友換一種方式登入（原本手機號碼、這次 Email），Logto 給的是新的 sub、
// 會員中心另建一位會員，nlc-session 三種連結方式都對不上，就開了全新的空帳號。
// 舊帳號的計畫和紀錄都還在，但會友只看到「我的計畫不見了」。
// 這裡在「沒有計畫」的空白畫面加一張提示卡，請他改用原本的方式登入。
// #663：原本的方式也可能是 Email、這次才用手機，所以卡片說出「現在」用的是哪一種，不預設原本是手機。
//
// 只在三個條件同時成立時出現：帳號建立未滿 30 天、會員中心身分有值、一個計畫都沒有。
// 資料不足（舊版 nlc-session 沒回 created_at、會員中心沒同步）就不顯示。
// #677：不再排除正式會友，會員中心可能很快就核准新帳號。真正第一次用 App 的正式會友也會看到
// 一次，按「我是第一次參加」就不再出現；新帳號不多，漏掉一位分裂的會友代價更高。

export const ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_KEY_PREFIX = "account_switch_hint_dismissed:";

export function shouldShowAccountSwitchHint({
  accountCreatedAt,
  membershipStatus,
  hasAnyPlan,
  dismissed,
  now = Date.now()
} = {}) {
  if (hasAnyPlan || dismissed) return false;
  if (!String(membershipStatus || "").trim()) return false;
  const createdAt = Date.parse(String(accountCreatedAt || ""));
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt <= ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS * DAY_MS;
}

function dismissKey(profileId) {
  return `${DISMISS_KEY_PREFIX}${profileId || ""}`;
}

export function isAccountSwitchHintDismissed(profileId) {
  try {
    return localStorage.getItem(dismissKey(profileId)) === "1";
  } catch (_) {
    return false;
  }
}

function rememberDismissed(profileId) {
  try {
    localStorage.setItem(dismissKey(profileId), "1");
  } catch (_) {
    // 存不了（私密模式等）就只在這次畫面關掉
  }
}

/** 讀目前登入者的狀態決定要不要顯示；計畫清單還沒載入（null）時一律不顯示。 */
export function shouldShowAccountSwitchHintForState(appState, now = Date.now()) {
  if (!appState || !Array.isArray(appState.activePlans)) return false;
  return shouldShowAccountSwitchHint({
    accountCreatedAt: appState.currentUser?.account_created_at,
    membershipStatus: appState.membershipStatus,
    hasAnyPlan: appState.activePlans.length > 0,
    dismissed: isAccountSwitchHintDismissed(appState.currentProfileId),
    now
  });
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
}

// 886912345678 / +886912345678 / 0912345678 → 0912-***-678
export function maskPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("886")) digits = `0${digits.slice(3)}`;
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-***-${digits.slice(-3)}`;
}

// abcdef@gmail.com → ab***@gmail.com
export function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return "";
  const local = value.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***${value.slice(at)}`;
}

// #663：告訴會友「現在」是用什麼登入，他才知道要換成另一種。
// 帳號只有手機或只有 Email 才說得準；兩者都有（或都沒有）就不猜。
export function currentLoginMethod(user) {
  const phone = maskPhone(user && user.phone);
  const email = maskEmail(user && user.email);
  if (phone && !email) return { method: "phone", masked: phone };
  if (email && !phone) return { method: "email", masked: email };
  return { method: "", masked: "" };
}

// #664：裝置記得上次是用哪個方式登入：改成驗證那個方式就能找回。文案不提帳號、合併。
function recoverPlanMarkup(offer, copy) {
  const label = offer.method === "phone" ? "手機" : "Email";
  const fill = template => template
    .replace(/\{method\}/g, () => label)
    .replace("{account}", () => `<span class="account-switch-hint__account">${escapeText(offer.masked)}</span>`);
  const body = fill(copy.recoverBody || "你之前在這台裝置上是用 {method}（{account}）登入的，你的計畫和閱讀紀錄都在那裡。用 {method} 確認一次身分，就能把它們找回來，之後用手機或 Email 登入都看得到。");
  const cta = (copy.recoverCta || "用 {method} 找回我的計畫").replace("{method}", () => label);
  return `
    <section class="account-switch-hint" data-account-switch-hint role="note" aria-labelledby="account-switch-hint-title">
      <h3 class="account-switch-hint__title" id="account-switch-hint-title">
        <span class="nlc-icon nlc-icon--sm" data-icon="info" aria-hidden="true"></span>
        <span>${copy.title || "找不到你的讀經計畫嗎？"}</span>
      </h3>
      <p class="account-switch-hint__body">${body}</p>
      <p class="account-switch-hint__status hidden" data-account-recover-status role="status"></p>
      <div class="account-switch-hint__actions">
        <button type="button" class="primary-btn account-switch-hint__switch" data-account-recover-plan>${cta}</button>
        <button type="button" class="secondary-btn" data-account-switch-dismiss>${copy.recoverDismissCta || "不是我／我是第一次參加"}</button>
      </div>
    </section>
  `;
}

export function accountSwitchHintMarkup(currentUser, recoveryOffer = null) {
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.accountSwitchHint) || {};
  if (recoveryOffer) return recoverPlanMarkup(recoveryOffer, copy);
  const { method, masked } = currentLoginMethod(currentUser);
  const account = `<span class="account-switch-hint__account">${escapeText(masked)}</span>`;
  let body;
  if (method === "phone") {
    body = (copy.bodyPhone || "你現在是用手機 {account} 登入的。如果你以前參加時是用 Email 或其他方式登入，計畫會在那裡，請登出後改用那個方式登入。").replace("{account}", () => account);
  } else if (method === "email") {
    body = (copy.bodyEmail || "你現在是用 Email {account} 登入的。如果你以前參加時是用手機號碼或其他方式登入，計畫會在那裡，請登出後改用那個方式登入。").replace("{account}", () => account);
  } else {
    body = copy.bodyUnknown || "如果你以前參加時是用另一種方式（Email 或手機號碼）登入，計畫會在那裡，請登出後改用那個方式登入。";
  }
  return `
    <section class="account-switch-hint" data-account-switch-hint role="note" aria-labelledby="account-switch-hint-title">
      <h3 class="account-switch-hint__title" id="account-switch-hint-title">
        <span class="nlc-icon nlc-icon--sm" data-icon="info" aria-hidden="true"></span>
        <span>${copy.title || "找不到你的讀經計畫嗎？"}</span>
      </h3>
      <p class="account-switch-hint__body">${body}</p>
      <div class="account-switch-hint__actions">
        <button type="button" class="primary-btn account-switch-hint__switch" data-account-switch-logout>
          <span class="nlc-icon nlc-icon--sm" data-icon="logout" aria-hidden="true"></span>
          <span>${copy.switchCta || "登出，換別的方式登入"}</span>
        </button>
        <button type="button" class="secondary-btn" data-account-switch-dismiss>${copy.dismissCta || "我是第一次參加"}</button>
      </div>
    </section>
  `;
}

export function bindAccountSwitchHint(container, { profileId, onSwitch, onRecover } = {}) {
  const card = container && container.querySelector("[data-account-switch-hint]");
  if (!card) return;
  if (typeof window !== "undefined" && typeof window.hydrateIcons === "function") window.hydrateIcons(card);
  const switchBtn = card.querySelector("[data-account-switch-logout]");
  if (switchBtn) {
    switchBtn.onclick = () => {
      switchBtn.disabled = true;
      if (typeof onSwitch === "function") onSwitch();
    };
  }
  const recoverBtn = card.querySelector("[data-account-recover-plan]");
  if (recoverBtn) {
    const statusEl = card.querySelector("[data-account-recover-status]");
    recoverBtn.onclick = async () => {
      recoverBtn.disabled = true;
      statusEl.classList.add("hidden");
      // 從 Logto 按返回、瀏覽器直接還原這一頁（bfcache）：頁面不會重新跑，按鈕要自己恢復
      window.addEventListener("pageshow", event => {
        if (event.persisted) recoverBtn.disabled = false;
      }, { once: true });
      const result = typeof onRecover === "function" ? await onRecover() : null;
      if (result && result.ok) return; // 正在跳轉
      recoverBtn.disabled = false;
      statusEl.textContent = (result && result.message) || "";
      statusEl.classList.toggle("hidden", !statusEl.textContent);
    };
  }
  const dismissBtn = card.querySelector("[data-account-switch-dismiss]");
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      rememberDismissed(profileId);
      card.remove();
    };
  }
}

/** 計畫頁／首頁共用：登出並讓下一次登入顯示 Logto 登入頁（見 auth.logoutToSwitchAccount）。 */
export function switchToOriginalAccount() {
  const auth = typeof window !== "undefined" ? window.auth : null;
  if (auth && typeof auth.logoutToSwitchAccount === "function") return auth.logoutToSwitchAccount();
  if (auth && typeof auth.logout === "function") return auth.logout();
  return undefined;
}
