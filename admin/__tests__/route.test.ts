// 後台網址格式（#555）：可以直接用網址連到某個人。
import { describe, it, expect } from "vitest";
import { areaOf, formatRoute, parseRoute } from "../src/route.ts";
import { canUse, visibleNavItems } from "../src/nav.ts";
import { describeItem, cursorAfter, usableCursor } from "../src/items.ts";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

describe("parseRoute / formatRoute", () => {
  it("defaults to the report inbox; user search has its own address (#550)", () => {
    expect(parseRoute("")).toEqual({ view: "inbox", reportId: null });
    expect(parseRoute("#/")).toEqual({ view: "inbox", reportId: null });
    expect(parseRoute("#/support")).toEqual({ view: "inbox", reportId: null });
    expect(parseRoute("#/support/users")).toEqual({ view: "search" });
    expect(formatRoute({ view: "search" })).toBe("#/support/users");
  });

  it("opens a report directly", () => {
    const route = parseRoute(`#/support/report/${ID.toUpperCase()}`);
    expect(route).toEqual({ view: "inbox", reportId: ID });
    expect(formatRoute(route)).toBe(`#/support/report/${ID}`);
    expect(parseRoute("#/support/report/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute(`#/support/report/${ID}/extra`)).toEqual({ view: "not_found" });
  });

  it("opens a person directly, with tab and view reason", () => {
    const route = parseRoute(`#/support/user/${ID.toUpperCase()}/tests?reason=${encodeURIComponent("因回報 #12")}`);
    expect(route).toEqual({ view: "user", userId: ID, tab: "tests", reason: "因回報 #12" });
    expect(parseRoute(formatRoute(route))).toEqual(route);
    expect(formatRoute({ view: "user", userId: ID, tab: "overview", reason: "" })).toBe(`#/support/user/${ID}`);
  });

  it("rejects malformed ids and tabs", () => {
    expect(parseRoute("#/support/user/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute(`#/support/user/${ID}/secrets`)).toEqual({ view: "not_found" });
    expect(parseRoute("#/nowhere")).toEqual({ view: "not_found" });
  });

  it("caps the reason at 200 characters", () => {
    const route = parseRoute(`#/support/user/${ID}?reason=${"a".repeat(300)}`);
    expect(route.view === "user" && route.reason.length).toBe(200);
  });

  it("parses the operations area: the copied sections left after #565", () => {
    expect(parseRoute("#/operations")).toEqual({ view: "legacy", area: "operations", section: "teams" });
    for (const section of ["teams", "reading-activity", "registrations"]) {
      const route = parseRoute(`#/operations/${section}`);
      expect(route).toEqual({ view: "legacy", area: "operations", section });
      expect(formatRoute(route)).toBe(`#/operations/${section}`);
      expect(areaOf(route)).toBe("operations");
    }
    expect(parseRoute("#/operations/announcements")).toEqual({ view: "not_found" });
    expect(parseRoute("#/operations/users")).toEqual({ view: "not_found" });
    expect(parseRoute("#/operations/teams/extra")).toEqual({ view: "not_found" });
    // 營運區搬好之後沒有「還在搬」的佔位頁了
    expect(parseRoute("#/nowhere/x")).toEqual({ view: "not_found" });
  });

  it("parses the plan area: four native tabs, an optional plan, and the copied settings tab (#565)", () => {
    const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
    expect(parseRoute("#/plans")).toEqual({ view: "plans", tab: "overview", planId: null });
    for (const tab of ["roster", "teams", "quiz"]) {
      const route = parseRoute(`#/plans/${tab}?plan=${PLAN.toUpperCase()}`);
      expect(route).toEqual({ view: "plans", tab, planId: PLAN });
      expect(formatRoute(route)).toBe(`#/plans/${tab}?plan=${PLAN}`);
      expect(areaOf(route)).toBe("plans");
    }
    expect(formatRoute({ view: "plans", tab: "overview", planId: null })).toBe("#/plans");
    expect(parseRoute("#/plans?plan=nope")).toEqual({ view: "plans", tab: "overview", planId: null });
    const settings = parseRoute("#/plans/settings");
    expect(settings).toEqual({ view: "legacy", area: "plans", section: "plans" });
    expect(formatRoute(settings)).toBe("#/plans/settings");
    expect(areaOf(settings)).toBe("plans");
    for (const bad of ["#/plans/people", "#/plans/roster/extra", "#/plans/plans", "#/plans/settings/x"]) {
      expect(parseRoute(bad), bad).toEqual({ view: "not_found" });
    }
  });

  it("sends old operations bookmarks to their new place in the plan area (#565)", () => {
    expect(parseRoute("#/operations/plans")).toEqual({ view: "legacy", area: "plans", section: "plans" });
    expect(parseRoute("#/operations/join-status")).toEqual({ view: "plans", tab: "roster", planId: null });
    expect(parseRoute("#/operations/members")).toEqual({ view: "plans", tab: "roster", planId: null });
    expect(parseRoute("#/operations/statistics")).toEqual({ view: "plans", tab: "overview", planId: null });
  });

  it("parses the system area: audit log with actor/target filters, and the copied settings page (#550)", () => {
    expect(parseRoute("#/system")).toEqual({ view: "audit", actorId: null, targetId: null });
    expect(parseRoute("#/system/audit")).toEqual({ view: "audit", actorId: null, targetId: null });
    const route = parseRoute(`#/system/audit?target=${ID.toUpperCase()}&actor=${ID}`);
    expect(route).toEqual({ view: "audit", actorId: ID, targetId: ID });
    expect(formatRoute(route)).toBe(`#/system/audit?actor=${ID}&target=${ID}`);
    expect(formatRoute({ view: "audit", actorId: null, targetId: null })).toBe("#/system/audit");
    // 不是 uuid 的條件直接忽略
    expect(parseRoute("#/system/audit?target=x';drop")).toEqual({ view: "audit", actorId: null, targetId: null });
    expect(parseRoute("#/system/settings")).toEqual({ view: "legacy", area: "system", section: "settings" });
    expect(parseRoute("#/system/audit/extra")).toEqual({ view: "not_found" });
    expect(parseRoute("#/system/announcements")).toEqual({ view: "not_found" });
    expect(areaOf(parseRoute("#/system/audit"))).toBe("system");
  });

  it("parses the accounts area (#550)", () => {
    expect(parseRoute("#/accounts")).toEqual({ view: "accounts", tab: "users", profileId: null });
    expect(parseRoute("#/accounts/scopes")).toEqual({ view: "accounts", tab: "scopes", profileId: null });
    const route = parseRoute(`#/accounts/scopes/${ID.toUpperCase()}`);
    expect(route).toEqual({ view: "accounts", tab: "scopes", profileId: ID });
    expect(formatRoute(route)).toBe(`#/accounts/scopes/${ID}`);
    expect(formatRoute({ view: "accounts", tab: "users", profileId: ID })).toBe("#/accounts");
    expect(parseRoute("#/accounts/scopes/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute("#/accounts/users")).toEqual({ view: "not_found" });
  });

  it("parses the content area: the legacy sections moved over as-is (#550)", () => {
    expect(parseRoute("#/content")).toEqual({ view: "legacy", area: "content", section: "announcements" });
    for (const section of ["announcements", "commentary", "quizzes", "exam", "lightning-quiz"]) {
      const route = parseRoute(`#/content/${section}`);
      expect(route).toEqual({ view: "legacy", area: "content", section });
      expect(formatRoute(route)).toBe(`#/content/${section}`);
    }
    // 其他區的舊區塊、App 管理分頁沒有的 id 都不收
    expect(parseRoute("#/content/settings")).toEqual({ view: "not_found" });
    expect(parseRoute("#/content/users")).toEqual({ view: "not_found" });
    expect(parseRoute("#/content/exam/extra")).toEqual({ view: "not_found" });
    expect(parseRoute("#/content/__proto__")).toEqual({ view: "not_found" });
  });
});

describe("navigation by capability", () => {
  it("shows nothing without console access and support only with support.read", () => {
    expect(visibleNavItems([])).toEqual([]);
    expect(visibleNavItems(["console.access"]).map((item) => item.area)).toEqual([]);
    expect(canUse(["console.access"], "support")).toBe(false);
    expect(canUse(["console.access", "support.read"], "support")).toBe(true);
    expect(canUse(["console.access"], "accounts")).toBe(false);
    expect(canUse(["console.access", "accounts.read"], "accounts")).toBe(true);
    expect(canUse(["console.access"], "content")).toBe(false);
    expect(canUse(["console.access", "content.manage"], "content")).toBe(true);
    expect(canUse(["console.access"], "operations")).toBe(false);
    expect(canUse(["console.access", "operations.manage"], "operations")).toBe(true);
    expect(canUse(["console.access", "operations.manage"], "plans")).toBe(false);
    expect(canUse(["console.access", "plans.read"], "plans")).toBe(true);
    // 系統區：稽核紀錄或功能開放設定有一個就看得到
    expect(canUse(["console.access"], "system")).toBe(false);
    expect(canUse(["console.access", "audit.read"], "system")).toBe(true);
    expect(canUse(["console.access", "settings.manage"], "system")).toBe(true);
    expect(canUse(["audit.read"], "system")).toBe(false);
  });
});

describe("describeItem", () => {
  it("renders each section's record as plain text", () => {
    expect(describeItem({ section: "reading_logs", id: "1", at: "2026-10-01T00:00:00Z", book: "創世記", chapter: 3, plan_name: "第四季", round: 1 }))
      .toMatchObject({ title: "創世記 3 章", details: ["第四季", "第 1 遍"] });
    expect(describeItem({ section: "tests", kind: "lightning_quiz", id: "2", at: null, rise_date: "2026-10-02", is_correct: true, elapsed_ms: 4321 }))
      .toEqual({ title: "雲柱測驗：2026/10/02", details: ["答對", "4.3 秒"], when: "—" });
    expect(describeItem({ section: "reports", id: "3", at: null, category: "bug", status: "pending", description: "<img src=x onerror=alert(1)>" }).details)
      .toEqual(["<img src=x onerror=alert(1)>"]);
  });

  it("only builds cursors it can send back", () => {
    expect(cursorAfter([{ section: "tests", id: "a", at: "2026-10-01T00:00:00Z" }])).toEqual({ at: "2026-10-01T00:00:00Z", id: "a" });
    expect(cursorAfter([{ section: "tests", id: "a", at: null }])).toBeNull();
    expect(usableCursor({ at: null, id: "a" })).toBeNull();
    expect(usableCursor(null)).toBeNull();
  });
});
