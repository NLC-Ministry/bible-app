// #677：久沒登入的會友回來時容易換一種登入方式，Logto 給新的 sub，App 就開出空帳號。
// 登入成功後在裝置記下這次的方式（只存遮罩值），登入卡顯示一行提醒。
// 分裂後開的空帳號不記，提醒才會指向原本有計畫的舊帳號。
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_LOGIN_METHOD_KEY,
  loginMethodHintText,
  readLastLoginMethod,
  rememberLoginMethod
} from "../js/login-method-memory.mjs";
import { applyLoginGateView } from "../js/login-onboarding-gate.mjs";
import { OFFLINE_IDENTITY_KEY } from "../js/data/offline-identity.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-04T12:00:00+08:00");
const daysAgo = days => new Date(NOW - days * DAY).toISOString();

const PHONE_ACCOUNT = { phone: "886912345678", email: "" };
const EMAIL_ACCOUNT = { phone: "", email: "abcdef@gmail.com" };
const GENERIC_HINT = "請用跟上次相同的方式（手機、Email、Google 或 LINE）登入，才看得到你的計畫。";

function memoryStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    store
  };
}

describe("rememberLoginMethod", () => {
  const remember = (storage, overrides = {}) => rememberLoginMethod({
    user: PHONE_ACCOUNT,
    accountCreatedAt: daysAgo(200),
    hasAnyPlan: true,
    storage,
    now: NOW,
    ...overrides
  });

  it("stores only the masked account, never the raw phone or Email", () => {
    const storage = memoryStorage();
    remember(storage);
    const raw = storage.store.get(LAST_LOGIN_METHOD_KEY);
    expect(JSON.parse(raw)).toEqual({ method: "phone", masked: "0912-***-678" });
    expect(raw).not.toContain("912345678");

    const emailStorage = memoryStorage();
    remember(emailStorage, { user: EMAIL_ACCOUNT });
    const emailRaw = emailStorage.store.get(LAST_LOGIN_METHOD_KEY);
    expect(JSON.parse(emailRaw)).toEqual({ method: "email", masked: "ab***@gmail.com" });
    expect(emailRaw).not.toContain("abcdef");
  });

  it("does not record a new account with no plans, so the old account's method survives the split", () => {
    const storage = memoryStorage();
    remember(storage);
    remember(storage, { user: EMAIL_ACCOUNT, accountCreatedAt: daysAgo(1), hasAnyPlan: false });
    expect(JSON.parse(storage.store.get(LAST_LOGIN_METHOD_KEY)).method).toBe("phone");
  });

  it("records a new account once it has a plan, and an old account with no plans", () => {
    const newWithPlan = memoryStorage();
    remember(newWithPlan, { accountCreatedAt: daysAgo(1), hasAnyPlan: true });
    expect(JSON.parse(newWithPlan.store.get(LAST_LOGIN_METHOD_KEY)).method).toBe("phone");

    const oldNoPlan = memoryStorage();
    remember(oldNoPlan, { accountCreatedAt: daysAgo(31), hasAnyPlan: false });
    expect(JSON.parse(oldNoPlan.store.get(LAST_LOGIN_METHOD_KEY)).method).toBe("phone");
  });

  it("does not record a plan-less account whose age it can't tell", () => {
    for (const accountCreatedAt of ["", null, "not-a-date"]) {
      const storage = memoryStorage();
      remember(storage, { accountCreatedAt, hasAnyPlan: false });
      expect(storage.store.has(LAST_LOGIN_METHOD_KEY)).toBe(false);
    }
  });

  it("an account with both phone and Email names no method, and replaces the older record", () => {
    const storage = memoryStorage();
    remember(storage);
    remember(storage, { user: { phone: "886912345678", email: "abcdef@gmail.com" } });
    expect(JSON.parse(storage.store.get(LAST_LOGIN_METHOD_KEY))).toEqual({ method: "", masked: "" });
    expect(loginMethodHintText(readLastLoginMethod({ storage, now: NOW }))).toBe(GENERIC_HINT);
  });

  it("does not throw when storage is blocked", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("QuotaExceeded"); };
    expect(() => remember(storage)).not.toThrow();
  });
});

