// #615：會友換一種方式登入（原本手機號碼、這次 Email），Logto 給的是新的 sub、
// 會員中心另建一位會員，nlc-session 三種連結方式都對不上，就開了全新的空帳號。
// 舊帳號的計畫和紀錄都還在，但會友只看到「我的計畫不見了」。
// 這裡在「沒有計畫」的空白畫面加一張提示卡，請他改用原本的方式登入。
//
// 只在三個條件同時成立時出現：帳號建立未滿 30 天、會員中心身分有值但不是正式會友
// （換方式開的新帳號會員中心一定不認得；真正第一次用 App 的正式會友不打擾）、
// 一個計畫都沒有。資料不足（舊版 nlc-session 沒回 created_at、會員中心沒同步）就不顯示。

export const ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_KEY_PREFIX = "account_switch_hint_dismissed:";
const OFFICIAL_MEMBER_STATUS = "official_member";

export function shouldShowAccountSwitchHint({
  accountCreatedAt,
  membershipStatus,
  hasAnyPlan,
  dismissed,
  now = Date.now()
} = {}) {
  if (hasAnyPlan || dismissed) return false;
  const status = String(membershipStatus || "").trim();
  if (!status || status === OFFICIAL_MEMBER_STATUS) return false;
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

export function accountSwitchHintMarkup() {
  const copy = (typeof window !== "undefined" && window.APP_COPY && window.APP_COPY.accountSwitchHint) || {};
  return `
    <section class="account-switch-hint" data-account-switch-hint role="note" aria-labelledby="account-switch-hint-title">
      <h3 class="account-switch-hint__title" id="account-switch-hint-title">
        <span class="nlc-icon nlc-icon--sm" data-icon="info" aria-hidden="true"></span>
        <span>${copy.title || "以前參加過讀經計畫嗎？"}</span>
      </h3>
      <p class="account-switch-hint__body">${copy.body || "如果你之前用手機號碼（或其他方式）登入過，你的計畫和閱讀紀錄都在那個帳號裡。請先登出，再改用原本的方式登入。"}</p>
      <div class="account-switch-hint__actions">
        <button type="button" class="primary-btn account-switch-hint__switch" data-account-switch-logout>
          <span class="nlc-icon nlc-icon--sm" data-icon="logout" aria-hidden="true"></span>
          <span>${copy.switchCta || "登出，改用原本的方式登入"}</span>
        </button>
        <button type="button" class="secondary-btn" data-account-switch-dismiss>${copy.dismissCta || "我是第一次使用"}</button>
      </div>
    </section>
  `;
}

export function bindAccountSwitchHint(container, { profileId, onSwitch } = {}) {
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
