// 後台網址格式（#555）：可以直接用網址連到某個人。
import { describe, it, expect } from "vitest";
import { formatRoute, parseRoute } from "../src/route.ts";
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

  it("parses the other areas", () => {
    expect(parseRoute("#/system")).toEqual({ view: "area", area: "system" });
  });
});

describe("navigation by capability", () => {
  it("shows nothing without console access and support only with support.read", () => {
    expect(visibleNavItems([])).toEqual([]);
    expect(visibleNavItems(["console.access"]).map((item) => item.area)).toEqual(["accounts", "operations", "content", "system"]);
    expect(canUse(["console.access"], "support")).toBe(false);
    expect(canUse(["console.access", "support.read"], "support")).toBe(true);
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
