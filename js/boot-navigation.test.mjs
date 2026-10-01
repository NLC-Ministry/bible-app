import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { isAppShellVisible, resolvePostLoadTab } from "./boot-navigation.mjs";

describe("resolvePostLoadTab", () => {
  it("goes to the landing tab when nobody navigated during the load", () => {
    expect(resolvePostLoadTab({
      landingTab: "dashboard-view",
      navGenAtStart: 3,
      navGenNow: 3,
      currentTab: "dashboard-view"
    })).toBe("dashboard-view");
  });

  it("keeps the tab the user tapped while data was still loading (#388)", () => {
    expect(resolvePostLoadTab({
      landingTab: "dashboard-view",
      navGenAtStart: 3,
      navGenNow: 4,
      currentTab: "plan-view"
    })).toBe("plan-view");
  });

  it("keeps the user's tab over a resumed plan or quick-launch landing", () => {
    expect(resolvePostLoadTab({
      landingTab: "plan-view",
      navGenAtStart: 1,
      navGenNow: 2,
      currentTab: "profile-view"
    })).toBe("profile-view");
    expect(resolvePostLoadTab({
      landingTab: "reader-view",
      navGenAtStart: 1,
      navGenNow: 2,
      currentTab: "dashboard-view"
    })).toBe("dashboard-view");
  });

  it("falls back to the landing tab when the current tab is unknown", () => {
    expect(resolvePostLoadTab({
      landingTab: "dashboard-view",
      navGenAtStart: 1,
      navGenNow: 2,
      currentTab: null
    })).toBe("dashboard-view");
  });
});

describe("isAppShellVisible", () => {
  const docWith = ({ gateHidden, layoutHidden }) => new JSDOM(`
    <div id="login-gate" class="${gateHidden ? "hidden" : ""}"></div>
    <div class="app-layout ${layoutHidden ? "hidden" : ""}"></div>
  `).window.document;

  it("is false while the login gate is showing (#389)", () => {
    expect(isAppShellVisible(docWith({ gateHidden: false, layoutHidden: true }))).toBe(false);
  });

  it("is true once the gate is hidden and the app layout is shown", () => {
    expect(isAppShellVisible(docWith({ gateHidden: true, layoutHidden: false }))).toBe(true);
  });

  it("is false when the app layout is still hidden", () => {
    expect(isAppShellVisible(docWith({ gateHidden: true, layoutHidden: true }))).toBe(false);
  });

  it("is false without a document", () => {
    expect(isAppShellVisible(null)).toBe(false);
  });
});
