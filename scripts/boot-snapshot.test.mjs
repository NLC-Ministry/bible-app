// 開機快照：快取先畫、背景更新（#630）
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOOT_SNAPSHOT_KEY,
  BOOT_SNAPSHOT_MAX_AGE_MS,
  BOOT_SNAPSHOT_VERSION,
  bootSnapshotToLoadResults,
  buildBootSnapshot,
  isUsableBootSnapshot
} from "../js/data/boot-snapshot.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = read("js/app.js");
const db = read("js/db.js");
const auth = read("js/auth.js");

const NOW = Date.parse("2026-10-28T08:00:00+08:00");
const rows = { globalPlans: [{ id: "g1" }], profile: { id: "u1", name: "測試" }, plans: [{ id: "p1" }] };
const snapshot = (overrides = {}) => ({ ...buildBootSnapshot({ userId: "u1", ...rows, roleDefinitions: [{ id: "r1" }], now: NOW }), ...overrides });

describe("buildBootSnapshot", () => {
  it("keeps one snapshot per device, tagged with its owner and time", () => {
    expect(snapshot()).toMatchObject({
      key: BOOT_SNAPSHOT_KEY, version: BOOT_SNAPSHOT_VERSION, userId: "u1", updatedAt: NOW,
      globalPlans: rows.globalPlans, profile: rows.profile, plans: rows.plans, roleDefinitions: [{ id: "r1" }]
    });
  });

  it("refuses to save an incomplete load", () => {
    expect(buildBootSnapshot({ userId: "", ...rows })).toBeNull();
    expect(buildBootSnapshot({ userId: "u1", ...rows, profile: null })).toBeNull();
    expect(buildBootSnapshot({ userId: "u1", ...rows, globalPlans: null })).toBeNull();
    expect(buildBootSnapshot({ userId: "u1", ...rows, plans: undefined })).toBeNull();
  });
});

describe("isUsableBootSnapshot", () => {
  it("accepts the same person's snapshot within 7 days", () => {
    expect(isUsableBootSnapshot(snapshot(), { userId: "u1", now: NOW + BOOT_SNAPSHOT_MAX_AGE_MS })).toBe(true);
  });

  it("never shows another person's home page", () => {
    expect(isUsableBootSnapshot(snapshot(), { userId: "u2", now: NOW })).toBe(false);
    expect(isUsableBootSnapshot(snapshot(), { userId: null, now: NOW })).toBe(false);
  });

  it("drops stale, future-dated, unknown-format or missing snapshots", () => {
    expect(isUsableBootSnapshot(snapshot(), { userId: "u1", now: NOW + BOOT_SNAPSHOT_MAX_AGE_MS + 1 })).toBe(false);
    expect(isUsableBootSnapshot(snapshot(), { userId: "u1", now: NOW - 1 })).toBe(false);
    expect(isUsableBootSnapshot(snapshot({ version: 0 }), { userId: "u1", now: NOW })).toBe(false);
    expect(isUsableBootSnapshot(snapshot({ globalPlans: null }), { userId: "u1", now: NOW })).toBe(false);
    expect(isUsableBootSnapshot(null, { userId: "u1", now: NOW })).toBe(false);
  });
});

describe("bootSnapshotToLoadResults", () => {
  const scope = { mode: "open", openPlanIds: ["p1"] };
  const digest = { chapters: [], read_dates: [] };

  it("feeds the cached rows and the offline reading-log snapshot into the normal apply step", () => {
    const results = bootSnapshotToLoadResults(snapshot(), { logs: [{ id: 1 }], scope, digest });
    expect(results.globalPlansResult).toEqual({ data: rows.globalPlans, error: null });
    expect(results.profileResult).toEqual({ data: rows.profile, error: null });
    expect(results.plansResult).toEqual({ data: rows.plans, error: null });
    expect(results.bootLogs).toMatchObject({ logsResult: { data: [{ id: 1 }], error: null }, scope, digest, closedPlanIds: [] });
    // 螢光筆不從快照合併
    expect(results.highlightsResult.error).toBeTruthy();
  });

  it("is unusable without a closed-plan digest (ended plans' progress would read as zero)", () => {
    expect(bootSnapshotToLoadResults(snapshot(), { logs: [], scope, digest: null })).toBeNull();
    expect(bootSnapshotToLoadResults(snapshot(), { logs: [], scope: { mode: "all" }, digest })).toBeNull();
  });
});

describe("wiring", () => {
  it("renders from the snapshot while the live load is already in flight, then redraws in place", () => {
    const dataLoad = app.indexOf("const dataLoadPromise = Promise.allSettled([");
    const navGen = app.indexOf("const navGenBeforeDataLoad = navRenderGuard.current;");
    const snapshotRender = app.indexOf("if (await db.applyBootSnapshot())");
    const awaitLive = app.indexOf("const [roleResult, userDataResult] = await dataLoadPromise;");
    expect(dataLoad).toBeGreaterThan(-1);
    expect(navGen).toBeGreaterThan(dataLoad);
    // 在記下導覽號碼之後才畫：資料回來時走「原地重畫」，不重設捲動位置
    expect(snapshotRender).toBeGreaterThan(navGen);
    expect(awaitLive).toBeGreaterThan(snapshotRender);
    const block = app.slice(navGen, awaitLive);
    expect(block).toContain("initialSessionSyncSucceeded && !resumePlan && !bootHashRoute && isAppShellVisible(document)");
    expect(block).toMatch(/catch \(err\)/);
  });

  it("builds the screen with the same apply step as a live load, minus every write-back", () => {
    expect(db).toContain("return this._applyLoadedUserData(user, {");
    expect(db).toContain("await this._applyLoadedUserData({ id: userId, oidc: true }, results, { fromSnapshot: true });");
    const apply = db.slice(db.indexOf("async _applyLoadedUserData("), db.indexOf("  async loadUserData(force = false"));
    expect(apply).toContain("if (!fromSnapshot) this._liveUserDataApplied = true;");
    expect(apply).toContain("if (logsLoaded && !fromSnapshot) {");
    expect(apply).toContain("if (!fromSnapshot && typeof checkAchievements !== 'undefined') {");
    expect(apply).toMatch(/if \(user\.oidc && initialDataLoadSucceeded\) \{\n\s+this\.saveBootSnapshot\(/);
  });

  it("never lets the snapshot overwrite live data that arrived first", () => {
    const fn = db.slice(db.indexOf("  async applyBootSnapshot() {"), db.indexOf("  // loadUserData 抓完資料之後的套用段。"));
    expect(fn.match(/this\._liveUserDataApplied/g)?.length).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("state.currentProfileId !== userId");
    expect(fn).toContain("state.offlineMode");
  });

  it("clears the snapshot on logout", () => {
    const logout = auth.slice(auth.indexOf("  async logout() {"), auth.indexOf("state.supabase.auth.signOut", auth.indexOf("  async logout() {")));
    expect(logout).toContain("window.db?.clearBootSnapshot?.()");
  });
});
