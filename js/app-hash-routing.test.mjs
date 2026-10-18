import { describe, expect, it, vi } from "vitest";
import { createAppHashRouting } from "./app-hash-routing.mjs";

function makeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

function makeClassList(initial = []) {
  const set = new Set(initial);
  return { contains: name => set.has(name), add: name => set.add(name), remove: name => set.delete(name) };
}

function makeHarness({ href = "https://app.test/", loginGateOpen = false, role = "member", state: stateOverrides = {}, win: winOverrides = {} } = {}) {
  const url = new URL(href);
  const listeners = {};
  const history = {
    state: null,
    replaceState(nextState, _title, nextUrl) {
      this.state = nextState;
      url.hash = new URL(nextUrl, url.href).hash;
    }
  };
  const win = {
    sessionStorage: makeStorage(),
    history,
    location: {
      get href() { return url.href; },
      get pathname() { return url.pathname; },
      get search() { return url.search; },
      get hash() { return url.hash; },
      get hostname() { return url.hostname; },
      assign: vi.fn()
    },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    currentPlanViewState: "LIST",
    PlanPageController: { groupSubview: null },
    syncActivePlanContext: vi.fn(),
    openProfileDetail: vi.fn(),
    ...winOverrides
  };
  const loginGate = { classList: makeClassList(loginGateOpen ? [] : ["hidden"]) };
  const doc = {
    getElementById: id => (id === "login-gate" ? loginGate : null),
    querySelector: () => null
  };
  const state = {
    activePlans: [],
    globalPlans: [],
    activePlan: null,
    planDetailOpen: false,
    planActiveSubTab: "today",
    profileDetailOpen: null,
    offlineMode: false,
    ...stateOverrides
  };
  const switched = [];
  const appRouter = {
    currentTab: "dashboard-view",
    switchTab: vi.fn(async (tab, options = {}) => {
      appRouter.currentTab = tab;
      switched.push({ tab, options, planDetailOpen: state.planDetailOpen, activePlan: state.activePlan });
    })
  };
  const pastoralModule = { openPastoralTab: vi.fn(), getPastoralRouteTab: () => null };
  const toast = vi.fn();
  const routing = createAppHashRouting({
    win,
    doc,
    appRouter,
    state,
    loadModule: vi.fn(async name => (name === "pastoral" ? pastoralModule : {})),
    getLoadedModule: name => (name === "pastoral" ? pastoralModule : null),
    getRole: () => role,
    toast
  });
  return { routing, win, state, appRouter, switched, pastoralModule, toast, loginGate, listeners, url };
}

const joinedPlan = { id: "enroll-1", globalPlanId: "global-1", name: "Q4" };

