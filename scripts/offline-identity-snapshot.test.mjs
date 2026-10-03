// #417：Logto 拒絕續期時只刪 token、保留身分快照；快照記住是哪個 Logto 帳號，
// 手機上有 token 時只有同一個帳號的快照能拿來先開畫面（換人登入不會閃出上一個人的資料）。
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_IDENTITY_MAX_AGE_MS,
  OFFLINE_IDENTITY_SCHEMA_VERSION,
  buildOfflineIdentity,
  resolveUsableOfflineIdentity
} from "../js/data/offline-identity.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const PROFILE_A = { id: "profile-a", name: "甲會友" };

function snapshot(overrides = {}) {
  return { ...buildOfflineIdentity({ profile: PROFILE_A, logtoSub: "sub-a", now: NOW - 1000 }), ...overrides };
}

describe("resolveUsableOfflineIdentity", () => {
  it("records the Logto account and bumps the schema version", () => {
    const identity = snapshot();
    expect(identity.schemaVersion).toBe(OFFLINE_IDENTITY_SCHEMA_VERSION);
    expect(identity.logtoSub).toBe("sub-a");
  });

  it("uses the snapshot when the signed-in account is the same person", () => {
    expect(resolveUsableOfflineIdentity(snapshot(), { hasTokens: true, currentSub: "sub-a", now: NOW })).not.toBeNull();
  });

  it("ignores the snapshot when a different person is signed in", () => {
    expect(resolveUsableOfflineIdentity(snapshot(), { hasTokens: true, currentSub: "sub-b", now: NOW })).toBeNull();
  });

  it("ignores a legacy snapshot (no Logto account recorded) while signed in", () => {
    const legacy = snapshot({ schemaVersion: 1, logtoSub: undefined });
    expect(resolveUsableOfflineIdentity(legacy, { hasTokens: true, currentSub: "sub-a", now: NOW })).toBeNull();
  });

  it("ignores the snapshot when signed in but the current account cannot be read", () => {
    expect(resolveUsableOfflineIdentity(snapshot(), { hasTokens: true, currentSub: null, now: NOW })).toBeNull();
  });

  it("keeps offline reading working without tokens (nothing to compare against)", () => {
    expect(resolveUsableOfflineIdentity(snapshot(), { hasTokens: false, now: NOW })).not.toBeNull();
    const legacy = snapshot({ schemaVersion: 1, logtoSub: undefined });
    expect(resolveUsableOfflineIdentity(legacy, { hasTokens: false, now: NOW })).not.toBeNull();
  });

  it("still expires after 30 days", () => {
    const old = snapshot({ verifiedAt: new Date(NOW - OFFLINE_IDENTITY_MAX_AGE_MS - 1).toISOString() });
    expect(resolveUsableOfflineIdentity(old, { hasTokens: true, currentSub: "sub-a", now: NOW })).toBeNull();
  });
});

describe("db.js uses the account-checked snapshot", () => {
  let dom, db, authStub;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    authStub = { loggedIn: true, sub: "sub-a" };
    vi.stubGlobal("auth", {
      isLoggedIn: () => authStub.loggedIn,
      getLogtoSubject: () => authStub.sub,
      getValidAccessToken: async () => "access-token",
      keys: { idToken: "nlc_id_token" }
    });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabaseConfig: { url: "https://supabase.example.test", anonKey: "anon" },
      currentUser: null,
      currentProfileId: null
    });
    await import("../js/db.js?offline-identity-snapshot");
    db = dom.window.db || globalThis.db;
    db.applyNlcProfile = vi.fn();
    db.updateAuthUI = vi.fn();
    db.refreshRoleDependentUI = vi.fn();
    db.setOfflineNavLock = vi.fn();
    db.createNlcDataClient = vi.fn(() => ({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function storeSnapshotFor(sub) {
    authStub.sub = sub;
    db.storeOfflineIdentity({ id: "profile-" + sub, name: sub });
  }

  it("storeOfflineIdentity records the signed-in Logto account", () => {
    storeSnapshotFor("sub-a");
    const stored = JSON.parse(localStorage.getItem("offline_trusted_identity"));
    expect(stored.logtoSub).toBe("sub-a");
    expect(stored.profile.id).toBe("profile-sub-a");
  });

  it("opens the app from the snapshot when the same person signs back in", () => {
    storeSnapshotFor("sub-a");
    authStub.sub = "sub-a";
    expect(db.applyCachedIdentitySnapshot({ markAsOffline: false })).toBe(true);
    expect(db.applyNlcProfile).toHaveBeenCalledWith(expect.objectContaining({ id: "profile-sub-a" }), []);
  });

  it("does not show the previous person's data when someone else signs in on the same phone", () => {
    storeSnapshotFor("sub-a");
    authStub.sub = "sub-b";
    expect(db.applyCachedIdentitySnapshot({ markAsOffline: false })).toBe(false);
    expect(db.applyNlcProfile).not.toHaveBeenCalled();
    expect(db.updateAuthUI).not.toHaveBeenCalled();
  });

  it("offline reading without tokens still restores the snapshot", () => {
    storeSnapshotFor("sub-a");
    authStub.loggedIn = false;
    authStub.sub = null;
    expect(db.tryRestoreOfflineSession()).toBe(true);
  });
});

describe("Logto refresh rejection keeps the identity snapshot", () => {
  const authSource = readFileSync("js/auth.js", "utf8");

  it("_doRefreshOnce clears tokens but no longer deletes offline_trusted_identity", () => {
    const start = authSource.indexOf("async _doRefreshOnce(");
    const body = authSource.slice(start, authSource.indexOf("\n  },", start));
    expect(body).toContain("this._clearStoredTokens();");
    expect(body).not.toContain('removeItem("offline_trusted_identity")');
  });

  it("an intentional logout still deletes the snapshot", () => {
    const start = authSource.indexOf("async logout()");
    const body = authSource.slice(start, authSource.indexOf("\n  },", start));
    expect(body).toContain('localStorage.removeItem("offline_trusted_identity");');
  });
});
