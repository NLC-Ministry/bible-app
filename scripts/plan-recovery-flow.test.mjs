// @vitest-environment jsdom
// #664：驗證舊的登入方式後找回計畫的前端流程。跑真的 js/auth.js，只換掉網路與跳轉。
// 伺服器端的條件見 scripts/recover-plan-function.test.mjs、scripts/db-behavior.test.mjs。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  accountSwitchHintMarkup,
  bindAccountSwitchHint,
  isAccountSwitchHintDismissed
} from "../js/modules/account-switch-hint.mjs";
import { LAST_LOGIN_METHOD_KEY, readLastLoginMethod, rememberLoginMethod } from "../js/login-method-memory.mjs";
import {
  abandonPlanRecovery,
  finishPlanRecoveryAfterCallback,
  planRecoveryConfirmBody,
  planRecoveryOffer,
  startPlanRecovery
} from "../js/plan-recovery.mjs";

const CONFIG = { url: "https://db.test", anonKey: "anon" };
const FUNCTION_URL = "https://db.test/functions/v1/recover-plan";
const TOKEN_URL = "https://sso.test/oidc/token";
const SOURCE = { access: "source-access-token", refresh: "source-refresh-token", id: "source-id-token" };
const SERVER_NONCE = "server-issued-nonce";

const jwt = payload => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const TARGET = {
  access: "target-access-token",
  refresh: "target-refresh-token",
  id: jwt({ sub: "sub-old", nonce: SERVER_NONCE, phone_number: "886912345678" })
};

let auth;

function signInAsSource() {
  localStorage.setItem(auth.keys.accessToken, SOURCE.access);
  localStorage.setItem(auth.keys.refreshToken, SOURCE.refresh);
  localStorage.setItem(auth.keys.idToken, SOURCE.id);
  localStorage.setItem(auth.keys.expiresAt, String(Date.now() + 3600 * 1000));
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** recoverPlan：回傳 Response 或丟例外的函式，參數是這次送出的 body。 */
function stubNetwork({ recoverPlan, tokenResponse = { access_token: TARGET.access, refresh_token: TARGET.refresh, id_token: TARGET.id, expires_in: 3600 } } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url === FUNCTION_URL) {
      const body = JSON.parse(init.body);
      calls.push(body);
      return recoverPlan(body);
    }
    if (url === TOKEN_URL) return json(tokenResponse);
    throw new Error(`unexpected fetch ${url}`);
  }));
  return calls;
}

const startOk = () => json({ ok: true, nonce: SERVER_NONCE, request_id: "r" });
const navigated = () => new URL(auth._navigateToAuthorization.mock.calls[0][0]);

async function pressRecover() {
  const result = await startPlanRecovery({ auth, config: CONFIG });
  return result;
}

function landOnCallback(query) {
  window.history.replaceState({}, "", `/?${query}`);
}

async function returnFromLogto() {
  const state = navigated().searchParams.get("state");
  landOnCallback(`code=abc&state=${encodeURIComponent(state)}`);
  return auth.handleCallback();
}

// 預設是按了「確認找回」；要看確認畫面或按取消就換掉 confirm。
const finish = (overrides = {}) => {
  const showResult = vi.fn();
  const confirm = vi.fn(async () => true);
  const reload = vi.fn();
  return finishPlanRecoveryAfterCallback({ auth, config: CONFIG, sleep: async () => {}, confirm, showResult, reload, ...overrides })
    .then(result => ({ result, showResult, confirm, reload, message: showResult.mock.calls[0]?.[0] }));
};

