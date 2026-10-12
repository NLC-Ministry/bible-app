// @vitest-environment jsdom
// 請求預算（#555）：用假的 admin-api 數請求。開後台 ≤ 1 個、打開某人 ≤ 1 個；
// 同一個人 60 秒內切換區塊不重抓；搜尋停止輸入 250ms 才送、只送最後一次。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const USER = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const OTHER = "7a1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

const log = (id: string, at: string, chapter: number) => ({
  section: "reading_logs", id, at, plan_id: "p1", plan_name: "第四季速讀", book: "創世記", chapter, round: 1
});

function summaryFor(userId: string, name: string) {
  return {
    account: {
      id: userId, name, email_masked: "wa***@example.com", phone_masked: "0912***678", has_email: true, has_phone: true,
      is_active: true, role_code: "member", role_label: "會友", created_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-10-10T00:00:00Z",
      has_member_hub_id: true
    },
    identities: [{ provider: "logto", email_masked: "wa***@example.com", is_primary: true, created_at: null, last_seen_at: null }],
    org: { great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組" },
    member_hub: { synced_at: null, sync_status: "ok", sync_error: null, membership_lifecycle_state: null, placement_state: null, required_action: null, leadership_display_label: null },
    plans: [{
      plan_id: "p1", global_plan_id: "g1", name: "第四季速讀", plan_kind: "speed_reading", is_personal: false,
      start_date: "2026-10-01", end_date: "2026-12-31", church_start_date: "2026-10-01", church_end_date: "2026-12-31",
      current_round: 1, grace_days: 0, joined_at: null, round1_chapters: 42, current_round_chapters: 42, logged_chapters: 42,
      last_read_at: "2026-10-10T00:00:00Z", teams: []
    }],
    counts: { reading_logs: 42, team_events: 0, tests: 0, vouchers: 0, reports: 1 },
    latest: {
      reading_logs: [5, 4, 3, 2, 1].map((n) => log(`l${n}`, `2026-10-0${n}T00:00:00Z`, n)),
      team_events: [], tests: [], vouchers: [],
      reports: [{ section: "reports", id: "r1", at: "2026-10-05T00:00:00Z", category: "bug", status: "pending", description: "<b>看不到進度</b>" }]
    }
  };
}

function respond(action: string, params: any) {
  switch (action) {
    case "bootstrap":
      return { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [],
        capabilities: ["console.access", "support.read", "support.pii", "audit.read", "export"] };
    case "user_search":
      return [{ id: USER, name: `王小明（${params.q}）`, email_masked: "wa***@example.com", great_region: "北區", pastoral_zone: "一牧區", small_group: null, role_code: "member", role_label: null, is_active: true, last_seen_at: null }];
    case "user_summary":
      return summaryFor(params.user_id, params.user_id === USER ? "王小明" : "李大華");
    case "user_section":
      return { items: [log("l0", "2026-09-30T00:00:00Z", 99)], next_cursor: null };
    case "user_timeline":
      return { items: [log("t1", "2026-10-09T00:00:00Z", 7)], next_cursor: null };
    case "reveal_pii":
      return { email: "wang@example.com", phone: "0912345678", identities: [{ provider: "logto", email: "wang@example.com", is_primary: true }] };
    default:
      return null;
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = "";
});

async function flush(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await flush();
}

async function mount(initialHash: string) {
  window.location.hash = initialHash;
  const requests: { action: string; params: any }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    return new Response(JSON.stringify({ data: respond(action, params), request_id: "srv" }), { status: 200 });
  });
  const auth: AdminAuth = {
    init: vi.fn(async () => ({ status: "signed_in" as const })),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getToken: () => "token-in-memory"
  };
  const api = createAdminApi({ url: "https://api.test/admin-api", getToken: auth.getToken, fetchImpl });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<AdminApp auth={auth} api={api} environment="staging" win={window} />); });
  await flush();
  return { requests, auth, el: container };
}

