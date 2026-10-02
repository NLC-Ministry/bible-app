// #398：開 App 不再等登入同步。
// - syncNlcSessionWithSupabase 同時只送一個 nlc-session（force=false 可搭 force=true 的便車，反過來不行）。
// - 樂觀開機期間 getCurrentDbUser() 直接回傳已還原的身分，不等背景同步。
// - edge cache 還有效時路徑不變；同步失敗不會讓呼叫端 crash。
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE = { id: "profile-1", name: "測試會友", role: "member" };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function okResponse(profile = PROFILE) {
  return { ok: true, status: 200, json: async () => ({ edge_session: true, profile, locked_fields: [] }) };
}

describe("boot does not wait for the NLC session sync (#398)", () => {
  let dom, db, fetchMock, pending;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    pending = [];
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
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
    fetchMock = vi.fn(() => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabaseConfig: { url: "https://supabase.example.test", anonKey: "anon" },
      supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
      currentUser: null,
      currentProfileId: null,
      optimisticBootPending: false
    });
    await import("../js/db.js?boot-no-wait-sync");
    db = dom.window.db || globalThis.db;
    // Keep the test focused on the sync/dedupe logic, not on profile/UI side effects.
    db.applyNlcProfile = vi.fn((profile) => {
      globalThis.state.currentProfileId = profile?.id || null;
      globalThis.state.currentUser = profile || null;
    });
    db.storeOfflineIdentity = vi.fn();
    db.setOfflineNavLock = vi.fn();
    db.createNlcDataClient = vi.fn(() => ({ shim: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it("two concurrent syncs send only one nlc-session request", async () => {
    const a = db.syncNlcSessionWithSupabase(true);
    const b = db.syncNlcSessionWithSupabase(false);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].resolve(okResponse());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.profile.id).toBe(PROFILE.id);
    expect(rb).toBe(ra);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a force=true call does not ride an in-flight force=false call", async () => {
    const a = db.syncNlcSessionWithSupabase(false);
    await flush();
    const b = db.syncNlcSessionWithSupabase(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.forEach(d => d.resolve(okResponse()));
    await Promise.all([a, b]);
  });

  it("starts a new request once the previous one has settled", async () => {
    const a = db.syncNlcSessionWithSupabase(true);
    await flush();
    pending[0].resolve(okResponse());
    await a;
    const b = db.syncNlcSessionWithSupabase(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(okResponse());
    await b;
  });

  it("a failed in-flight sync rejects every rider and is not reused afterwards", async () => {
    const a = db.syncNlcSessionWithSupabase(true);
    const b = db.syncNlcSessionWithSupabase(false);
    await flush();
    pending[0].resolve({ ok: false, status: 401, json: async () => ({ error: "invalid_token" }) });
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    const c = db.syncNlcSessionWithSupabase(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(okResponse());
    await c;
  });

  it("edge cache still valid: force=false uses the cache without any request (unchanged path)", async () => {
    localStorage.setItem("nlc_edge_session_expires_at", String(Date.now() + 5 * 60 * 1000));
    localStorage.setItem("nlc_supabase_profile", JSON.stringify(PROFILE));
    const result = await db.syncNlcSessionWithSupabase(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ edge_session: true, profile: PROFILE, locked_fields: [] });
    expect(globalThis.state.currentProfileId).toBe(PROFILE.id);
    const user = await db.getCurrentDbUser();
    expect(user).toEqual({ id: PROFILE.id, oidc: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("edge cache valid even while a force=true sync is in flight: force=false still takes the cache", async () => {
    localStorage.setItem("nlc_edge_session_expires_at", String(Date.now() + 5 * 60 * 1000));
    localStorage.setItem("nlc_supabase_profile", JSON.stringify(PROFILE));
    const forced = db.syncNlcSessionWithSupabase(true);
    await flush();
    const cached = await db.syncNlcSessionWithSupabase(false);
    expect(cached.edge_session).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].resolve(okResponse());
    await forced;
  });

  it("during optimistic boot getCurrentDbUser returns the cached identity without waiting for the sync", async () => {
    globalThis.state.optimisticBootPending = true;
    globalThis.state.currentProfileId = PROFILE.id;
    const background = db.syncNlcSessionWithSupabase(true); // background reconciliation's call
    await flush();
    const user = await db.getCurrentDbUser();
    expect(user).toEqual({ id: PROFILE.id, oidc: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].resolve(okResponse());
    await background;
  });

  it("outside optimistic boot getCurrentDbUser still waits for the sync (riding the in-flight one)", async () => {
    globalThis.state.currentProfileId = null;
    const background = db.syncNlcSessionWithSupabase(true);
    let settled = false;
    const userPromise = db.getCurrentDbUser().then(u => { settled = true; return u; });
    await flush();
    expect(settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].resolve(okResponse());
    await background;
    expect(await userPromise).toEqual({ id: PROFILE.id, oidc: true });
  });

  it("a failing background sync does not crash getCurrentDbUser callers during optimistic boot", async () => {
    globalThis.state.optimisticBootPending = true;
    globalThis.state.currentProfileId = PROFILE.id;
    const background = db.syncNlcSessionWithSupabase(true).catch(err => err);
    await flush();
    const user = await db.getCurrentDbUser();
    expect(user).toEqual({ id: PROFILE.id, oidc: true });
    pending[0].reject(new TypeError("Failed to fetch"));
    expect(await background).toBeInstanceOf(TypeError);
    // still answers after the failed sync while boot is pending
    expect(await db.getCurrentDbUser()).toEqual({ id: PROFILE.id, oidc: true });
  });

  it("optimistic boot: background reconciliation + getCurrentDbUser send a single nlc-session", async () => {
    globalThis.state.optimisticBootPending = true;
    globalThis.state.currentProfileId = PROFILE.id;
    db.updateAuthUI = vi.fn();
    db.refreshRoleDependentUI = vi.fn();
    db.showConnectionError = vi.fn();
    const reconcile = db.startBackgroundSessionReconciliation();
    await flush();
    const user = await db.getCurrentDbUser();
    expect(user).toEqual({ id: PROFILE.id, oidc: true });
    // a late force=false caller rides the same request
    const rider = db.syncNlcSessionWithSupabase(false);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0].resolve(okResponse());
    await Promise.all([reconcile, rider]);
    expect(globalThis.state.optimisticBootPending).toBe(false);
    expect(db.showConnectionError).not.toHaveBeenCalled();
  });

  it("optimistic boot: a really expired session still ends on the login card via reconciliation", async () => {
    globalThis.state.optimisticBootPending = true;
    globalThis.state.currentProfileId = PROFILE.id;
    db.showConnectionError = vi.fn();
    const reconcile = db.startBackgroundSessionReconciliation();
    await flush();
    expect(await db.getCurrentDbUser()).toEqual({ id: PROFILE.id, oidc: true });
    pending[0].resolve({ ok: false, status: 401, json: async () => ({ error: "invalid_token" }) });
    await reconcile;
    expect(db.showConnectionError).toHaveBeenCalledTimes(1);
    expect(globalThis.state.optimisticBootPending).toBe(false);
  });
});