const allStoredValues = () => [
  ...Object.keys(localStorage).map(key => localStorage.getItem(key)),
  ...Object.keys(sessionStorage).map(key => sessionStorage.getItem(key))
].join("\n");

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
  auth.metadata = { authorization_endpoint: "https://sso.test/oidc/auth", token_endpoint: TOKEN_URL };
  auth.config.clientId = "test-client";
  auth._planRecoveryOutcome = null;
  auth._planRecoveryHeldTokens = null;
  vi.spyOn(auth, "_navigateToAuthorization").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  signInAsSource();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("planRecoveryOffer：什麼時候改顯示「找回」", () => {
  const record = value => localStorage.setItem(LAST_LOGIN_METHOD_KEY, JSON.stringify(value));
  const appState = { currentProfileId: "new-profile", currentUser: { phone: "886912345678" } };

  it("裝置記得另一個方式：給遮罩後的方式", () => {
    record({ method: "email", masked: "ab***@gmail.com", profileId: "old-profile" });
    expect(planRecoveryOffer(appState)).toEqual({ method: "email", masked: "ab***@gmail.com" });
  });

  it("舊版紀錄沒有帳號 ID，只要方式不同一樣提示", () => {
    record({ method: "email", masked: "ab***@gmail.com" });
    expect(planRecoveryOffer(appState)).toEqual({ method: "email", masked: "ab***@gmail.com" });
  });

  it("裝置記得的就是現在這個帳號：不提示", () => {
    record({ method: "email", masked: "ab***@gmail.com", profileId: "new-profile" });
    expect(planRecoveryOffer(appState)).toBeNull();
  });

  it("裝置記得的和現在是同一個方式：不提示", () => {
    record({ method: "phone", masked: "0912-***-678" });
    expect(planRecoveryOffer(appState)).toBeNull();
  });

  it("沒有紀錄或紀錄說不出方式：不提示，維持原本的提示卡", () => {
    expect(planRecoveryOffer(appState)).toBeNull();
    record({ method: "", masked: "" });
    expect(planRecoveryOffer(appState)).toBeNull();
    localStorage.setItem(LAST_LOGIN_METHOD_KEY, "{oops");
    expect(planRecoveryOffer(appState)).toBeNull();
  });

  it("rememberLoginMethod 記下帳號 ID，讀回來還在；沒給就和以前一樣", () => {
    rememberLoginMethod({ user: { email: "abcdef@gmail.com" }, accountCreatedAt: "2020-01-01", hasAnyPlan: true, profileId: "old-profile" });
    expect(readLastLoginMethod()).toEqual({ method: "email", masked: "ab***@gmail.com", profileId: "old-profile" });
    rememberLoginMethod({ user: { email: "abcdef@gmail.com" }, accountCreatedAt: "2020-01-01", hasAnyPlan: true });
    expect(readLastLoginMethod()).toEqual({ method: "email", masked: "ab***@gmail.com" });
  });
});

