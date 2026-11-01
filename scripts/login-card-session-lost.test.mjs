// #645：登入卡
// - 背景確認發現會員中心阻擋狀態時，畫面跟冷啟動一樣（applyLoginGateView），不是「連線錯誤」卡。
// - 缺姓名的畫面多一個換回原本登入方式的連結（#648 起文字是「找不到以前的進度？換回上次的登入方式」）。
// - 一般登入畫面只有歡迎詞＋登入按鈕；紅點狀態只在真正的連線錯誤／登入失效時出現。
// - 曾經登入過的人 token 失效時直接轉去 SSO，5 分鐘內只轉一次。
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLoginGateView, getLoginGateCopy } from "../js/login-onboarding-gate.mjs";
import {
  AUTO_SSO_REDIRECT_COOLDOWN_MS,
  AUTO_SSO_REDIRECT_KEY,
  maybeAutoRedirectToSso,
  shouldAutoRedirectToSso
} from "../js/login-auto-redirect.mjs";
import { OFFLINE_IDENTITY_KEY } from "../js/data/offline-identity.mjs";

const html = readFileSync("index.html", "utf8");
const app = readFileSync("js/app.js", "utf8");

function gateDom() {
  const card = html.slice(html.indexOf('<div class="login-gate hidden" id="login-gate">'), html.indexOf("<!-- Verse Note Editor Mount Root"));
  const dom = new JSDOM(`<!doctype html><body>${card}<div class="app-layout"></div></body>`);
  const doc = dom.window.document;
  const loginGate = doc.getElementById("login-gate");
  return {
    doc,
    els: {
      loginGate,
      appLayout: doc.querySelector(".app-layout"),
      titleEl: loginGate.querySelector(".login-title"),
      subtitleEl: doc.getElementById("login-gate-subtitle"),
      buttonEl: doc.getElementById("btn-gate-nlc-login"),
      refreshActionsEl: doc.getElementById("login-gate-refresh-actions")
    }
  };
}

const hidden = (el) => !el || el.classList.contains("hidden");

describe("login card copy and view (#645)", () => {
  it("first-time visitors see only the welcome text and the sign-in button", () => {
    const { doc, els } = gateDom();
    applyLoginGateView({ block: null, hasTokens: false, ...els });
    expect(doc.querySelector("[data-login-method-hint]")).toBeNull();
    expect(hidden(doc.querySelector("[data-login-switch-account]"))).toBe(true);
    expect(hidden(doc.getElementById("gate-status-container"))).toBe(true);
    expect(els.buttonEl.dataset.loginGateMode).toBe("sso");
  });

  it("not registered (#650): short subtitle, Hub button, and a secondary switch-account link", () => {
    const { doc, els } = gateDom();
    const copy = applyLoginGateView({ block: { reason: "member_not_registered" }, hasTokens: true, ...els });
    expect(els.titleEl.textContent).toBe("請先到會員中心註冊");
    expect(els.subtitleEl.textContent).toBe("這個帳號還沒在教會的會員中心註冊。註冊好回到這裡就能開始。會開啟教會的會員頁面。");
    expect(els.subtitleEl.textContent).not.toContain("這不是登入失敗");
    expect(els.buttonEl.textContent).toBe("去註冊");
    expect(els.buttonEl.dataset.loginGateMode).toBe("hub-continue");
    expect(els.buttonEl.dataset.loginGateReason).toBe("member_not_registered");
    expect(copy.switchAccount).toBe(true);
    const link = doc.querySelector("[data-login-switch-account]");
    expect(hidden(link)).toBe(false);
    expect(link.textContent.trim()).toBe("找不到以前的進度？換回上次的登入方式");
    expect(hidden(doc.getElementById("gate-status-container"))).toBe(true);
  });

  it("right after returning from the Hub and still not registered: re-check, not another trip (#650)", () => {
    const copy = getLoginGateCopy({ reason: "member_not_registered" }, { hasTokens: true, returnedFromHub: true });
    expect(copy.button).toBe("重新確認");
    expect(copy.mode).toBe("retry-sync");
    expect(copy.switchAccount).toBe(true);
  });

  it("the missing-name and membership-form screens are gone (#650)", () => {
    for (const reason of ["member_profile_required", "membership_application_required"]) {
      const copy = getLoginGateCopy({ reason }, { hasTokens: true });
      expect(copy.title, reason).not.toBe("請先填寫姓名");
      expect(copy.title, reason).not.toBe("請先完成會籍登記");
    }
  });

  it("existing-member and retry screens don't offer switching accounts", () => {
    for (const reason of ["inactive_membership", "member_context_unavailable", "unknown_member_hub_action"]) {
      expect(getLoginGateCopy({ reason }, { hasTokens: true }).switchAccount, reason).toBeFalsy();
    }
    expect(getLoginGateCopy(null, { hasTokens: false }).switchAccount).toBeFalsy();
  });

  it("a later hub-block view clears a red status line left by an earlier error", () => {
    const { doc, els } = gateDom();
    const status = doc.getElementById("gate-status-container");
    status.classList.remove("hidden");
    doc.getElementById("gate-status-text").textContent = "登入過期了，請再登入一次。讀經進度不會不見。";
    applyLoginGateView({ block: { reason: "member_not_registered" }, hasTokens: true, ...els });
    expect(hidden(status)).toBe(true);
  });
});

