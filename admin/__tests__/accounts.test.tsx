// @vitest-environment jsdom
// 「人」區（#550 第二組；#567 從「帳號與權限」改名、名單改游標分頁）：請求預算、名單篩選與匯出、管理範圍總覽與儲存。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi, type AdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { ORG_UNASSIGNED } from "../src/directory.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const A = "11111111-2222-4333-8444-555555555551";
const B = "11111111-2222-4333-8444-555555555552";
const C = "11111111-2222-4333-8444-555555555553";
const D = "11111111-2222-4333-8444-555555555554";
const L2 = "21111111-2222-4333-8444-555555555552";
const L3 = "21111111-2222-4333-8444-555555555553";
const L4 = "21111111-2222-4333-8444-555555555554";
const PLAN1 = "00000000-0000-0000-c026-000000000004";
const PLAN2 = "00000000-0000-0000-c026-000000000005";

const ORG = [
  { id: "r1", name: "北區", zones: [
    { id: "z1", name: "一牧區", groups: [{ id: "g1", name: "喜樂小組" }, { id: "g2", name: "平安小組" }] },
    { id: "z2", name: "二牧區", groups: [{ id: "g3", name: "恩典小組" }] }
  ] },
  { id: "r2", name: "南區", zones: [{ id: "z3", name: "三牧區", groups: [{ id: "g4", name: "信心小組" }] }] }
];

const ALL_CAPS = ["console.access", "support.read", "support.pii", "export", "accounts.read", "accounts.write"];

function dirItem(id: string, extra: Record<string, unknown> = {}) {
  const item = {
    id, name: "王小明", email_masked: "wa***@example.com", great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組",
    is_active: true, sync_status: "success", synced_at: "2026-10-10T02:00:00Z", role_code: "member", role_label: null,
    managed_regions: "", managed_zones: "", managed_groups: "", joined: false, teams: [], ...extra
  } as Record<string, any>;
  return { ...item, sort_key: [1, item.great_region, 1, item.pastoral_zone, item.name, id] };
}

const PAGE1 = [
  dirItem(A, { joined: true, teams: [{ name: "<b>晨光隊</b>", role: "captain" }] }),
  dirItem(B, { name: "李區長", role_code: "zone_leader", role_label: "區長" }),
  dirItem(C, { name: null, pastoral_zone: null, small_group: null, sync_status: null, synced_at: null })
];

const LEADERS = [
  { id: B, name: "李區長", email_masked: "li***@example.com", role_code: "zone_leader", role_label: "區長",
    great_region: "北區", pastoral_zone: "一牧區", small_group: null, managed_regions: [], managed_zones: [], managed_groups: [] },
  { id: L2, name: "陳大區長", email_masked: null, role_code: "great_zone_leader", role_label: "大區長",
    great_region: "北區", pastoral_zone: null, small_group: null, managed_regions: ["北區", "舊大區"], managed_zones: [], managed_groups: [] },
  { id: L3, name: "林牧師", email_masked: null, role_code: "pastor", role_label: "牧者",
    great_region: null, pastoral_zone: null, small_group: null, managed_regions: [], managed_zones: [], managed_groups: [] },
  { id: L4, name: "張小組長", email_masked: null, role_code: "group_leader", role_label: "小組長",
    great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組", managed_regions: [], managed_zones: [], managed_groups: ["喜樂小組", "平安小組"] }
];

type Call = { action: string; params: any };
type Out = { status?: number; data?: unknown; error?: string };

function makeRespond(capabilities = ALL_CAPS, overrides: Partial<Record<string, (params: any) => Out>> = {}) {
  return (action: string, params: any): Out => {
    const override = overrides[action];
    if (override) return override(params);
    switch (action) {
      case "bootstrap":
        return { data: { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: ORG, capabilities } };
      case "directory_list": {
        const first = !params.cursor;
        return { data: {
          items: first ? PAGE1 : [dirItem(D, { name: "趙會友" })],
          total: 4,
          next_cursor: first ? PAGE1[2].sort_key : null,
          plan_id: params.plan_id || PLAN1,
          plans: first ? [{ id: PLAN1, name: "第四季速讀", start_date: "2026-10-01", end_date: "2026-12-31", plan_kind: "standard" },
            { id: PLAN2, name: "第五季速讀", start_date: "2027-01-01", end_date: null, plan_kind: "standard" }] : null,
          all_count: first ? 312 : null
        } };
      }
      case "directory_export":
        return { data: { filename: "使用者名單_2026-10-12.csv", csv: "大區\r\n北區\r\n", rows: 4, total: 4, truncated: false, plan_name: "第四季速讀" } };
      case "scope_overview":
        return { data: { leaders: LEADERS } };
      case "scope_set":
        return { data: { profile_id: params.profile_id, role_code: "zone_leader", managed_regions: [], managed_zones: params.zones, managed_groups: [] } };
      case "org_export":
        return { data: { filename: "組織架構_2026-10-12.csv", csv: "大區\r\n", rows: 4, total: 4, truncated: false } };
      default:
        return { data: null };
    }
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = "";
  vi.restoreAllMocks();
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

function makeApi(respond: ReturnType<typeof makeRespond>, requests: Call[]): AdminApi {
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    const out = respond(action, params);
    if (out.error) return new Response(JSON.stringify({ error: out.error, request_id: "srv" }), { status: out.status || 500 });
    return new Response(JSON.stringify({ data: out.data, request_id: "srv" }), { status: 200 });
  });
  return createAdminApi({ url: "https://api.test/admin-api", getToken: () => "token-in-memory", fetchImpl });
}

async function mount(initialHash: string, respond = makeRespond()) {
  window.location.hash = initialHash;
  const requests: Call[] = [];
  const api = makeApi(respond, requests);
  const auth: AdminAuth = {
    init: vi.fn(async () => ({ status: "signed_in" as const })),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getToken: () => "token-in-memory",
    getIdToken: () => null
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<AdminApp auth={auth} api={api} environment="staging" win={window} />); });
  await flush();
  return { requests, el: container };
}