describe("提示卡", () => {
  const offer = { method: "email", masked: "ab***@gmail.com" };
  const render = (value = offer, options = {}) => {
    document.body.innerHTML = `<div id="host">${accountSwitchHintMarkup({ phone: "886912345678" }, value)}</div>`;
    bindAccountSwitchHint(document.getElementById("host"), { profileId: "new-profile", onSwitch: vi.fn(), ...options });
    return document.querySelector("[data-account-switch-hint]");
  };

  it("文案照 issue，不提帳號、合併，也沒有登出按鈕", () => {
    const card = render();
    expect(card.querySelector(".account-switch-hint__title").textContent.trim()).toBe("找不到你的讀經計畫嗎？");
    expect(card.querySelector(".account-switch-hint__body").textContent).toBe(
      "你之前在這台裝置上是用 ab***@gmail.com 登入的，你的計畫和閱讀紀錄都在那裡。按 Google 確認一次身分（有設密碼也可以輸入密碼），就能把它們找回來，之後用之前或現在的方式登入都看得到。"
    );
    expect(card.querySelector("[data-account-recover-plan]").textContent).toBe("確認身分，找回我的計畫");
    expect(card.querySelector("[data-account-switch-dismiss]").textContent).toBe("不是我／我是第一次參加");
    expect(card.textContent).not.toMatch(/帳號|合併/);
    expect(card.querySelector("[data-account-switch-logout]")).toBeNull();
  });

  it("手機帳號也不斷定是用手機登入（#682）", () => {
    const card = render({ method: "phone", masked: "0912-***-678" });
    expect(card.querySelector("[data-account-recover-plan]").textContent).toBe("確認身分，找回我的計畫");
    const body = card.querySelector(".account-switch-hint__body").textContent;
    expect(body).toContain("是用 0912-***-678 登入的");
    expect(body).toContain("用上次的方式（按 Google、按 LINE 或輸入密碼）確認一次身分");
    expect(body).not.toMatch(/手機|Email/);
  });

  it("其他 Email 列出所有方式，不只叫他按 Google（#682）", () => {
    const body = render({ method: "email", masked: "ab***@church.org" }).querySelector(".account-switch-hint__body").textContent;
    expect(body).toContain("用上次的方式（按 Google、按 LINE 或輸入密碼）確認一次身分");
    expect(body).not.toContain("按 Google 確認一次身分");
  });

  it("zh-Hant 的文案也不提帳號、合併，而且和程式內的預設相同", () => {
    const copy = readFileSync("js/copy/zh-Hant.js", "utf8");
    const block = copy.slice(copy.indexOf("recoverBody:"), copy.indexOf("memberHub:"));
    const texts = block.slice(0, block.indexOf("loginMethodHint:"));
    expect(texts).not.toMatch(/帳號|合併/);
    const hintSource = readFileSync("js/modules/account-switch-hint.mjs", "utf8");
    expect(hintSource).toContain("你之前在這台裝置上是用 {account} 登入的");
    expect(texts).toContain("你之前在這台裝置上是用 {account} 登入的");
    for (const line of ["按 Google 確認一次身分（有設密碼也可以輸入密碼）", "用上次的方式（按 Google、按 LINE 或輸入密碼）確認一次身分"]) {
      expect(hintSource).toContain(line);
      expect(copy).toContain(line);
    }
    expect(hintSource + texts).not.toContain("這支手機");
    expect(texts).not.toContain("{method}");
  });

  it("遮罩值會跳脫", () => {
    const card = render({ method: "email", masked: "<img src=x>@x" });
    expect(card.querySelector(".account-switch-hint__body img")).toBeNull();
  });

  it("次按鈕：這個帳號不再出現，不會開始找回", () => {
    const onRecover = vi.fn();
    render(offer, { onRecover });
    document.querySelector("[data-account-switch-dismiss]").click();
    expect(document.querySelector("[data-account-switch-hint]")).toBeNull();
    expect(isAccountSwitchHintDismissed("new-profile")).toBe(true);
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("主按鈕失敗：顯示友善訊息、按鈕恢復可按", async () => {
    const card = render(offer, { onRecover: async () => ({ ok: false, message: "暫時無法找回計畫" }) });
    const button = card.querySelector("[data-account-recover-plan]");
    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    const status = card.querySelector("[data-account-recover-status]");
    expect(status.textContent).toBe("暫時無法找回計畫");
    expect(status.classList.contains("hidden")).toBe(false);
  });

  it("主按鈕成功：正在跳轉，按鈕維持停用；從 Logto 按返回還原頁面時恢復", async () => {
    const onRecover = vi.fn(async () => ({ ok: true }));
    const card = render(offer, { onRecover });
    const button = card.querySelector("[data-account-recover-plan]");
    button.click();
    await vi.waitFor(() => expect(onRecover).toHaveBeenCalled());
    await Promise.resolve();
    expect(button.disabled).toBe(true);

    const pageshow = new Event("pageshow");
    pageshow.persisted = true;
    window.dispatchEvent(pageshow);
    expect(button.disabled).toBe(false);
  });
});

describe("按下主按鈕", () => {
  it("向伺服器拿 nonce，帶 prompt=login 和 max_age=0 跳到 Logto；登入狀態不動，token 沒有另存一份", async () => {
    const calls = stubNetwork({ recoverPlan: startOk });

    expect(await pressRecover()).toEqual({ ok: true });

    expect(calls).toEqual([{ action: "start", source_token: SOURCE.access }]);
    const url = navigated();
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("max_age")).toBe("0");
    expect(url.searchParams.get("nonce")).toBe(SERVER_NONCE);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
    expect(Object.keys(sessionStorage).map(key => sessionStorage.getItem(key)).join("\n")).not.toContain(SOURCE.access);
  });

  it("一般登入不帶 max_age", async () => {
    await auth._redirectToAuthorization({ intent: "login", returnTo: "/" }, {});
    expect(navigated().searchParams.has("max_age")).toBe(false);
  });

  it.each([
    ["函式還沒部署（連線失敗）", () => { throw new TypeError("Failed to fetch"); }, "暫時無法找回計畫"],
    ["函式還沒部署（404）", () => new Response("not found", { status: 404 }), "暫時無法找回計畫"],
    ["伺服器還沒設定", () => json({ error: "recovery_not_configured" }, 503), "暫時無法找回計畫"],
    ["伺服器出錯", () => json({ error: "recover_plan_failed" }, 500), "暫時無法找回計畫"],
    ["這個帳號不符合", () => json({ error: "not_eligible" }, 403), "沒有辦法自動找回"],
    ["太多次", () => json({ error: "rate_limited" }, 429), "太多次"]
  ])("%s：留在原畫面、什麼都沒變", async (_label, recoverPlan, message) => {
    stubNetwork({ recoverPlan });

    const result = await pressRecover();

    expect(result.ok).toBe(false);
    expect(result.message).toContain(message);
    expect(result.message).not.toMatch(/帳號|合併/);
    expect(auth._navigateToAuthorization).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
    expect(auth.isLoggedIn()).toBe(true);
  });

  it("開不了 Logto（discovery 失敗）：清掉登入流程，登入狀態不動", async () => {
    stubNetwork({ recoverPlan: startOk });
    vi.spyOn(auth, "_getEndpoints").mockRejectedValue(new Error("discovery failed"));

    const result = await pressRecover();

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(auth.keys.planRecoveryFlow)).toBeNull();
    expect(localStorage.getItem(auth.keys.nonce)).toBeNull();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
  });
});