const actions = (requests: { action: string }[]) => requests.map((r) => r.action);

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("admin console request budget", () => {
  it("opening the console makes exactly one admin-api request (bootstrap)", async () => {
    const { requests, el } = await mount("#/support");
    expect(actions(requests)).toEqual(["bootstrap"]);
    expect(el.textContent).toContain("王管理");
    expect(el.textContent).toContain("測試站");
    const nav = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    expect(nav[0]).toContain("客服");
  });

  it("opening a person makes exactly one request; switching sections within 60 s makes none", async () => {
    const { requests, el } = await mount("#/support");
    await go(`#/support/user/${USER}?reason=${encodeURIComponent("因回報 #1")}`);
    expect(actions(requests)).toEqual(["bootstrap", "user_summary"]);
    expect(requests[1].params).toEqual({ user_id: USER, reason: "因回報 #1" });
    expect(el.textContent).toContain("王小明");
    expect(el.textContent).toContain("查看理由：因回報 #1");

    for (const tab of ["reading_logs", "reports", "tests", "vouchers", "team_events", ""]) {
      await go(`#/support/user/${USER}${tab ? `/${tab}` : ""}`);
    }
    expect(actions(requests)).toEqual(["bootstrap", "user_summary"]);

    // 換人再回來：新的人 1 個請求，回來的人 0 個
    await go(`#/support/user/${OTHER}`);
    await go(`#/support/user/${USER}/reading_logs`);
    expect(actions(requests)).toEqual(["bootstrap", "user_summary", "user_summary"]);
    expect(el.textContent).toContain("創世記 5 章");
  });

  it("a direct link to a person costs bootstrap + one summary", async () => {
    const { requests } = await mount(`#/support/user/${USER}`);
    expect(actions(requests)).toEqual(["bootstrap", "user_summary"]);
  });

  it("loads more of a section with a cursor, and the timeline only when opened", async () => {
    const { requests, el } = await mount(`#/support/user/${USER}/reading_logs`);
    expect(el.textContent).toContain("共 42 筆，已顯示 5 筆");
    const more = [...el.querySelectorAll("button")].find((b) => b.textContent === "載入更多")!;
    await act(async () => { more.click(); });
    await flush();
    expect(requests[2]).toEqual({
      action: "user_section",
      params: { user_id: USER, section: "reading_logs", cursor: { at: "2026-10-01T00:00:00Z", id: "l1" }, limit: 20 }
    });
    expect(el.textContent).toContain("創世記 99 章");

    await go(`#/support/user/${USER}/timeline`);
    expect(actions(requests)).toEqual(["bootstrap", "user_summary", "user_section", "user_timeline"]);
    await go(`#/support/user/${USER}/reading_logs`);
    expect(el.textContent).toContain("創世記 99 章");
    expect(requests).toHaveLength(4);
  });

  it("member-entered text renders as text, never as HTML", async () => {
    const { el } = await mount(`#/support/user/${USER}/reports`);
    expect(el.textContent).toContain("<b>看不到進度</b>");
    expect(el.querySelector(".adm-items b")).toBeNull();
  });
});

describe("personal data is masked until revealed", () => {
  it("shows masked email/phone and calls reveal_pii (audited) only on demand", async () => {
    const { requests, el } = await mount(`#/support/user/${USER}?reason=${encodeURIComponent("因回報 #1")}`);
    expect(el.textContent).toContain("wa***@example.com");
    expect(el.textContent).not.toContain("wang@example.com");
    const show = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("顯示"))!;
    await act(async () => { show.click(); });
    await flush();
    expect(requests.at(-1)).toEqual({ action: "reveal_pii", params: { user_id: USER, reason: "因回報 #1" } });
    expect(el.textContent).toContain("wang@example.com");
    expect(el.textContent).toContain("0912345678");
    const hide = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("隱藏"))!;
    await act(async () => { hide.click(); });
    expect(el.textContent).not.toContain("wang@example.com");
  });
});

describe("search", () => {
  it("waits 250 ms after typing stops and sends only the latest query", async () => {
    const { requests, el } = await mount("#/support");
    const input = el.querySelector<HTMLInputElement>("#adm-search-input")!;
    await typeInto(input, "王");
    await flush(100);
    await typeInto(input, "王小");
    await flush(100);
    expect(actions(requests)).toEqual(["bootstrap"]);
    await flush(300);
    expect(requests.slice(1)).toEqual([{ action: "user_search", params: { q: "王小" } }]);
    expect(el.textContent).toContain("王小明（王小）");
    const link = el.querySelector<HTMLAnchorElement>(".adm-result")!;
    expect(link.getAttribute("href")).toBe(`#/support/user/${USER}`);
  });

  it("does not send queries the API would reject", async () => {
    const { requests, el } = await mount("#/support");
    await typeInto(el.querySelector<HTMLInputElement>("#adm-search-input")!, "a");
    await flush(300);
    expect(actions(requests)).toEqual(["bootstrap"]);
    expect(el.textContent).toContain("請輸入至少 1 個中文字或 2 個英文字母");
  });

  it("carries the view reason into the person link", async () => {
    const { el } = await mount("#/support");
    await typeInto(el.querySelector<HTMLInputElement>("#adm-reason-input")!, "因回報 #7");
    await typeInto(el.querySelector<HTMLInputElement>("#adm-search-input")!, "王小");
    await flush(300);
    expect(el.querySelector<HTMLAnchorElement>(".adm-result")!.getAttribute("href"))
      .toBe(`#/support/user/${USER}?${new URLSearchParams({ reason: "因回報 #7" })}`);
  });
});

describe("access", () => {
  it("an account without console access sees the no-permission screen and no further requests", async () => {
    window.location.hash = "#/support";
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)).action);
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    });
    const auth: AdminAuth = { init: async () => ({ status: "signed_in" }), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), getToken: () => "t" };
    const api = createAdminApi({ url: "https://api.test/admin-api", getToken: auth.getToken, fetchImpl });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AdminApp auth={auth} api={api} environment="production" win={window} />); });
    await flush();
    expect(requests).toEqual(["bootstrap"]);
    expect(container.textContent).toContain("沒有後台權限");
  });
});
