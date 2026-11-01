import {
  detectAuthenticationEnvironment,
  shouldGateInteractiveAuth
} from "./auth-environment.js";

export const BIBLE_HUB_CONTINUE_RETURN_TO = "/?resume=plan";

function hubContinueQuery() {
  return `member/continue?satellite=bible-app&returnTo=${encodeURIComponent(BIBLE_HUB_CONTINUE_RETURN_TO)}`;
}

export function consumeBibleHubResume(search) {
  try {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return params.get("resume") === "plan";
  } catch {
    return false;
  }
}

export function getLoginGateCopy(block, { hasTokens } = {}) {
  if (!hasTokens) {
    return {
      enterApp: false,
      title: "新生命聖經速讀計畫",
      subtitle: "跟弟兄姊妹一起速讀聖經。登入後，換手機也能接著讀。第一次使用也從這裡開始。",
      button: "登入",
      mode: "sso",
    };
  }
  if (!block) {
    return { enterApp: true, title: "", subtitle: "", button: "", mode: "enter" };
  }
  if (block.reason === "member_profile_required") {
    return {
      enterApp: false,
      title: "請先填寫姓名",
      subtitle: "還差一步：填上你的名字就能開始。會開啟教會的會員頁面。",
      button: "去填寫姓名",
      mode: "hub-continue",
      switchAccount: true,
    };
  }
  if (block.reason === "membership_application_required") {
    return {
      enterApp: false,
      title: "請先完成會籍登記",
      subtitle: "送出會籍申請就能開始，不用等牧者審核完成。會開啟教會的會員頁面。",
      button: "去填寫會籍申請",
      mode: "hub-continue",
      switchAccount: true,
    };
  }
  if (block.reason === "member_context_unavailable") {
    return {
      enterApp: false,
      title: "正在確認會員資料",
      subtitle: "你已經登入了，只是資料一時讀不到。請再試一次，不用重新註冊。（代碼：MEMBER_CONTEXT_UNAVAILABLE）",
      button: "重新確認會員資料",
      mode: "retry-sync",
    };
  }
  if (block.reason === "inactive_membership") {
    return {
      enterApp: false,
      title: "目前無法使用聖經速讀",
      subtitle: "如果會員中心已有正確資料，可能是目前畫面尚未更新，可先重新整理最新版；若仍顯示此訊息，請到會員中心查看或聯繫教會同工。",
      button: "前往會員中心",
      mode: "hub-continue",
    };
  }
  return {
    enterApp: false,
    title: "還有一步要完成",
    subtitle: "按下方按鈕繼續就好，不用重新註冊。",
    button: "繼續",
    mode: "hub-continue",
  };
}

export function hubContinueHref(auth) {
  const path = hubContinueQuery();
  if (auth && typeof auth.getMemberHubUrl === "function") {
    return auth.getMemberHubUrl(path);
  }
  return `https://member.newlife.org.tw/${path}`;
}

export function launchMemberHubContinue(auth) {
  const href = hubContinueHref(auth);
  const embedded = shouldGateInteractiveAuth(detectAuthenticationEnvironment(), {
    authEnvironmentAcknowledged: false
  });
  if (embedded && auth && typeof auth._addBrowserLaunchTransportParams === "function") {
    window.location.href = auth._addBrowserLaunchTransportParams(href);
    return;
  }
  window.location.assign(href);
}

export function applyLoginGateView({
  block,
  hasTokens,
  loginGate,
  appLayout,
  titleEl,
  subtitleEl,
  buttonEl,
  refreshActionsEl,
} = {}) {
  const copy = getLoginGateCopy(block, { hasTokens });
  if (copy.enterApp) {
    if (loginGate) loginGate.classList.add("hidden");
    if (appLayout) appLayout.classList.remove("hidden");
    if (refreshActionsEl) refreshActionsEl.classList.add("hidden");
    return copy;
  }
  if (loginGate) loginGate.classList.remove("hidden");
  if (appLayout) appLayout.classList.add("hidden");
  if (titleEl) titleEl.textContent = copy.title;
  if (subtitleEl) subtitleEl.textContent = copy.subtitle;
  if (buttonEl) {
    buttonEl.textContent = copy.button;
    buttonEl.dataset.loginGateMode = copy.mode;
  }
  if (refreshActionsEl) {
    if (hasTokens && block) refreshActionsEl.classList.remove("hidden");
    else refreshActionsEl.classList.add("hidden");
  }
  const query = (selector) => (loginGate && typeof loginGate.querySelector === "function"
    ? loginGate.querySelector(selector)
    : null);
  // #645：換一種方式登入會開出新帳號，會員中心會把它當新人、卡在填姓名／會籍。
  // 這兩個畫面多一個次要連結，讓會友登出改用原本的方式（#615 的 logoutToSwitchAccount）。
  const switchAccountEl = query("[data-login-switch-account]");
  if (switchAccountEl) switchAccountEl.classList.toggle("hidden", !copy.switchAccount);
  // 紅點狀態只給 showConnectionError（真正的連線錯誤／登入失效）；這裡的畫面已經把原因寫在副標。
  const statusEl = query("#gate-status-container");
  if (statusEl) statusEl.classList.add("hidden");
  return copy;
}