describe("會友取消", () => {
  beforeEach(async () => {
    stubNetwork({ recoverPlan: startOk });
    await pressRecover();
  });

  it("按返回、關掉重開（開機時沒有登入回呼）：登入流程清掉，token 還是原本的", async () => {
    expect(await auth.handleCallback()).toBe(false);
    abandonPlanRecovery({ auth });

    expect(localStorage.getItem(auth.keys.planRecoveryFlow)).toBeNull();
    expect(localStorage.getItem(auth.keys.state)).toBeNull();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(auth.isLoggedIn()).toBe(true);
    const { result, showResult, confirm } = await finish();
    expect(result).toBeNull();
    expect(showResult).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("瀏覽器從 bfcache 還原這一頁：登入流程一樣清掉", () => {
    const pageshow = new Event("pageshow");
    pageshow.persisted = true;
    window.dispatchEvent(pageshow);
    expect(localStorage.getItem(auth.keys.planRecoveryFlow)).toBeNull();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
  });

  it("Logto 回 access_denied：不登出，token 還是原本的，告訴他沒有變動", async () => {
    const state = navigated().searchParams.get("state");
    landOnCallback(`error=access_denied&state=${state}`);

    expect(await auth.handleCallback()).toBe(true);
    const { result, message, confirm } = await finish();

    expect(result).toEqual({ status: "cancelled" });
    expect(message).toContain("沒有變動");
    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
    expect(window.location.search).toBe("");
    expect(global.fetch).toHaveBeenCalledTimes(1); // 只有 start，沒有 complete
  });

  it("回呼的 state 對不上：不換 token，也不登出", async () => {
    landOnCallback("code=abc&state=forged");

    await auth.handleCallback();
    const { result } = await finish();

    expect(result).toEqual({ status: "cancelled" });
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
  });

  it("id_token 的 nonce 不是伺服器發的：不存 token，不合併", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ access_token: "x", id_token: jwt({ sub: "s", nonce: "other" }), expires_in: 1 })));
    await returnFromLogto();
    const { result, confirm } = await finish();

    expect(result).toEqual({ status: "cancelled" });
    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("Logto 回應太慢：說沒有變動，晚到的 token 不存、不跳轉、不換登入", async () => {
    vi.useFakeTimers();
    try {
      let release;
      vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => {
        release = () => resolve(json({ access_token: TARGET.access, refresh_token: TARGET.refresh, id_token: TARGET.id, expires_in: 3600 }));
      })));
      const enter = vi.spyOn(auth, "_enterAfterLateLogin").mockImplementation(() => {});
      const callback = returnFromLogto();
      await vi.advanceTimersByTimeAsync(60_000);
      await callback;
      const { result, message } = await finish();
      expect(result).toEqual({ status: "cancelled" });
      expect(message).toContain("沒有變動");

      release();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(enter).not.toHaveBeenCalled();
      expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
      expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
      expect(auth.takePlanRecoveryTokens()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("一般登入的失敗回呼維持原本行為：清 token（沒有被這次改動影響）", async () => {
    abandonPlanRecovery({ auth });
    landOnCallback("error=access_denied");
    await auth.handleCallback();
    expect(localStorage.getItem(auth.keys.accessToken)).toBeNull();
    expect(auth.consumePlanRecoveryOutcome()).toBeNull();
  });
});