describe("readLastLoginMethod", () => {
  const snapshot = (profile, verifiedDaysAgo = 1) => JSON.stringify({
    verifiedAt: daysAgo(verifiedDaysAgo),
    profile: { id: "p1", ...profile }
  });

  it("returns null with no record and no snapshot, or a corrupt record", () => {
    expect(readLastLoginMethod({ storage: memoryStorage(), now: NOW })).toBeNull();
    expect(readLastLoginMethod({ storage: memoryStorage({ [LAST_LOGIN_METHOD_KEY]: "{oops" }), now: NOW })).toBeNull();
  });

  it("first run after the upgrade: seeds from the identity snapshot, even an expired one, and saves it", () => {
    const storage = memoryStorage({
      [OFFLINE_IDENTITY_KEY]: snapshot({ ...PHONE_ACCOUNT, created_at: daysAgo(200) }, 90)
    });
    expect(readLastLoginMethod({ storage, now: NOW })).toEqual({ method: "phone", masked: "0912-***-678", profileId: "p1" });
    expect(JSON.parse(storage.store.get(LAST_LOGIN_METHOD_KEY)).method).toBe("phone");
  });

  it("seeding follows the same rule: a new empty account's snapshot is not used", () => {
    const empty = memoryStorage({
      [OFFLINE_IDENTITY_KEY]: snapshot({ ...EMAIL_ACCOUNT, created_at: daysAgo(1) }),
      active_reading_plans: "[]"
    });
    expect(readLastLoginMethod({ storage: empty, now: NOW })).toBeNull();
    expect(empty.store.has(LAST_LOGIN_METHOD_KEY)).toBe(false);

    const withPlan = memoryStorage({
      [OFFLINE_IDENTITY_KEY]: snapshot({ ...EMAIL_ACCOUNT, created_at: daysAgo(1) }),
      active_reading_plans: JSON.stringify([{ id: "plan-1" }])
    });
    expect(readLastLoginMethod({ storage: withPlan, now: NOW }).method).toBe("email");
  });

  it("an existing record wins over the snapshot", () => {
    const storage = memoryStorage({
      [LAST_LOGIN_METHOD_KEY]: JSON.stringify({ method: "phone", masked: "0912-***-678" }),
      [OFFLINE_IDENTITY_KEY]: snapshot({ ...EMAIL_ACCOUNT, created_at: daysAgo(200) })
    });
    expect(readLastLoginMethod({ storage, now: NOW }).method).toBe("phone");
  });
});

describe("loginMethodHintText", () => {
  // #682：紀錄只知道帳號有手機還是 Email，分不出密碼、Google、LINE，所以不斷定登入方式。
  it("a Gmail account is told to press Google first (Logto links the same address to this account)", () => {
    expect(loginMethodHintText({ method: "email", masked: "ab***@gmail.com" }))
      .toBe("上次在這台裝置登入的帳號是 ab***@gmail.com。請按 Google 登入，才看得到你的計畫；如果你有設密碼，也可以輸入密碼。");
    expect(loginMethodHintText({ method: "email", masked: "ab***@GMail.com" })).toContain("請按 Google 登入");
  });

  it("another Email address lists every way, without claiming which one they used", () => {
    expect(loginMethodHintText({ method: "email", masked: "ab***@church.org" }))
      .toBe("上次在這台裝置登入的帳號是 ab***@church.org。請用當時的方式才看得到你的計畫：按 Google、按 LINE，或輸入 Email 和密碼。");
    expect(loginMethodHintText({ method: "email", masked: "ab***@notgmail.com" })).not.toContain("請按 Google 登入");
  });

  it("a phone account lists every way, without claiming which one they used", () => {
    expect(loginMethodHintText({ method: "phone", masked: "0912-***-678" }))
      .toBe("上次在這台裝置登入的帳號是 0912-***-678。請用當時的方式才看得到你的計畫：按 LINE、按 Google，或輸入手機和密碼。");
  });

  it("zh-Hant has the same lines as the defaults here", () => {
    const copy = readFileSync("js/copy/zh-Hant.js", "utf8");
    const source = readFileSync("js/login-method-memory.mjs", "utf8");
    for (const line of [
      "上次在這台裝置登入的帳號是 {account}。請按 Google 登入，才看得到你的計畫；如果你有設密碼，也可以輸入密碼。",
      "上次在這台裝置登入的帳號是 {account}。請用當時的方式才看得到你的計畫：按 Google、按 LINE，或輸入 Email 和密碼。",
      "上次在這台裝置登入的帳號是 {account}。請用當時的方式才看得到你的計畫：按 LINE、按 Google，或輸入手機和密碼。",
      GENERIC_HINT
    ]) {
      expect(copy).toContain(line);
      expect(source).toContain(line);
    }
  });

  it("falls back to the generic line with no record or an unknown method", () => {
    expect(loginMethodHintText(null)).toBe(GENERIC_HINT);
    expect(loginMethodHintText({ method: "", masked: "" })).toBe(GENERIC_HINT);
  });
});

