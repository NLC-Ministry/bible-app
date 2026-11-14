// @vitest-environment jsdom
// #707：會友在教會登入頁（Logto）卡住——頁面放太久，按 Google／LINE 只跳「未找到會話」。
// 回到 App 時，如果剛才開始的登入沒有回來，就在登入按鈕上方提醒再按一次。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  LOGIN_FLOW_STARTED_AT_KEY,
  MAX_AWAY_MS,
  MIN_AWAY_MS,
  hasAbandonedLoginFlow,
  refreshLoginRetryHint,
  renderLoginRetryHint
} from "../js/login-retry-hint.mjs";
import { applyLoginGateView } from "../js/login-onboarding-gate.mjs";

const NOW = Date.parse("2026-11-13T12:00:00+08:00");
const HINT = "剛才沒有登入成功嗎？再按一次「登入」就可以了。登入頁如果出現「未找到會話」，也是這樣處理。";

function memoryStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
}

const startedAgo = (ms, extra = {}) => memoryStorage({ [LOGIN_FLOW_STARTED_AT_KEY]: String(NOW - ms), ...extra });

describe("hasAbandonedLoginFlow：剛才開始的登入有沒有回來", () => {
  it("開始登入後過了一陣子回到 App、網址沒有登入結果：算沒回來", () => {
    expect(hasAbandonedLoginFlow({ storage: startedAgo(30_000), now: NOW, search: "" })).toBe(true);
  });

  it.each([
    ["沒有開始過登入", memoryStorage(), ""],
    ["才剛按下登入（還在跳轉）", startedAgo(MIN_AWAY_MS - 1), ""],
    ["很久以前的登入（不是「剛才」）", startedAgo(MAX_AWAY_MS + 1), ""],
    ["時間格式壞掉", memoryStorage({ [LOGIN_FLOW_STARTED_AT_KEY]: "abc" }), ""],
    ["時間在未來（裝置時鐘被調過）", startedAgo(-60_000), ""],
    ["Logto 帶登入碼回來（交給 handleCallback）", startedAgo(30_000), "?code=x&state=y"],
    ["Logto 帶錯誤回來（handleCallback 會顯示訊息）", startedAgo(30_000), "?error=access_denied"],
    ["找回計畫的登入（有自己的取消處理）", startedAgo(30_000, { nlc_auth_plan_recovery: "1" }), ""]
  ])("%s：不算", (_label, storage, search) => {
    expect(hasAbandonedLoginFlow({ storage, now: NOW, search })).toBe(false);
  });

  it("讀不到儲存空間：不算，也不丟例外", () => {
    const broken = { getItem() { throw new Error("blocked"); } };
    expect(hasAbandonedLoginFlow({ storage: broken, now: NOW, search: "" })).toBe(false);
    expect(hasAbandonedLoginFlow({ storage: null, now: NOW, search: "" })).toBe(false);
  });
});

function loginGateDom() {
  document.body.innerHTML = `
    <div id="login-gate" class="hidden">
      <h2 class="login-title"></h2>
      <p id="login-gate-subtitle"></p>
      <p class="login-retry-hint hidden" data-login-retry-hint role="status"></p>
      <p class="login-method-hint hidden" data-login-method-hint role="note"></p>
      <button id="btn-gate-nlc-login"></button>
      <button class="hidden" data-login-switch-account></button>
      <div id="login-gate-refresh-actions" class="hidden"></div>
      <div id="gate-status-container" class="hidden"></div>
    </div>
    <div class="app-layout"></div>`;
  const loginGate = document.getElementById("login-gate");
  return {
    loginGate,
    appLayout: document.querySelector(".app-layout"),
    titleEl: loginGate.querySelector(".login-title"),
    subtitleEl: document.getElementById("login-gate-subtitle"),
    buttonEl: document.getElementById("btn-gate-nlc-login"),
    refreshActionsEl: document.getElementById("login-gate-refresh-actions"),
    hint: () => loginGate.querySelector("[data-login-retry-hint]")
  };
}