describe("boot deep link", () => {
  it("opens a joined plan's detail straight away", async () => {
    const h = makeHarness({ href: "https://app.test/#/plan/global-1", state: { activePlans: [joinedPlan] } });
    expect(h.routing.captureBootRoute()).toEqual({ tab: "plan-view", planKey: "global-1", planView: "progress" });
    await expect(h.routing.finishBoot()).resolves.toBe(true);
    expect(h.switched).toEqual([{ tab: "plan-view", options: { keepPlanDetail: true }, planDetailOpen: true, activePlan: joinedPlan }]);
    expect(h.state.planActiveSubTab).toBe("today");
    expect(h.win.currentPlanViewState).toBe("DETAIL");
    expect(h.win.syncActivePlanContext).toHaveBeenCalledWith(joinedPlan);
  });

  it("opens the plan's ranking view", async () => {
    const h = makeHarness({ href: "https://app.test/#/plan/global-1/ranking", state: { activePlans: [joinedPlan] } });
    h.routing.captureBootRoute();
    await h.routing.finishBoot();
    expect(h.state.planActiveSubTab).toBe("ranking");
    expect(h.win.currentPlanViewState).toBe("GROUP");
    expect(h.win.PlanPageController.groupSubview).toBe("ranking");
  });

  it("falls back to the plan list when the plan is unknown or not joined", async () => {
    const campaign = { id: "global-5", globalPlanId: "global-5", planKind: "standard" };
    for (const key of ["missing", "global-5"]) {
      const h = makeHarness({ href: `https://app.test/#/plan/${key}`, state: { globalPlans: [campaign], activePlan: joinedPlan } });
      h.routing.captureBootRoute();
      await h.routing.finishBoot();
      expect(h.switched).toEqual([{ tab: "plan-view", options: { keepPlanDetail: true }, planDetailOpen: false, activePlan: joinedPlan }]);
      expect(h.toast).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps a member out of the admin tab", async () => {
    for (const section of ["users", "roster"]) {
      const h = makeHarness({ href: `https://app.test/#/admin/${section}`, role: "member" });
      h.routing.captureBootRoute();
      await h.routing.finishBoot();
      expect(h.switched.map(entry => entry.tab)).toEqual(["dashboard-view"]);
      expect(h.pastoralModule.openPastoralTab).not.toHaveBeenCalled();
      expect(h.win.location.assign).not.toHaveBeenCalled();
    }
  });

  it("opens the leader tab a manager's link asks for, old section names included (#551)", async () => {
    for (const section of ["teams", "join-status"]) {
      const h = makeHarness({ href: `https://app.test/#/admin/${section}`, role: "zone_leader" });
      h.routing.captureBootRoute();
      await h.routing.finishBoot();
      expect(h.switched.map(entry => entry.tab)).toEqual(["admin-view"]);
      expect(h.pastoralModule.openPastoralTab).toHaveBeenCalledWith(section);
    }
  });

  it("sends the system administrator's old system-section links to the console (#551)", async () => {
    const h = makeHarness({ href: "https://bible.newlife.org.tw/#/admin/lightning-quiz", role: "admin" });
    h.routing.captureBootRoute();
    await h.routing.finishBoot();
    expect(h.win.location.assign).toHaveBeenCalledWith("https://bible-speed-reading-admin.vercel.app/#/content/lightning-quiz");
    expect(h.switched).toEqual([]);
  });

  it("a leader's old system-section link just opens the 管理 tab (no console for them)", async () => {
    const h = makeHarness({ href: "https://app.test/#/admin/users", role: "pastor" });
    h.routing.captureBootRoute();
    await h.routing.finishBoot();
    expect(h.win.location.assign).not.toHaveBeenCalled();
    expect(h.switched.map(entry => entry.tab)).toEqual(["admin-view"]);
    expect(h.pastoralModule.openPastoralTab).not.toHaveBeenCalled();
  });

  it("opens the profile exams page from the legacy #my-exams link", async () => {
    const h = makeHarness({ href: "https://app.test/#my-exams" });
    h.routing.captureBootRoute();
    await h.routing.finishBoot();
    expect(h.switched.map(entry => entry.tab)).toEqual(["profile-view"]);
    expect(h.win.openProfileDetail).toHaveBeenCalledWith("exams");
  });

  it("does not move a user who already tapped another tab during the load", async () => {
    const h = makeHarness({ href: "https://app.test/#/bible" });
    h.routing.captureBootRoute();
    await expect(h.routing.finishBoot({ userNavigated: true })).resolves.toBe(false);
    expect(h.switched).toEqual([]);
  });

  it("leaves offline reading mode to the normal boot", async () => {
    const h = makeHarness({ href: "https://app.test/#/plans", state: { offlineMode: true } });
    h.routing.captureBootRoute();
    await expect(h.routing.finishBoot()).resolves.toBe(false);
    expect(h.switched).toEqual([]);
  });

  it("keeps the route across the login redirect, then opens it after login", async () => {
    const first = makeHarness({ href: "https://app.test/#/plan/global-1", loginGateOpen: true, state: { activePlans: [joinedPlan] } });
    first.routing.captureBootRoute();
    await expect(first.routing.finishBoot()).resolves.toBe(false);
    expect(first.switched).toEqual([]);
    expect(first.url.hash).toBe("#/plan/global-1");

    // 登入跳轉回來：同一個分頁（同一份 sessionStorage），網址不帶 hash。
    const second = makeHarness({ href: "https://app.test/", state: { activePlans: [joinedPlan] }, win: { sessionStorage: first.win.sessionStorage } });
    expect(second.routing.captureBootRoute()).toEqual({ tab: "plan-view", planKey: "global-1", planView: "progress" });
    await expect(second.routing.finishBoot()).resolves.toBe(true);
    expect(second.state.activePlan).toBe(joinedPlan);

    // 用掉就清掉，下一次開機不會又跳過去。
    const third = makeHarness({ href: "https://app.test/", win: { sessionStorage: first.win.sessionStorage } });
    expect(third.routing.captureBootRoute()).toBeNull();
  });

  it("skips the hash route when Bible Hub asked to resume a plan", async () => {
    const h = makeHarness({ href: "https://app.test/#/bible" });
    h.routing.captureBootRoute();
    await expect(h.routing.finishBoot({ skipRoute: true })).resolves.toBe(false);
    expect(h.switched).toEqual([]);
  });
});

describe("keeping the URL in step with the view", () => {
  it("writes the current view once boot routing is done", async () => {
    const h = makeHarness({ href: "https://app.test/?x=1", state: { activePlans: [joinedPlan] } });
    h.routing.captureBootRoute();
    h.routing.requestSync();
    await Promise.resolve();
    expect(h.url.hash).toBe("");

    await h.routing.finishBoot();
    h.appRouter.currentTab = "plan-view";
    h.state.activePlan = joinedPlan;
    h.state.planDetailOpen = true;
    h.win.currentPlanViewState = "DETAIL";
    h.routing.requestSync();
    await Promise.resolve();
    expect(h.url.href).toBe("https://app.test/?x=1#/plan/global-1");
  });
});

describe("fresh navigation and links", () => {
  it("treats a popstate onto a new route hash as navigation", async () => {
    const h = makeHarness({ href: "https://app.test/#/bible" });
    expect(h.routing.handleFreshNavigation()).toBe(true);
    expect(h.win.history.state).toEqual({ isAppRoot: true });
    await Promise.resolve();
    expect(h.switched.map(entry => entry.tab)).toEqual(["reader-view"]);
  });

  it("leaves a non-route hash to the back-button handling", () => {
    const h = makeHarness({ href: "https://app.test/#section-2" });
    expect(h.routing.handleFreshNavigation()).toBe(false);
  });

  it("opens in-app #/ links without letting the browser add a history entry", async () => {
    const h = makeHarness();
    const link = { getAttribute: () => "#/plans" };
    const event = { defaultPrevented: false, button: 0, target: { closest: () => link }, preventDefault: vi.fn() };
    h.routing.handleLinkClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(h.switched.map(entry => entry.tab)).toEqual(["plan-view"]);

    const plain = { defaultPrevented: false, button: 0, target: { closest: () => ({ getAttribute: () => "https://example.org" }) }, preventDefault: vi.fn() };
    h.routing.handleLinkClick(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
  });
});