describe("db records the method after the plan list loads", () => {
  let db;
  const ok = data => ({ data, error: null });
  const load = (plansResult, options = {}) => db._applyLoadedUserData({ id: "profile-a", oidc: true }, {
    globalPlansResult: ok([]),
    profileResult: ok(null),
    plansResult,
    highlightsResult: ok([]),
    bootLogs: null
  }, { skipReadingLogs: true, ...options });
  const stored = () => localStorage.getItem(LAST_LOGIN_METHOD_KEY);

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("auth", { isLoggedIn: () => true, getLogtoSubject: () => "sub-a" });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      currentProfileId: "profile-a",
      currentUser: { ...PHONE_ACCOUNT, account_created_at: new Date(Date.now() - 200 * DAY).toISOString() },
      activePlans: [],
      readingLogs: [],
      highlights: {},
      highlightTimestamps: {}
    });
    await import("../js/db.js?login-method-memory");
    db = dom.window.db || globalThis.db;
    db.calculateStreak = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("an old account is recorded once the plan list arrives", async () => {
    await load(ok([]));
    expect(JSON.parse(stored())).toEqual({ method: "phone", masked: "0912-***-678", profileId: "profile-a" });
  });

  it("a new empty account is not recorded", async () => {
    state.currentUser.account_created_at = new Date(Date.now() - DAY).toISOString();
    await load(ok([]));
    expect(stored()).toBeNull();
  });

  it("a failed plan load or a boot snapshot records nothing", async () => {
    await load({ data: null, error: { message: "boom" } });
    expect(stored()).toBeNull();
    await load(ok([]), { fromSnapshot: true });
    expect(stored()).toBeNull();
  });
});

describe("login card shows the reminder", () => {
  const html = readFileSync("index.html", "utf8");

  function gate(storage) {
    const card = html.slice(html.indexOf('<div class="login-gate hidden" id="login-gate">'), html.indexOf("<!-- Verse Note Editor Mount Root"));
    const dom = new JSDOM(`<!doctype html><body>${card}<div class="app-layout"></div></body>`);
    const doc = dom.window.document;
    const loginGate = doc.getElementById("login-gate");
    return {
      hint: doc.querySelector("[data-login-method-hint]"),
      view: {
        loginGate,
        appLayout: doc.querySelector(".app-layout"),
        titleEl: loginGate.querySelector(".login-title"),
        subtitleEl: doc.getElementById("login-gate-subtitle"),
        buttonEl: doc.getElementById("btn-gate-nlc-login"),
        refreshActionsEl: doc.getElementById("login-gate-refresh-actions"),
        storage
      }
    };
  }

  it("the sign-in screen shows the recorded method as text", () => {
    const { hint, view } = gate(memoryStorage({
      [LAST_LOGIN_METHOD_KEY]: JSON.stringify({ method: "phone", masked: "0912-***-678" })
    }));
    applyLoginGateView({ block: null, hasTokens: false, ...view });
    expect(hint.classList.contains("hidden")).toBe(false);
    expect(hint.textContent).toContain("0912-***-678");
  });

  it("a stored value can't inject markup into the card", () => {
    const { hint, view } = gate(memoryStorage({
      [LAST_LOGIN_METHOD_KEY]: JSON.stringify({ method: "email", masked: "<img src=x>@ex.com" })
    }));
    applyLoginGateView({ block: null, hasTokens: false, ...view });
    expect(hint.querySelector("img")).toBeNull();
  });

  it("the sign-in screen shows the generic line with no record", () => {
    const { hint, view } = gate(memoryStorage());
    applyLoginGateView({ block: null, hasTokens: false, ...view });
    expect(hint.classList.contains("hidden")).toBe(false);
    expect(hint.textContent).toBe(GENERIC_HINT);
  });

  it("stays hidden on screens that are not asking the member to sign in", () => {
    for (const block of [{ reason: "member_not_registered" }, { reason: "member_context_unavailable" }]) {
      const { hint, view } = gate(memoryStorage());
      applyLoginGateView({ block, hasTokens: true, ...view });
      expect(hint.classList.contains("hidden")).toBe(true);
    }
  });

  it("the session-lost card (showConnectionError) renders it too", () => {
    const db = readFileSync("js/db.js", "utf8");
    const handler = db.slice(db.indexOf("  showConnectionError(message"), db.indexOf("  applyLoginOnboardingGate()"));
    expect(handler).toContain("renderLoginMethodHint(");
  });
});