describe("登入卡上的提示", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => vi.useRealTimers());

  it("要會友登入的畫面、剛才的登入沒回來：顯示提示", () => {
    const els = loginGateDom();
    applyLoginGateView({ block: null, hasTokens: false, storage: startedAgo(30_000), ...els });
    expect(els.hint().classList.contains("hidden")).toBe(false);
    expect(els.hint().textContent).toBe(HINT);
  });

  it("正常第一次打開：不顯示", () => {
    const els = loginGateDom();
    applyLoginGateView({ block: null, hasTokens: false, storage: memoryStorage(), ...els });
    expect(els.hint().classList.contains("hidden")).toBe(true);
  });

  it("已經登入、卡在會員中心那一步：不顯示（不是要會友再按登入）", () => {
    const els = loginGateDom();
    applyLoginGateView({ block: { reason: "member_not_registered" }, hasTokens: true, storage: startedAgo(30_000), ...els });
    expect(els.hint().classList.contains("hidden")).toBe(true);
  });

  it("從瀏覽器的上一頁快取回來（bfcache）：重新判斷一次", () => {
    const els = loginGateDom();
    applyLoginGateView({ block: null, hasTokens: false, storage: memoryStorage(), ...els });
    expect(els.hint().classList.contains("hidden")).toBe(true);

    refreshLoginRetryHint(els.loginGate, { storage: startedAgo(30_000) });
    expect(els.hint().classList.contains("hidden")).toBe(false);
  });

  it("bfcache 回來但登入卡沒顯示、或是會員中心那一步：不動", () => {
    const els = loginGateDom();
    refreshLoginRetryHint(els.loginGate, { storage: startedAgo(30_000) });
    expect(els.hint().classList.contains("hidden")).toBe(true);

    applyLoginGateView({ block: { reason: "member_not_registered" }, hasTokens: true, storage: memoryStorage(), ...els });
    refreshLoginRetryHint(els.loginGate, { storage: startedAgo(30_000) });
    expect(els.hint().classList.contains("hidden")).toBe(true);
  });

  it("沒有提示元素（考試頁等）：不丟例外", () => {
    document.body.innerHTML = `<div id="login-gate"></div>`;
    expect(() => renderLoginRetryHint(document.getElementById("login-gate"), { storage: startedAgo(30_000) })).not.toThrow();
    expect(() => renderLoginRetryHint(null)).not.toThrow();
  });
});

describe("index.html、文案與 auth.js 的 key", () => {
  it("登入卡有提示元素，放在登入按鈕前面", () => {
    const html = readFileSync("index.html", "utf8");
    const hintAt = html.indexOf("data-login-retry-hint");
    expect(hintAt).toBeGreaterThan(-1);
    expect(hintAt).toBeLessThan(html.indexOf('id="btn-gate-nlc-login"'));
  });

  it("zh-Hant 文案和模組的預設文字一致", () => {
    expect(readFileSync("js/copy/zh-Hant.js", "utf8")).toContain(`text: "${HINT}"`);
  });

  it("模組讀的 key 和 auth.js 寫的是同一個", () => {
    expect(readFileSync("js/auth.js", "utf8")).toContain(`flowStartedAt: "${LOGIN_FLOW_STARTED_AT_KEY}"`);
  });
});

describe("auth.js 記下登入開始的時間", () => {
  let auth;

  beforeAll(async () => {
    globalThis.state = { currentUser: {} };
    globalThis.loader = { show: vi.fn(), hide: vi.fn() };
    window.loader = globalThis.loader;
    globalThis.showToast = vi.fn();
    globalThis.getRoleDefinition = () => null;
    await import("../js/auth.js");
    auth = window.auth;
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    auth.metadata = { authorization_endpoint: "https://sso.test/oidc/auth", token_endpoint: "https://sso.test/oidc/token" };
    auth.config.clientId = "test-client";
    vi.spyOn(auth, "_navigateToAuthorization").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("一般登入：跳轉前記下時間（localStorage，PWA 關掉登入頁回來也讀得到）", async () => {
    const before = Date.now();
    await auth._redirectToAuthorization({ intent: "login", returnTo: "/" }, {});
    const recorded = Number(localStorage.getItem(LOGIN_FLOW_STARTED_AT_KEY));
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(Date.now());
  });

  it("找回計畫的登入：不記", async () => {
    await auth._redirectToAuthorization({ intent: "login", returnTo: "/" }, { planRecovery: true, nonce: "n" });
    expect(localStorage.getItem(LOGIN_FLOW_STARTED_AT_KEY)).toBeNull();
  });

  it("登入流程暫存清掉時一起清（成功、失敗、登出都走這裡）", async () => {
    await auth._redirectToAuthorization({ intent: "login", returnTo: "/" }, {});
    auth._clearFlowState();
    expect(localStorage.getItem(LOGIN_FLOW_STARTED_AT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOGIN_FLOW_STARTED_AT_KEY)).toBeNull();
  });
});