describe("登入舊的方式回來", () => {
  async function signedInAgain(recoverPlan) {
    const calls = stubNetwork({ recoverPlan: body => (body.action === "start" ? startOk() : recoverPlan(body)) });
    await pressRecover();
    await returnFromLogto();
    return calls;
  }
  const allStored = () => [
    ...Object.keys(localStorage).map(key => localStorage.getItem(key)),
    ...Object.keys(sessionStorage).map(key => sessionStorage.getItem(key))
  ].join("\n");

  it("回來後還沒確認：舊方式的 token 不寫進任何儲存，本機還是原本的登入", async () => {
    await signedInAgain(() => json({ ok: true }));
    expect(allStored()).not.toContain(TARGET.access);
    expect(allStored()).not.toContain(TARGET.refresh);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(auth.isLoggedIn()).toBe(true);
  });

  it("不會自動送出：等到按確認才呼叫 complete", async () => {
    const calls = await signedInAgain(() => json({ ok: true }));
    let answer;
    const confirm = vi.fn(() => new Promise(resolve => { answer = resolve; }));
    const pending = finish({ confirm });

    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(calls).toHaveLength(1);

    answer(true);
    const { result } = await pending;
    expect(result).toEqual({ status: "merged" });
    expect(calls).toHaveLength(2);
  });

  it("按取消：不送出、token 消失、還是原本的登入，也不重新載入", async () => {
    const calls = await signedInAgain(() => json({ ok: true }));

    const { result, showResult, reload } = await finish({ confirm: async () => false });

    expect(result).toEqual({ status: "declined" });
    expect(calls).toHaveLength(1);
    expect(showResult).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(SOURCE.refresh);
    expect(allStored()).not.toContain(TARGET.access);
    expect(auth.takePlanRecoveryTokens()).toBeNull();
  });

  it("確認畫面還開著就重新整理：記憶體裡的 token 沒了，開機只清流程，還是原本的登入", async () => {
    const calls = await signedInAgain(() => json({ ok: true }));
    // 重新整理＝記憶體重來；網址已清，下一次開機不是回呼
    auth._planRecoveryHeldTokens = null;
    auth._planRecoveryOutcome = null;
    abandonPlanRecovery({ auth });

    const { result } = await finish();

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(window.location.search).toBe("");
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(allStored()).not.toContain(TARGET.access);
  });

  it("確認畫面的文案：說出遮罩後的識別、不斷定登入方式（#682）、兩種方式看到同一份、無法復原；不提帳號、合併", () => {
    const phone = planRecoveryConfirmBody({ phone_number: "886912345678" });
    expect(phone).toContain("你已用 0912-***-678 確認身分");
    expect(phone).not.toContain("912345");
    expect(phone).not.toMatch(/手機|Email/);
    expect(phone).toContain("用之前或現在的方式登入");
    expect(phone).toContain("同一份計畫");
    expect(phone).toContain("無法復原");
    const email = planRecoveryConfirmBody({ email: "abcdef@gmail.com" });
    expect(email).toContain("你已用 ab***@gmail.com 確認身分");
    expect(email).not.toMatch(/手機|Email/);
    // 說不出是哪一種（兩個都有或都沒有）就不猜
    for (const claims of [{}, null, { email: "abcdef@gmail.com", phone_number: "886912345678" }]) {
      expect(planRecoveryConfirmBody(claims)).toMatch(/^你已完成身分確認/);
    }
    const copy = readFileSync("js/copy/zh-Hant.js", "utf8");
    const block = copy.slice(copy.indexOf("confirmTitle:"), copy.indexOf("loginMethodHint:"));
    expect(block).toContain("確認找回");
    expect(block).not.toMatch(/帳號|合併/);
  });

  it("確認畫面顯示的是剛登入的方式，不是裝置紀錄", async () => {
    localStorage.setItem(LAST_LOGIN_METHOD_KEY, JSON.stringify({ method: "email", masked: "zz***@other.com" }));
    await signedInAgain(() => json({ ok: true }));
    const confirm = vi.fn(async () => false);
    await finish({ confirm });
    expect(confirm.mock.calls[0][0]).toMatch(/^你已用 \S*\*\*\*\S* 確認身分/);
    expect(confirm.mock.calls[0][0]).not.toContain("zz***");
  });

  it("預設的確認畫面：取消和確認兩個按鈕，都用 textContent，按了就關，按確認才算同意", async () => {
    const calls = await signedInAgain(() => json({ ok: true }));
    const pending = finishPlanRecoveryAfterCallback({ auth, config: CONFIG, sleep: async () => {}, reload: vi.fn() });

    const dialog = await vi.waitFor(() => {
      const found = document.querySelector("#plan-recovery-result");
      expect(found).not.toBeNull();
      return found;
    });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector(".custom-confirm-title").textContent).toBe("確認找回你的計畫");
    expect(dialog.querySelector(".custom-confirm-desc").textContent).toContain("無法復原");
    expect(dialog.textContent).not.toMatch(/帳號|合併/);
    expect(dialog.querySelector(".custom-confirm-btn-cancel").textContent).toBe("取消");
    expect(calls).toHaveLength(1);

    dialog.querySelector(".custom-confirm-btn-cancel").click();
    expect(await pending).toEqual({ status: "declined" });
    expect(document.querySelector("#plan-recovery-result")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("按確認且通過：同時送出兩個 token，才換成舊方式的 token、清掉上一個方式的本機資料；按知道了才重新載入", async () => {
    localStorage.setItem("active_reading_plans", "[]");
    const calls = await signedInAgain(() => json({ ok: true }));

    const { result, message, showResult, reload } = await finish();

    expect(result).toEqual({ status: "merged" });
    expect(message).toBe("已找回你的計畫和閱讀紀錄。之後用之前或現在的方式登入都可以。");
    expect(calls[1]).toEqual({
      action: "complete",
      source_token: SOURCE.access,
      target_access_token: TARGET.access,
      target_id_token: TARGET.id
    });
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(TARGET.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe(TARGET.refresh);
    expect(allStored()).not.toContain(SOURCE.access);
    expect(allStored()).not.toContain(SOURCE.refresh);
    expect(localStorage.getItem("active_reading_plans")).toBeNull();
    expect(window.location.search).toBe("");
    expect(reload).not.toHaveBeenCalled();
    showResult.mock.calls[0][1].onClose();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("回應沒帶 refresh token：找回後不會留著上一個人的 refresh token", async () => {
    stubNetwork({
      recoverPlan: body => (body.action === "start" ? startOk() : json({ ok: true })),
      tokenResponse: { access_token: TARGET.access, id_token: TARGET.id, expires_in: 3600 }
    });
    await pressRecover();
    await returnFromLogto();
    await finish();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(TARGET.access);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBeNull();
  });

  it.each([
    ["same_account", 409, "還是現在這個方式"],
    ["not_eligible", 403, "沒有辦法自動找回"],
    ["rate_limited", 429, "太多次"],
    ["challenge_invalid", 409, "暫時無法完成"],
    ["invalid_token", 401, "暫時無法完成"],
    ["merge_failed", 500, "暫時無法完成"]
  ])("伺服器拒絕（%s）：顯示友善訊息，不重試，還是原本的登入", async (error, status, text) => {
    const calls = await signedInAgain(() => json({ error }, status));

    const { result, message, reload } = await finish();

    expect(result).toEqual({ status: error });
    expect(message).toContain(text);
    expect(message).not.toMatch(/帳號|合併/);
    expect(calls).toHaveLength(2);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(allStored()).not.toContain(TARGET.access);
  });

  it("函式暫時忙碌、連線中斷：重試，成功就算成功", async () => {
    let attempts = 0;
    const calls = await signedInAgain(() => {
      attempts += 1;
      if (attempts === 1) return json({ error: "busy" }, 503);
      if (attempts === 2) throw new TypeError("Failed to fetch");
      return json({ ok: true });
    });

    const { result } = await finish();

    expect(result).toEqual({ status: "merged" });
    expect(calls).toHaveLength(4);
  });

  it("一直失敗：最多 3 次，不卡住也不丟例外，還是原本的登入", async () => {
    const calls = await signedInAgain(() => { throw new TypeError("Failed to fetch"); });

    const { result, message } = await finish();

    expect(result).toEqual({ status: "failed" });
    expect(message).toContain("暫時無法完成");
    expect(calls).toHaveLength(4);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
    expect(auth.isLoggedIn()).toBe(true);
    expect(window.loader.hide).toHaveBeenCalled();
  });

  it("Logto 沒給 id_token 以外的東西：不顯示確認畫面，告訴他沒有完成", async () => {
    stubNetwork({ recoverPlan: startOk, tokenResponse: { id_token: TARGET.id } });
    await pressRecover();
    await returnFromLogto();

    const { result, confirm } = await finish();

    expect(result).toEqual({ status: "failed" });
    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.accessToken)).toBe(SOURCE.access);
  });

  it("顯示結果的畫面出錯也不丟例外", async () => {
    await signedInAgain(() => json({ ok: true }));
    await expect(finish({ showResult: () => { throw new Error("no dom"); } })).resolves.toBeTruthy();
  });

  it("確認畫面出錯：不送出，不丟例外", async () => {
    const calls = await signedInAgain(() => json({ ok: true }));
    const { result } = await finish({ confirm: () => { throw new Error("no dom"); } });
    expect(result).toEqual({ status: "failed" });
    expect(calls).toHaveLength(1);
  });

  it("預設的結果對話框：用 textContent 顯示，掛在 body 頂層，按知道了才重新載入", async () => {
    await signedInAgain(() => json({ ok: true }));
    const reload = vi.fn();
    await finishPlanRecoveryAfterCallback({ auth, config: CONFIG, sleep: async () => {}, confirm: async () => true, reload });
    const dialog = document.querySelector("#plan-recovery-result");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector(".custom-confirm-desc").textContent).toContain("已找回你的計畫");
    expect(dialog.textContent).not.toMatch(/帳號|合併/);
    expect(reload).not.toHaveBeenCalled();
    dialog.querySelector("button").click();
    expect(document.querySelector("#plan-recovery-result")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("開機流程的接法", () => {
  it("db.js：處理完登入回呼才收尾，不等會友回答確認畫面；不是回呼就先清掉流程", () => {
    const source = readFileSync("js/db.js", "utf8");
    const callback = source.indexOf("await auth.handleCallback()");
    const finishAt = source.indexOf("void finishPlanRecoveryAfterCallback()");
    expect(callback).toBeGreaterThan(-1);
    expect(finishAt).toBeGreaterThan(callback);
    expect(source).not.toContain("await finishPlanRecoveryAfterCallback()");
    const abandon = source.indexOf("if (!hasOAuthCallback) abandonPlanRecovery()");
    expect(abandon).toBeGreaterThan(-1);
    expect(abandon).toBeLessThan(callback);
  });
});
