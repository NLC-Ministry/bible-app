import { describe, expect, it } from "vitest";
import {
  buildHashRoute,
  createHashRouteSync,
  currentRouteFromState,
  parseHashRoute,
  planRouteKey,
  resolveRoutePlan,
  takePendingHashRoute,
  savePendingHashRoute
} from "./hash-route.mjs";

describe("parseHashRoute", () => {
  it("returns null for no route", () => {
    for (const hash of ["", "#", "#/", "#foo", "#/unknown", null, undefined]) {
      expect(parseHashRoute(hash)).toBeNull();
    }
  });

  it("parses tab routes", () => {
    expect(parseHashRoute("#/home")).toEqual({ tab: "dashboard-view" });
    expect(parseHashRoute("#/bible")).toEqual({ tab: "reader-view" });
    expect(parseHashRoute("#/plans")).toEqual({ tab: "plan-view" });
    expect(parseHashRoute("#/profile")).toEqual({ tab: "profile-view" });
    expect(parseHashRoute("#/admin")).toEqual({ tab: "admin-view" });
  });

  it("parses plan detail and group views", () => {
    expect(parseHashRoute("#/plan/abc-123")).toEqual({ tab: "plan-view", planKey: "abc-123", planView: "progress" });
    expect(parseHashRoute("#/plan/abc-123/stats")).toEqual({ tab: "plan-view", planKey: "abc-123", planView: "stats" });
    expect(parseHashRoute("#/plan/abc-123/ranking")).toEqual({ tab: "plan-view", planKey: "abc-123", planView: "ranking" });
    expect(parseHashRoute("#/plan/abc-123/personal")).toEqual({ tab: "plan-view", planKey: "abc-123", planView: "personal" });
    expect(parseHashRoute("#/plan/abc-123/whatever")).toEqual({ tab: "plan-view", planKey: "abc-123", planView: "progress" });
    expect(parseHashRoute("#/plan/" + encodeURIComponent("2026 Q4"))).toEqual({ tab: "plan-view", planKey: "2026 Q4", planView: "progress" });
    expect(parseHashRoute("#/plan/")).toEqual({ tab: "plan-view" });
  });

  it("parses profile and admin subpages", () => {
    expect(parseHashRoute("#/profile/exams")).toEqual({ tab: "profile-view", profileDetail: "exams" });
    expect(parseHashRoute("#/admin/lightning-quiz")).toEqual({ tab: "admin-view", adminSection: "lightning-quiz" });
    expect(parseHashRoute("#/admin/<script>")).toEqual({ tab: "admin-view" });
  });

  it("keeps the legacy #my-exams link working", () => {
    expect(parseHashRoute("#my-exams")).toEqual({ tab: "profile-view", profileDetail: "exams" });
  });

  it("ignores a malformed percent-encoding instead of throwing", () => {
    expect(parseHashRoute("#/plan/%E0%A4%A")).toEqual({ tab: "plan-view" });
  });
});

describe("buildHashRoute", () => {
  it("uses no hash for the home tab", () => {
    expect(buildHashRoute(null)).toBe("");
    expect(buildHashRoute({ tab: "dashboard-view" })).toBe("");
  });

  it("round-trips every route shape", () => {
    const routes = [
      { tab: "reader-view" },
      { tab: "plan-view" },
      { tab: "plan-view", planKey: "abc-123", planView: "progress" },
      { tab: "plan-view", planKey: "2026 Q4", planView: "ranking" },
      { tab: "profile-view" },
      { tab: "profile-view", profileDetail: "exams" },
      { tab: "admin-view" },
      { tab: "admin-view", adminSection: "users" }
    ];
    for (const route of routes) {
      expect(parseHashRoute(buildHashRoute(route))).toEqual(route);
    }
  });

  it("writes the plan progress view without a suffix", () => {
    expect(buildHashRoute({ tab: "plan-view", planKey: "p1", planView: "progress" })).toBe("#/plan/p1");
    expect(buildHashRoute({ tab: "plan-view", planKey: "p1", planView: "stats" })).toBe("#/plan/p1/stats");
  });
});

describe("planRouteKey / resolveRoutePlan", () => {
  const joined = { id: "enroll-1", globalPlanId: "global-1", presetKey: "preset-1" };
  const personal = { id: "enroll-2", globalPlanId: null, presetKey: "enroll-2" };
  const unjoined = { id: "global-9", globalPlanId: "global-9", planKind: "standard" };

  it("prefers the shared global plan id so a link works for other members", () => {
    expect(planRouteKey(joined)).toBe("global-1");
    expect(planRouteKey(personal)).toBe("enroll-2");
    expect(planRouteKey(null)).toBe("");
  });

  it("finds a joined plan by global id, own id, or preset key", () => {
    const ctx = { activePlans: [joined, personal], globalPlans: [unjoined] };
    expect(resolveRoutePlan("global-1", ctx)).toEqual({ plan: joined, joined: true });
    expect(resolveRoutePlan("enroll-1", ctx)).toEqual({ plan: joined, joined: true });
    expect(resolveRoutePlan("preset-1", ctx)).toEqual({ plan: joined, joined: true });
    expect(resolveRoutePlan("enroll-2", ctx)).toEqual({ plan: personal, joined: true });
  });

  it("falls back to a not-joined global plan, then to nothing", () => {
    const ctx = { activePlans: [joined], globalPlans: [unjoined] };
    expect(resolveRoutePlan("global-9", ctx)).toEqual({ plan: unjoined, joined: false });
    expect(resolveRoutePlan("missing", ctx)).toEqual({ plan: null, joined: false });
    expect(resolveRoutePlan("", ctx)).toEqual({ plan: null, joined: false });
  });
});

