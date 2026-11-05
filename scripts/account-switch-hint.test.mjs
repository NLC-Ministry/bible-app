// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS,
  accountSwitchHintMarkup,
  bindAccountSwitchHint,
  currentLoginMethod,
  isAccountSwitchHintDismissed,
  maskEmail,
  maskPhone,
  shouldShowAccountSwitchHint
} from "../js/modules/account-switch-hint.mjs";
import { applyLoginGateView } from "../js/login-onboarding-gate.mjs";

// #615：會友換一種方式登入（原本手機號碼、這次 Email），Logto 給新的 sub、會員中心另建會員，
// nlc-session 就開了全新的空帳號——會友只看到「我的計畫不見了」。
// 新帳號、一個計畫都沒有 → 在空白畫面提示改用原本的方式登入。
// #677：會員中心可能很快把新帳號核准成正式會友，所以不再排除正式會友。

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-27T12:00:00+08:00");
const daysAgo = days => new Date(NOW - days * DAY).toISOString();

describe("shouldShowAccountSwitchHint", () => {
  const base = {
    accountCreatedAt: daysAgo(1),
    membershipStatus: "seeker",
    hasAnyPlan: false,
    dismissed: false,
    now: NOW
  };
  const show = overrides => shouldShowAccountSwitchHint({ ...base, ...overrides });

  it("shows for a new account with no plans (the reported case)", () => {
    expect(show()).toBe(true);
    expect(show({ membershipStatus: "visitor" })).toBe(true);
  });

  it("also shows to an official member: the Hub can approve a split account right away (#677)", () => {
    expect(show({ membershipStatus: "official_member" })).toBe(true);
  });

  it("does not show once the account has any plan (active or ended)", () => {
    expect(show({ hasAnyPlan: true })).toBe(false);
  });

  it(`stops after ${ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS} days`, () => {
    expect(show({ accountCreatedAt: daysAgo(ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS - 0.01) })).toBe(true);
    expect(show({ accountCreatedAt: daysAgo(ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS + 0.01) })).toBe(false);
  });

  it("stays hidden when it can't tell: no created_at (old nlc-session) or no Hub status", () => {
    expect(show({ accountCreatedAt: "" })).toBe(false);
    expect(show({ accountCreatedAt: "not-a-date" })).toBe(false);
    expect(show({ membershipStatus: "" })).toBe(false);
    expect(show({ membershipStatus: null })).toBe(false);
  });

  it("does not show after the member said it's their first time", () => {
    expect(show({ dismissed: true })).toBe(false);
  });
});

describe("account switch hint card", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("dismissing hides the card and remembers it per account", () => {
    document.body.innerHTML = `<div id="host">${accountSwitchHintMarkup()}</div>`;
    const onSwitch = vi.fn();
    bindAccountSwitchHint(document.getElementById("host"), { profileId: "profile-a", onSwitch });

    document.querySelector("[data-account-switch-dismiss]").click();

    expect(document.querySelector("[data-account-switch-hint]")).toBeNull();
    expect(isAccountSwitchHintDismissed("profile-a")).toBe(true);
    expect(isAccountSwitchHintDismissed("profile-b")).toBe(false);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("the switch button hands off to the logout callback", () => {
    document.body.innerHTML = `<div id="host">${accountSwitchHintMarkup()}</div>`;
    const onSwitch = vi.fn();
    bindAccountSwitchHint(document.getElementById("host"), { profileId: "profile-a", onSwitch });

    document.querySelector("[data-account-switch-logout]").click();

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(isAccountSwitchHintDismissed("profile-a")).toBe(false);
  });

  it("does nothing when the container has no card", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    expect(() => bindAccountSwitchHint(document.getElementById("host"), { profileId: "p", onSwitch: vi.fn() })).not.toThrow();
  });
});

// #663：會友原本用 Email、這次用手機登入，舊文案「如果你之前用手機號碼…」讓他以為手機就是原本的方式，
// 每次登出又選手機。卡片改成說出「現在」用的是哪一種。
describe("account switch hint: current login method", () => {
  const bodyText = user => {
    document.body.innerHTML = accountSwitchHintMarkup(user);
    return document.querySelector(".account-switch-hint__body").textContent;
  };

  it("masks phone numbers the way nlc-session stores them (886…, no +)", () => {
    expect(maskPhone("886912345678")).toBe("0912-***-678");
    expect(maskPhone("+886 912 345 678")).toBe("0912-***-678");
    expect(maskPhone("0912345678")).toBe("0912-***-678");
    expect(maskPhone("123")).toBe("");
    expect(maskPhone(null)).toBe("");
  });

  it("masks email addresses", () => {
    expect(maskEmail("abcdef@gmail.com")).toBe("ab***@gmail.com");
    expect(maskEmail("a@x.org")).toBe("a***@x.org");
    expect(maskEmail("not-an-email")).toBe("");
    expect(maskEmail("")).toBe("");
  });

  it("only names a method when the account has just one of phone / email", () => {
    expect(currentLoginMethod({ phone: "886912345678", email: null })).toEqual({ method: "phone", masked: "0912-***-678" });
    expect(currentLoginMethod({ phone: "", email: "abcdef@gmail.com" })).toEqual({ method: "email", masked: "ab***@gmail.com" });
    expect(currentLoginMethod({ phone: "886912345678", email: "abcdef@gmail.com" }).method).toBe("");
    expect(currentLoginMethod(undefined).method).toBe("");
  });

  it("a phone login is told it is on the phone and to try Email (the reported case)", () => {
    const text = bodyText({ phone: "886912345678" });
    expect(text).toContain("你現在是用手機 0912-***-678 登入的");
    expect(text).toContain("Email");
    expect(text).not.toContain("如果你之前用手機號碼");
  });

  it("an email login is told it is on Email and to try the phone number", () => {
    const text = bodyText({ email: "abcdef@gmail.com" });
    expect(text).toContain("你現在是用 Email ab***@gmail.com 登入的");
    expect(text).toContain("手機號碼");
  });

  it("falls back to neutral copy when it can't tell", () => {
    const text = bodyText({});
    expect(text).not.toContain("你現在是用");
    expect(text).toContain("Email 或手機號碼");
  });

  it("escapes the shown address", () => {
    document.body.innerHTML = accountSwitchHintMarkup({ email: "<img>x@ex.com" });
    expect(document.querySelector(".account-switch-hint__body img")).toBeNull();
    expect(document.querySelector(".account-switch-hint__account").textContent).toBe("<i***@ex.com");
  });

  it("the profile page logout also forces the Logto sign-in page next time", () => {
    const source = readFileSync("js/modules/profile.js", "utf8");
    const handler = source.slice(source.indexOf("async function handleLogoutAndClearCache"));
    expect(handler.slice(0, handler.indexOf("\n}"))).toContain("auth.logoutToSwitchAccount()");
  });
});

