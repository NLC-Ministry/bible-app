// 後台網址格式（#555）：可以直接用網址連到某個人。
import { describe, it, expect } from "vitest";
import { areaOf, formatRoute, parseRoute } from "../src/route.ts";
import { canUse, visibleNavItems } from "../src/nav.ts";
import { describeItem, usableCursor, voucherState } from "../src/items.ts";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

describe("parseRoute / formatRoute", () => {
  it("defaults to the home page; the inbox keeps its address (#569)", () => {
    expect(parseRoute("")).toEqual({ view: "home" });
    expect(parseRoute("#/")).toEqual({ view: "home" });
    expect(parseRoute("#/home")).toEqual({ view: "home" });
    expect(parseRoute("#/home/x")).toEqual({ view: "not_found" });
    expect(formatRoute({ view: "home" })).toBe("#/");
    expect(areaOf({ view: "home" })).toBe("home");
    expect(parseRoute("#/support")).toEqual({ view: "inbox", reportId: null });
  });

  it("opens a report directly", () => {
    const route = parseRoute(`#/support/report/${ID.toUpperCase()}`);
    expect(route).toEqual({ view: "inbox", reportId: ID });
    expect(formatRoute(route)).toBe(`#/support/report/${ID}`);
    expect(parseRoute("#/support/report/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute(`#/support/report/${ID}/extra`)).toEqual({ view: "not_found" });
  });

  it("opens a person directly in the people area, with a view reason (#567)", () => {
    const route = parseRoute(`#/people/user/${ID.toUpperCase()}?reason=${encodeURIComponent("因回報 #12")}`);
    expect(route).toEqual({ view: "user", userId: ID, reason: "因回報 #12" });
    expect(parseRoute(formatRoute(route))).toEqual(route);
    expect(formatRoute({ view: "user", userId: ID, reason: "" })).toBe(`#/people/user/${ID}`);
    expect(areaOf(route)).toBe("people");
  });

  it("keeps old person, search and accounts addresses working (#567)", () => {
    // 會友 App 舊版、稽核紀錄裡貼過的連結
    expect(parseRoute(`#/support/user/${ID}?reason=x`)).toEqual({ view: "user", userId: ID, reason: "x" });
    expect(parseRoute(`#/support/user/${ID}/tests`)).toEqual({ view: "user", userId: ID, reason: "" });
    expect(parseRoute("#/support/users")).toEqual({ view: "people", tab: "directory", profileId: null });
    expect(parseRoute("#/accounts")).toEqual({ view: "people", tab: "directory", profileId: null });
    expect(parseRoute(`#/accounts/scopes/${ID}`)).toEqual({ view: "people", tab: "scopes", profileId: ID });
  });

  it("rejects malformed ids and tabs", () => {
    expect(parseRoute("#/support/user/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute(`#/support/user/${ID}/secrets`)).toEqual({ view: "not_found" });
    expect(parseRoute(`#/people/user/${ID}/tests`)).toEqual({ view: "not_found" });
    expect(parseRoute("#/people/user/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute("#/nowhere")).toEqual({ view: "not_found" });
  });

  it("caps the reason at 200 characters", () => {
    const route = parseRoute(`#/people/user/${ID}?reason=${"a".repeat(300)}`);
    expect(route.view === "user" && route.reason.length).toBe(200);
  });

  it("moves 組隊狀況 to the plan area's last tab; old operations bookmarks still work (#569)", () => {
    const route = parseRoute("#/plans/team-status");
    expect(route).toEqual({ view: "legacy", area: "plans", section: "teams" });
    expect(formatRoute(route)).toBe("#/plans/team-status");
    expect(areaOf(route)).toBe("plans");
    // 「teams」是新寫的團隊分頁，不是照搬的組隊狀況
    expect(parseRoute("#/plans/teams")).toEqual({ view: "plans", tab: "teams", planId: null });
    expect(formatRoute({ view: "legacy", area: "plans", section: "plans" })).toBe("#/plans/settings");
    // 營運區已拿掉：舊書籤導到計畫區的組隊狀況
    expect(parseRoute("#/operations")).toEqual(route);
    expect(parseRoute("#/operations/teams")).toEqual(route);
    // #568：讀經使用率、報名註冊統計的舊書籤到報表區
    expect(parseRoute("#/operations/reading-activity")).toEqual({ view: "stats", tab: "usage", planId: null });
    expect(parseRoute("#/operations/registrations")).toEqual({ view: "stats", tab: "registrations", planId: null });
    expect(parseRoute("#/operations/announcements")).toEqual({ view: "not_found" });
    expect(parseRoute("#/operations/users")).toEqual({ view: "not_found" });
    expect(parseRoute("#/operations/teams/extra")).toEqual({ view: "not_found" });
    // 營運區搬好之後沒有「還在搬」的佔位頁了
    expect(parseRoute("#/nowhere/x")).toEqual({ view: "not_found" });
  });

  it("parses the 報表 area: usage and registrations, the plan only on registrations (#568)", () => {
    const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
    expect(parseRoute("#/stats")).toEqual({ view: "stats", tab: "usage", planId: null });
    expect(parseRoute("#/stats/usage")).toEqual({ view: "stats", tab: "usage", planId: null });
    expect(parseRoute(`#/stats?plan=${PLAN}`)).toEqual({ view: "stats", tab: "usage", planId: null });
    const route = parseRoute(`#/stats/registrations?plan=${PLAN.toUpperCase()}`);
    expect(route).toEqual({ view: "stats", tab: "registrations", planId: PLAN });
    expect(formatRoute(route)).toBe(`#/stats/registrations?plan=${PLAN}`);
    expect(formatRoute({ view: "stats", tab: "registrations", planId: null })).toBe("#/stats/registrations");
    expect(formatRoute({ view: "stats", tab: "usage", planId: null })).toBe("#/stats");
    expect(areaOf(route)).toBe("stats");
    expect(parseRoute("#/stats/registrations?plan=nope")).toEqual({ view: "stats", tab: "registrations", planId: null });
    expect(parseRoute("#/stats/other")).toEqual({ view: "not_found" });
    expect(parseRoute("#/stats/usage/extra")).toEqual({ view: "not_found" });
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

  it("parses the people area: directory and scopes (#567)", () => {
    expect(parseRoute("#/people")).toEqual({ view: "people", tab: "directory", profileId: null });
    expect(parseRoute("#/people/scopes")).toEqual({ view: "people", tab: "scopes", profileId: null });
    const route = parseRoute(`#/people/scopes/${ID.toUpperCase()}`);
    expect(route).toEqual({ view: "people", tab: "scopes", profileId: ID });
    expect(formatRoute(route)).toBe(`#/people/scopes/${ID}`);
    expect(formatRoute({ view: "people", tab: "directory", profileId: ID })).toBe("#/people");
    expect(areaOf(route)).toBe("people");
    expect(parseRoute("#/people/scopes/not-a-uuid")).toEqual({ view: "not_found" });
    expect(parseRoute("#/people/users")).toEqual({ view: "not_found" });
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
    // 首頁進得了後台就有（每一格再看能力）
    expect(visibleNavItems(["console.access"]).map((item) => item.area)).toEqual(["home"]);
    expect(canUse(["console.access"], "support")).toBe(false);
    expect(canUse(["console.access", "support.read"], "support")).toBe(true);
    // 人區：名單（accounts.read）或個人頁（support.read）有一個就看得到
    expect(canUse(["console.access"], "people")).toBe(false);
    expect(canUse(["console.access", "accounts.read"], "people")).toBe(true);
    expect(canUse(["console.access", "support.read"], "people")).toBe(true);
    expect(canUse(["accounts.read"], "people")).toBe(false);
    expect(canUse(["console.access"], "content")).toBe(false);
    expect(canUse(["console.access", "content.manage"], "content")).toBe(true);
    expect(canUse(["console.access", "operations.manage"], "plans")).toBe(false);
    expect(canUse(["console.access", "plans.read"], "plans")).toBe(true);
    // 系統區：稽核紀錄或功能開放設定有一個就看得到
    expect(canUse(["console.access"], "system")).toBe(false);
    expect(canUse(["console.access", "audit.read"], "system")).toBe(true);
    expect(canUse(["console.access", "settings.manage"], "system")).toBe(true);
    expect(canUse(["audit.read"], "system")).toBe(false);
  });

  it("orders the menu by what there is to do (#569)", () => {
    const all = ["console.access", "support.read", "accounts.read", "plans.read", "stats.read", "content.manage", "audit.read", "operations.manage"];
    expect(visibleNavItems(all).map((item) => item.label)).toEqual(["首頁", "計畫", "報表", "人", "回報收件匣", "內容", "系統"]);
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

  it("renders plan enrollments, teams and notifications (#567)", () => {
    const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ac";
    const plan = describeItem({
      section: "plans", id: "p1", at: "2026-10-01T00:00:00Z", global_plan_id: PLAN, name: "第四季", is_personal: false,
      church_start_date: "2026-10-01", church_end_date: "2026-12-31", current_round: 2, logged_chapters: 40, last_read_at: null,
      teams: [{ team_id: ID, name: "晨光隊", is_captain: true }]
    }, { teamLinks: true });
    expect(plan).toMatchObject({
      title: "第四季", details: ["2026/10/01 – 2026/12/31", "目前第 2 遍", "打卡 40 章", "還沒打卡", "團隊：晨光隊（隊長）"],
      href: `#/plans/roster?plan=${PLAN}`
    });
    expect(describeItem({ section: "plans", id: "p2", at: null, global_plan_id: PLAN, name: "我的計畫", is_personal: true }, { teamLinks: true }))
      .not.toHaveProperty("href");
    expect(describeItem({ section: "teams", id: ID, at: null, team_id: ID, team_name: "晨光隊", global_plan_id: PLAN, plan_name: "第四季", division: 3, size: 2, member_role: "captain", status: "forming" }, { teamLinks: true }))
      .toMatchObject({ title: "晨光隊", details: ["第四季", "組別 3 人", "目前 2 人", "隊長", "組隊中（未滿）"], href: `#/plans/teams/${ID}?plan=${PLAN}` });
    expect(describeItem({ section: "teams", id: ID, at: null, team_id: ID, team_name: "晨光隊" })).not.toHaveProperty("href");
    expect(describeItem({ section: "notifications", kind: "care", id: "n1", at: null, sender_name: "王組長", reason: "behind", message: "加油", read_at: null }))
      .toMatchObject({ title: "關心提醒：王組長・進度落後", details: ["加油", "未讀"] });
  });

  it("tells expired vouchers apart only when it knows today's date", () => {
    const voucher = { section: "vouchers" as const, id: "v", at: null, expires_on: "2026-10-10", redeemed_at: null, voided_at: null };
    expect(voucherState(voucher, "2026-10-11")).toBe("已過期");
    expect(voucherState(voucher, "2026-10-10")).toBe("未兌換");
    expect(voucherState(voucher, null)).toBe("未兌換");
    expect(voucherState({ ...voucher, voided_at: "2026-10-01T00:00:00Z" }, "2026-10-11")).toBe("已作廢");
  });

  it("only builds cursors it can send back", () => {
    expect(usableCursor({ at: "2026-10-01T00:00:00Z", id: "a" })).toEqual({ at: "2026-10-01T00:00:00Z", id: "a" });
    expect(usableCursor({ at: null, id: "a" })).toBeNull();
    expect(usableCursor(null)).toBeNull();
  });
});