describe("auto SSO redirect decision (#645)", () => {
  const base = { hasIdentitySnapshot: true, embedded: false, online: true, lastRedirectAt: 0, now: 10_000_000 };

  it("redirects a returning member", () => {
    expect(shouldAutoRedirectToSso(base)).toBe(true);
  });

  it("never for first-time visitors, in-app browsers, or offline", () => {
    expect(shouldAutoRedirectToSso({ ...base, hasIdentitySnapshot: false })).toBe(false);
    expect(shouldAutoRedirectToSso({ ...base, embedded: true })).toBe(false);
    expect(shouldAutoRedirectToSso({ ...base, online: false })).toBe(false);
  });

  it("only once per 5 minutes", () => {
    expect(shouldAutoRedirectToSso({ ...base, lastRedirectAt: base.now - 60_000 })).toBe(false);
    expect(shouldAutoRedirectToSso({ ...base, lastRedirectAt: base.now - AUTO_SSO_REDIRECT_COOLDOWN_MS - 1 })).toBe(true);
  });

  function memoryStorage(entries = {}) {
    const store = new Map(Object.entries(entries));
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      store
    };
  }
  const snapshot = (now) => JSON.stringify({ verifiedAt: new Date(now - 86_400_000).toISOString(), profile: { id: "p1" } });

  it("records the attempt, then the second session loss within 5 minutes shows the card", () => {
    const now = 50_000_000;
    const storage = memoryStorage({ [OFFLINE_IDENTITY_KEY]: snapshot(now) });
    const launch = vi.fn(() => true);
    expect(maybeAutoRedirectToSso({ storage, online: true, embedded: false, now, launch })).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(storage.store.get(AUTO_SSO_REDIRECT_KEY)).toBe(String(now));
    expect(maybeAutoRedirectToSso({ storage, online: true, embedded: false, now: now + 60_000, launch })).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("no usable snapshot (never signed in, or older than 30 days) → no redirect", () => {
    const now = 50_000_000_000;
    const launch = vi.fn(() => true);
    expect(maybeAutoRedirectToSso({ storage: memoryStorage(), online: true, embedded: false, now, launch })).toBe(false);
    const stale = JSON.stringify({ verifiedAt: new Date(now - 31 * 86_400_000).toISOString(), profile: { id: "p1" } });
    expect(maybeAutoRedirectToSso({ storage: memoryStorage({ [OFFLINE_IDENTITY_KEY]: stale }), online: true, embedded: false, now, launch })).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });

  it("can't record the attempt (storage blocked) → don't redirect, so it can never loop", () => {
    const now = 50_000_000;
    const storage = memoryStorage({ [OFFLINE_IDENTITY_KEY]: snapshot(now) });
    storage.setItem = () => { throw new Error("QuotaExceeded"); };
    const launch = vi.fn(() => true);
    expect(maybeAutoRedirectToSso({ storage, online: true, embedded: false, now, launch })).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("app.js routes lost sessions through the auto-redirect gate (#645)", () => {
  it("foreground / session-expired / reconnect use db.showSessionLostGate", () => {
    const helper = app.slice(app.indexOf("function surfaceLoginCardIfSessionLost"), app.indexOf("function onAppForeground"));
    expect(helper).toContain("db.showSessionLostGate()");
    expect(app).toContain("window.db.showSessionLostGate()");
  });
});

describe("db: background reconciliation and session loss (#645)", () => {
  let dom, db, block, launch;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    block = null;
    vi.doMock("../js/member-journey.mjs", async (importOriginal) => ({
      ...(await importOriginal()),
      getUserOnboardingBlock: () => block
    }));
    const card = html.slice(html.indexOf('<div class="login-gate hidden" id="login-gate">'), html.indexOf("<!-- Verse Note Editor Mount Root"));
    dom = new JSDOM(`<!doctype html><body>${card}<div class="app-layout"></div></body>`, { url: "https://example.test/" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("auth", {
      isLoggedIn: () => true,
      getValidAccessToken: async () => "access-token",
      getLogtoSubject: () => "logto-sub",
      keys: { idToken: "nlc_id_token" }
    });
    launch = vi.fn(() => true);
    dom.window.authLaunch = { startInteractiveAuth: launch };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ edge_session: true, profile: { id: "p1" }, locked_fields: [] })
    })));
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabaseConfig: { url: "https://supabase.example.test", anonKey: "anon" },
      supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
      currentUser: null,
      currentProfileId: null,
      optimisticBootPending: true
    });
    await import("../js/db.js?login-card-645");
    db = dom.window.db || globalThis.db;
    db.applyNlcProfile = vi.fn((profile) => {
      globalThis.state.currentProfileId = profile?.id || null;
      globalThis.state.currentUser = profile || null;
    });
    db.storeOfflineIdentity = vi.fn();
    db.setOfflineNavLock = vi.fn();
    db.createNlcDataClient = vi.fn(() => ({ shim: true }));
    db.updateAuthUI = vi.fn();
    db.refreshRoleDependentUI = vi.fn();
  });

  afterEach(() => {
    vi.doUnmock("../js/member-journey.mjs");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  it("not registered found by the background check shows the same card as a cold boot", async () => {
    block = { reason: "member_not_registered" };
    const doc = dom.window.document;
    doc.querySelector(".app-layout").classList.remove("hidden");
    await db.startBackgroundSessionReconciliation();
    expect(doc.getElementById("login-gate").classList.contains("hidden")).toBe(false);
    expect(doc.querySelector(".login-title").textContent).toBe("請先到會員中心註冊");
    const btn = doc.getElementById("btn-gate-nlc-login");
    expect(btn.textContent).toBe("去註冊");
    expect(btn.dataset.loginGateMode).toBe("hub-continue");
    expect(doc.querySelector("[data-login-switch-account]").classList.contains("hidden")).toBe(false);
    expect(doc.getElementById("gate-status-container").classList.contains("hidden")).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });

  it("a rejected session redirects a returning member to SSO instead of showing the card", async () => {
    localStorage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify({ verifiedAt: new Date().toISOString(), profile: { id: "p1" } }));
    db.showSessionLostGate();
    expect(launch).toHaveBeenCalledWith({ intent: "login", returnTo: "/" });
    // 轉址前先換成乾淨的登入畫面：轉不成時還有按鈕，也沒有紅字
    const doc = dom.window.document;
    expect(doc.getElementById("login-gate").classList.contains("hidden")).toBe(false);
    expect(doc.getElementById("btn-gate-nlc-login").dataset.loginGateMode).toBe("sso");
    expect(doc.getElementById("gate-status-container").classList.contains("hidden")).toBe(true);
  });

  it("the second loss within 5 minutes shows a sign-in card whose button really signs in", () => {
    localStorage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify({ verifiedAt: new Date().toISOString(), profile: { id: "p1" } }));
    localStorage.setItem(AUTO_SSO_REDIRECT_KEY, String(Date.now() - 60_000));
    const doc = dom.window.document;
    const btn = doc.getElementById("btn-gate-nlc-login");
    btn.dataset.loginGateMode = "hub-continue"; // left over from an earlier hub-block view
    db.showSessionLostGate();
    expect(launch).not.toHaveBeenCalled();
    expect(doc.getElementById("login-gate").classList.contains("hidden")).toBe(false);
    expect(btn.dataset.loginGateMode).toBe("sso");
    expect(doc.getElementById("gate-status-container").classList.contains("hidden")).toBe(false);
    expect(doc.getElementById("gate-status-text").textContent).toBe("登入過期了，請再登入一次。讀經進度不會不見。");
    expect(doc.querySelector("[data-login-switch-account]").classList.contains("hidden")).toBe(true);
  });
});
