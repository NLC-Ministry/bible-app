import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanupProductionStorage, RETIRED_STORAGE_KEYS } from "../js/production-cleanup.mjs";

const auth = readFileSync("js/auth.js", "utf8");
const db = readFileSync("js/db.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
const repair = readFileSync("repair.html", "utf8");

// History: login failures used to arm a "修復並重新登入" detour through
// /repair?resume_login=1, as a proxy for "this device is running a stale
// build". It fired on routine session expiry and user-cancelled logins, so
// users kept seeing the repair screen. Stale builds are now detected directly
// (js/pwa/VersionWatcher.js), so a login failure is just a login failure.
describe("login failures never detour through /repair", () => {
  it("has no login-repair state or redirect in auth.js", () => {
    for (const removed of ["markLoginFailure", "shouldRepairBeforeLogin", "startLoginRepair", "clearLoginRepairState", "nlc_login_repair_required", "resume_login"]) {
      expect(auth).not.toContain(removed);
    }
  });

  it("the login button always logs in directly, labelled 重新登入 after a failure", () => {
    expect(db).not.toContain("shouldRepairBeforeLogin");
    expect(db).not.toContain("resume_login");
    expect(db).not.toContain("\\u4fee\\u5fa9\\u4e26\\u91cd\\u65b0\\u767b\\u5165"); // 修復並重新登入
    expect(db).toContain('btnNlcGate.textContent = "\\u91cd\\u65b0\\u767b\\u5165";'); // 重新登入
    expect(app).not.toContain("markRepair");
  });

  it("the repair page only clears SW + caches and never touches login tokens", () => {
    expect(repair).not.toContain("resume_login");
    expect(repair).not.toContain("nlc_access_token");
    expect(repair).not.toContain('localStorage.removeItem("reading_logs")');
    expect(repair).toContain("registration.unregister()");
  });

  it("removes the leftover repair flag from devices that ran the old build", () => {
    expect(RETIRED_STORAGE_KEYS).toContain("nlc_login_repair_required");
    const store = new Map([["nlc_login_repair_required", '{"count":2}'], ["nlc_access_token", "keep-me"]]);
    const storage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: index => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    };
    cleanupProductionStorage(storage);
    expect(store.has("nlc_login_repair_required")).toBe(false);
    expect(store.get("nlc_access_token")).toBe("keep-me");
  });
});