// #645：會員中心不認得這個帳號（沒註冊，#650）時，給換回原本登入方式的連結（#648 起文字是「找不到以前的進度？換回上次的登入方式」）。
// 一般登入畫面的提醒文字見 #677（scripts/login-method-memory.test.mjs）。
describe("login gate: switch-account link", () => {
  const gate = () => {
    document.body.innerHTML = `
      <div class="login-gate hidden" id="login-gate">
        <h2 class="login-title"></h2>
        <p id="login-gate-subtitle"></p>
        <button id="btn-gate-nlc-login"></button>
        <button class="hidden" data-login-switch-account>link</button>
      </div>
      <div class="app-layout"></div>`;
    return {
      loginGate: document.getElementById("login-gate"),
      appLayout: document.querySelector(".app-layout"),
      buttonEl: document.getElementById("btn-gate-nlc-login"),
      linkEl: document.querySelector("[data-login-switch-account]")
    };
  };

  it("stays hidden on the plain sign-in screen", () => {
    const els = gate();
    applyLoginGateView({ block: null, hasTokens: false, ...els });
    expect(els.linkEl.classList.contains("hidden")).toBe(true);
  });

  it("shows on the not-registered screen a switched login method lands on", () => {
    const els = gate();
    applyLoginGateView({ block: { reason: "member_not_registered" }, hasTokens: true, ...els });
    expect(els.linkEl.classList.contains("hidden")).toBe(false);
  });

  it("index.html carries the link and the same-method reminder (#677) inside the login card", () => {
    const html = readFileSync("index.html", "utf8");
    const card = html.slice(html.indexOf('id="login-gate"'), html.indexOf('id="gate-status-container"'));
    expect(card).toContain("data-login-switch-account");
    expect(card).toContain("data-login-method-hint");
  });
});

describe("auth: switching account forces the Logto sign-in page", () => {
  let auth;

  beforeAll(async () => {
    globalThis.state = { currentUser: {} };
    globalThis.loader = { show: vi.fn(), hide: vi.fn() };
    globalThis.showToast = vi.fn();
    globalThis.getRoleDefinition = () => null;
    await import("../js/auth.js");
    auth = window.auth;
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    auth.metadata = { authorization_endpoint: "https://sso.example.test/oidc/auth", token_endpoint: "https://sso.example.test/oidc/token" };
    auth.config.clientId = "test-client";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const loginUrl = async () => {
    const navigate = vi.spyOn(auth, "_navigateToAuthorization").mockImplementation(() => {});
    await auth.startInteractiveLogin({ intent: "login", returnTo: "/" });
    expect(navigate).toHaveBeenCalledTimes(1);
    return new URL(navigate.mock.calls[0][0]);
  };

  it("a normal login keeps SSO (no prompt), so other NLC apps' session still signs in silently", async () => {
    expect((await loginUrl()).searchParams.has("prompt")).toBe(false);
  });

  it("after logoutToSwitchAccount the next login asks Logto for prompt=login, once", async () => {
    vi.spyOn(auth, "logout").mockResolvedValue(undefined);
    await auth.logoutToSwitchAccount();
    expect(auth.logout).toHaveBeenCalledTimes(1);

    expect((await loginUrl()).searchParams.get("prompt")).toBe("login");
    vi.restoreAllMocks();
    expect((await loginUrl()).searchParams.has("prompt")).toBe(false);
  });

  it("a real logout keeps the remembered login method for the next sign-in card (#677)", async () => {
    localStorage.setItem("nlc_last_login_method", JSON.stringify({ method: "phone", masked: "0912-***-678" }));
    vi.spyOn(auth, "_finishLocalLogout").mockImplementation(() => {});
    await auth.logoutToSwitchAccount();
    expect(auth._finishLocalLogout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("nlc_last_login_method")).method).toBe("phone");
  });
});