const actions = (requests: Call[]) => requests.map((r) => r.action);
const button = (el: Element, label: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await flush();
}

function checkbox(root: Element, label: string): HTMLInputElement {
  const found = [...root.querySelectorAll("label")].find((l) => l.textContent?.trim() === label);
  return found?.querySelector("input") as HTMLInputElement;
}

async function setValue(input: HTMLSelectElement | HTMLInputElement, value: string, event = "input") {
  await act(async () => {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

describe("名單與查詢", () => {
  it("opens with one directory_list, keeps the server's default plan, and keeps its state across tabs", async () => {
    const { requests, el } = await mount("#/people");
    expect(actions(requests)).toEqual(["bootstrap", "directory_list"]);
    expect(requests[1].params).toEqual({ regions: [], zones: [], groups: [], participation: "all", team: "all", incomplete: false, limit: 50 });

    expect(el.querySelector(".adm-directory__count")?.textContent).toBe("4 人");
    expect(el.querySelector<HTMLSelectElement>(".adm-filters select")!.value).toBe(PLAN1);
    const rows = el.querySelectorAll(".adm-dir__row");
    expect(rows).toHaveLength(3);
    // 名字連到個人頁；會友寫的隊名當文字
    expect(rows[0].querySelector("a")!.getAttribute("href")).toBe(`#/people/user/${A}?${new URLSearchParams({ reason: "從名單查看" })}`);
    expect(rows[0].textContent).toContain("[隊長] <b>晨光隊</b>");
    expect(rows[0].querySelector("b")).toBeNull();
    // 區長沒另外設定 → 沿用本人牧區，連到管理範圍
    const scopeLink = [...rows[1].querySelectorAll("a")].find((a) => a.textContent === "一牧區")!;
    expect(scopeLink.getAttribute("href")).toBe(`#/people/scopes/${B}`);
    expect(rows[2].textContent).toContain("未填會員資料");

    await click(button(el, "已加入此計畫"));
    expect(actions(requests)).toEqual(["bootstrap", "directory_list", "directory_list"]);
    expect(requests[2].params).toMatchObject({ plan_id: PLAN1, participation: "joined" });
    expect(requests[2].params).not.toHaveProperty("cursor");
    expect(el.querySelector(".adm-directory__count")?.textContent).toBe("4 / 312 人");

    await go("#/people/scopes");
    expect(actions(requests).slice(3)).toEqual(["scope_overview"]);
    await go("#/people");
    expect(requests).toHaveLength(4);
    expect(button(el, "已加入此計畫").getAttribute("aria-pressed")).toBe("true");
  });

  it("waits until typing stops and sends only the last text", async () => {
    const { requests, el } = await mount("#/people");
    const input = el.querySelector<HTMLInputElement>("#adm-directory-q")!;
    await setValue(input, "王");
    await flush(100);
    await setValue(input, "王小");
    await flush(100);
    expect(requests).toHaveLength(2);
    await flush(350);
    expect(requests).toHaveLength(3);
    expect(requests[2].params).toMatchObject({ q: "王小", plan_id: PLAN1 });
  });

  it("cascades org filters and drops choices the new parents no longer offer", async () => {
    const { requests, el } = await mount("#/people");
    const regions = el.querySelector("#adm-picker-regions")!;
    await click(checkbox(regions, "北區"));
    expect(requests.at(-1)!.params).toMatchObject({ regions: ["北區"], zones: [], groups: [] });

    const zones = el.querySelector("#adm-picker-zones")!;
    expect([...zones.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["一牧區", "二牧區", "未設定"]);
    await click(checkbox(zones, "一牧區"));
    const groups = el.querySelector("#adm-picker-groups")!;
    expect([...groups.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["喜樂小組", "平安小組", "未設定"]);
    await click(checkbox(groups, "喜樂小組"));
    expect(requests.at(-1)!.params).toMatchObject({ regions: ["北區"], zones: ["一牧區"], groups: ["喜樂小組"] });

    // 換成南區：一牧區、喜樂小組不在南區底下，自動拿掉
    await click(checkbox(regions, "南區"));
    await click(checkbox(regions, "北區"));
    expect(requests.at(-1)!.params).toMatchObject({ regions: ["南區"], zones: [], groups: [] });
    await click(checkbox(el.querySelector("#adm-picker-zones")!, "未設定"));
    expect(requests.at(-1)!.params).toMatchObject({ zones: [ORG_UNASSIGNED] });

    const before = requests.length;
    await click(button(el, "清除全部條件"));
    expect(requests).toHaveLength(before + 1);
    expect(requests.at(-1)!.params).toEqual({ regions: [], zones: [], groups: [], participation: "all", team: "all", incomplete: false, plan_id: PLAN1, limit: 50 });
  });

  it("loads the next page after the last person's sort key (#567: no OFFSET, nobody skipped or repeated)", async () => {
    const { requests, el } = await mount("#/people");
    await click(button(el, "載入更多（還有 1 人）"));
    expect(requests.at(-1)!.params).toMatchObject({ cursor: [1, "北區", 1, null, null, C], plan_id: PLAN1, limit: 50 });
    expect(el.querySelectorAll(".adm-dir__row")).toHaveLength(4);
    expect(button(el, "載入更多")).toBeUndefined();
  });

  it("exports with the same filters (server-generated, needs support.pii)", async () => {
    const { requests, el } = await mount("#/people");
    (URL as any).createObjectURL = vi.fn(() => "blob:test");
    (URL as any).revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    await click(checkbox(el, "未填會員資料（沒有牧區或沒有名稱）"));
    await click(button(el, "匯出 CSV"));
    const call = requests.at(-1)!;
    expect(call.action).toBe("directory_export");
    expect(call.params).toEqual({ regions: [], zones: [], groups: [], participation: "all", team: "all", incomplete: true, plan_id: PLAN1 });
    expect(downloads).toEqual(["使用者名單_2026-10-12.csv"]);
    expect(el.textContent).toContain("已匯出 4 人。");

    await act(async () => { root?.unmount(); });
    container?.remove();
    const noPii = await mount("#/people", makeRespond(ALL_CAPS.filter((cap) => cap !== "support.pii")));
    expect(button(noPii.el, "匯出 CSV")).toBeUndefined();
  });

  it("without accounts.read the list and scopes stay closed (the person page needs only support.read)", async () => {
    const { requests, el } = await mount("#/people", makeRespond(["console.access", "support.read"]));
    expect(el.textContent).toContain("你的帳號沒有名單與管理範圍的後台權限。");
    expect(el.querySelector(".adm-support-tabs")).toBeNull();
    expect(actions(requests)).toEqual(["bootstrap"]);
    expect([...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent)).toContain("人");

    await act(async () => { root?.unmount(); });
    container?.remove();
    const none = await mount("#/people", makeRespond(["console.access"]));
    expect(none.el.textContent).toContain("沒有權限");
    expect([...none.el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent)).not.toContain("人");
  });
});

describe("管理範圍", () => {
  it("shows who covers each unit from one scope_overview, and opens a person without another request", async () => {
    const { requests, el } = await mount("#/people/scopes");
    expect(actions(requests)).toEqual(["bootstrap", "scope_overview"]);
    // 大區：南區；牧區：二、三；小組：恩典、信心
    expect(el.textContent).toContain("5 個單位尚未指派");
    const chip = [...el.querySelectorAll<HTMLAnchorElement>(".adm-person-chip")].find((a) => a.textContent === "李區長")!;
    expect(chip.closest(".adm-org-tree__zone")?.querySelector("summary")?.textContent).toContain("一牧區");
    expect([...el.querySelectorAll(".adm-person-chip")].map((a) => a.textContent)).toContain("林牧師");

    await go(chip.getAttribute("href")!);
    expect(requests).toHaveLength(2);
    expect(el.textContent).toContain("沒有另外設定，沿用本人歸屬");
    expect(checkbox(el.querySelector(".adm-scope-options")!, "一牧區").checked).toBe(true);
    expect(button(el, "儲存管理範圍").disabled).toBe(true);
  });

  it("saves only the role's field with the reason, then updates in place", async () => {
    const { requests, el } = await mount(`#/people/scopes/${B}`);
    await click(checkbox(el.querySelector(".adm-scope-options")!, "二牧區"));
    await setValue(el.querySelector<HTMLInputElement>("#adm-scope-reason")!, "接手二牧區");
    await click(button(el, "儲存管理範圍"));
    const call = requests.at(-1)!;
    expect(call.action).toBe("scope_set");
    expect(call.params).toEqual({ profile_id: B, regions: [], zones: ["一牧區", "二牧區"], groups: [], reason: "接手二牧區" });
    expect(el.textContent).toContain("管理範圍已儲存。");
    expect(el.textContent).toContain("一牧區、二牧區");
    expect(el.textContent).toContain("4 個單位尚未指派");
    expect(el.textContent).not.toContain("沿用本人歸屬");
    expect(actions(requests).filter((a) => a === "scope_overview")).toHaveLength(1);
  });

  it("lists names missing from the org list and lets the admin remove them", async () => {
    const { el } = await mount(`#/people/scopes/${L2}`);
    expect(el.textContent).toContain("「舊大區」不在大區名單中");
    expect(checkbox(el.querySelector(".adm-scope-options")!, "北區").checked).toBe(true);
    expect(button(el, "儲存管理範圍").disabled).toBe(false);
  });

  it("shows server errors in Chinese", async () => {
    const respond = makeRespond(ALL_CAPS, { scope_set: () => ({ status: 400, error: "managed_scope_unknown_zone" }) });
    const { el } = await mount(`#/people/scopes/${B}`, respond);
    await click(checkbox(el.querySelector(".adm-scope-options")!, "三牧區"));
    await click(button(el, "儲存管理範圍"));
    expect(el.textContent).toContain("有牧區名稱不在組織名單中，請重新整理後再選一次。");
    expect(el.textContent).toContain("請求編號");
  });

  it("is read-only without accounts.write; whole-church roles and non-leaders have nothing to set", async () => {
    const { el } = await mount(`#/people/scopes/${L4}`, makeRespond(ALL_CAPS.filter((cap) => cap !== "accounts.write")));
    expect(el.textContent).toContain("你只能查看，不能修改管理範圍。");
    expect(checkbox(el.querySelector(".adm-scope-options")!, "平安小組").disabled).toBe(true);
    expect(button(el, "儲存管理範圍")).toBeUndefined();

    await go(`#/people/scopes/${L3}`);
    expect(el.textContent).toContain("這個角色固定擁有全教會範圍");
    await go(`#/people/scopes/${A}`);
    expect(el.textContent).toContain("這位不在負責人名單裡");
  });

  it("exports the org structure from the server", async () => {
    const { requests, el } = await mount("#/people/scopes");
    (URL as any).createObjectURL = vi.fn(() => "blob:test");
    (URL as any).revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    await click(el.querySelector<HTMLButtonElement>('[aria-label="匯出組織架構 CSV"]')!);
    expect(requests.at(-1)).toEqual({ action: "org_export", params: {} });
    expect(downloads).toEqual(["組織架構_2026-10-12.csv"]);
  });
});