describe("currentRouteFromState", () => {
  const plan = { id: "enroll-1", globalPlanId: "global-1" };

  it("maps each tab", () => {
    expect(currentRouteFromState({ currentTab: "dashboard-view" })).toEqual({ tab: "dashboard-view" });
    expect(currentRouteFromState({ currentTab: "reader-view" })).toEqual({ tab: "reader-view" });
    expect(currentRouteFromState({ currentTab: "plan-view" })).toEqual({ tab: "plan-view" });
  });

  it("describes an open plan detail and its group view", () => {
    expect(currentRouteFromState({ currentTab: "plan-view", activePlan: plan, planDetailOpen: true, planViewState: "DETAIL" }))
      .toEqual({ tab: "plan-view", planKey: "global-1", planView: "progress" });
    expect(currentRouteFromState({ currentTab: "plan-view", activePlan: plan, planDetailOpen: true, planViewState: "GROUP", groupSubview: "ranking" }))
      .toEqual({ tab: "plan-view", planKey: "global-1", planView: "ranking" });
    expect(currentRouteFromState({ currentTab: "plan-view", activePlan: plan, planDetailOpen: false, planViewState: "LIST" }))
      .toEqual({ tab: "plan-view" });
  });

  it("includes profile and admin subpages only when open", () => {
    expect(currentRouteFromState({ currentTab: "profile-view", profileDetailOpen: "badges" }))
      .toEqual({ tab: "profile-view", profileDetail: "badges" });
    expect(currentRouteFromState({ currentTab: "admin-view", adminSection: "users" }))
      .toEqual({ tab: "admin-view", adminSection: "users" });
    expect(currentRouteFromState({ currentTab: "admin-view", adminSection: null }))
      .toEqual({ tab: "admin-view" });
  });
});

function makeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

describe("pending route across the login redirect", () => {
  it("keeps a deep link for a short while and hands it out once", () => {
    const storage = makeStorage();
    savePendingHashRoute(storage, "#/plan/p1/stats", 1000);
    expect(takePendingHashRoute(storage, 2000)).toEqual({ tab: "plan-view", planKey: "p1", planView: "stats" });
    expect(takePendingHashRoute(storage, 2000)).toBeNull();
  });

  it("can peek without consuming", () => {
    const storage = makeStorage();
    savePendingHashRoute(storage, "#/bible", 0);
    expect(takePendingHashRoute(storage, 0, { consume: false })).toEqual({ tab: "reader-view" });
    expect(takePendingHashRoute(storage, 0)).toEqual({ tab: "reader-view" });
    expect(takePendingHashRoute(storage, 0)).toBeNull();
  });

  it("drops a stale pending route", () => {
    const storage = makeStorage();
    savePendingHashRoute(storage, "#/admin/users", 0);
    expect(takePendingHashRoute(storage, 11 * 60 * 1000)).toBeNull();
  });

  it("does not save a hash that is not a route, and survives a broken storage", () => {
    const storage = makeStorage();
    savePendingHashRoute(storage, "#foo", 0);
    expect(takePendingHashRoute(storage, 0)).toBeNull();
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
    expect(() => savePendingHashRoute(broken, "#/bible", 0)).not.toThrow();
    expect(takePendingHashRoute(broken, 0)).toBeNull();
  });
});

function makeBrowser(href, state = null) {
  const calls = [];
  const url = new URL(href);
  const location = {
    get href() { return url.href; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; }
  };
  const history = {
    state,
    replaceState(nextState, _title, nextUrl) {
      calls.push({ state: nextState, url: nextUrl });
      this.state = nextState;
      const next = new URL(nextUrl, url.href);
      url.hash = next.hash;
      url.search = next.search;
      url.pathname = next.pathname;
    }
  };
  return { location, history, calls };
}

describe("createHashRouteSync", () => {
  it("does nothing until enabled, so a deep link survives the boot", async () => {
    const browser = makeBrowser("https://app.test/?a=1#/plan/p1", { isAppRoot: true });
    const sync = createHashRouteSync({ ...browser, readRoute: () => ({ tab: "dashboard-view" }) });
    sync.request();
    await Promise.resolve();
    expect(browser.calls).toEqual([]);
    expect(browser.location.hash).toBe("#/plan/p1");
  });

  it("replaces (never pushes) the current entry and keeps its history state", async () => {
    const browser = makeBrowser("https://app.test/?a=1#/plan/p1", { isAppRoot: true });
    let route = { tab: "plan-view", planKey: "p2", planView: "stats" };
    const sync = createHashRouteSync({ ...browser, readRoute: () => route });
    sync.enable();
    await Promise.resolve();
    expect(browser.location.href).toBe("https://app.test/?a=1#/plan/p2/stats");
    expect(browser.history.state).toEqual({ isAppRoot: true });

    route = { tab: "dashboard-view" };
    sync.request();
    sync.request();
    await Promise.resolve();
    expect(browser.location.href).toBe("https://app.test/?a=1");
    expect(browser.calls).toHaveLength(2);
  });

  it("skips the write when the URL already matches", async () => {
    const browser = makeBrowser("https://app.test/#/bible");
    const sync = createHashRouteSync({ ...browser, readRoute: () => ({ tab: "reader-view" }) });
    sync.enable();
    await Promise.resolve();
    expect(browser.calls).toEqual([]);
  });

  it("swallows a readRoute failure instead of breaking navigation", async () => {
    const browser = makeBrowser("https://app.test/#/bible");
    const sync = createHashRouteSync({ ...browser, readRoute: () => { throw new Error("boom"); } });
    sync.enable();
    await Promise.resolve();
    expect(browser.calls).toEqual([]);
  });
});
