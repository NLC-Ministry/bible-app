// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_SWITCH_HINT_MAX_AGE_DAYS,
  accountSwitchHintMarkup,
  bindAccountSwitchHint,
  isAccountSwitchHintDismissed,
  shouldShowAccountSwitchHint
} from "../js/modules/account-switch-hint.mjs";
import { applyLoginGateView } from "../js/login-onboarding-gate.mjs";

// #615：會友換一種方式登入（原本手機號碼、這次 Email），Logto 給新的 sub、會員中心另建會員，
// nlc-session 就開了全新的空帳號——會友只看到「我的計畫不見了」。
// 新帳號、會員中心不是正式會友、一個計畫都沒有 → 在空白畫面提示改用原本的方式登入。

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

  it("shows for a new non-official account with no plans (the reported case)", () => {
    expect(show()).toBe(true);
    expect(show({ membershipStatus: "visitor" })).toBe(true);
  });

  it("never shows to an official member — the Hub already knows them, so this is a real first login", () => {
    expect(show({ membershipStatus: "official_member" })).toBe(false);
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

describe("login gate: same-method reminder", () => {
  const gate = () => {
    document.body.innerHTML = `
      <div class="login-gate hidden" id="login-gate">
        <h2 class="login-title"></h2>
        <p id="login-gate-subtitle"></p>
        <button id="btn-gate-nlc-login"></button>
        <p data-login-method-hint>hint</p>
      </div>
      <div class="app-layout"></div>`;
    return {
      loginGate: document.getElementById("login-gate"),
      appLayout: document.querySelector(".app-layout"),
      buttonEl: document.getElementById("btn-gate-nlc-login"),
      hintEl: document.querySelector("[data-login-method-hint]")
    };
  };

  it("shows the reminder on the plain sign-in screen", () => {
    const els = gate();
    els.hintEl.classList.add("hidden");
    applyLoginGateView({ block: null, hasTokens: false, ...els });
    expect(els.hintEl.classList.contains("hidden")).toBe(false);
  });

  it("hides it on the onboarding/retry screens where the member is already signed in", () => {
    const els = gate();
    applyLoginGateView({ block: { reason: "member_context_unavailable" }, hasTokens: true, ...els });
    expect(els.hintEl.classList.contains("hidden")).toBe(true);
  });

  it("index.html carries the reminder inside the login card", () => {
    const html = readFileSync("index.html", "utf8");
    const card = html.slice(html.indexOf('id="login-gate"'), html.indexOf('id="gate-status-container"'));
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
});
