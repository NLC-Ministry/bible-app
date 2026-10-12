// @vitest-environment jsdom
// 回報收件匣（#550 第一組）：請求預算、篩選、對話、回覆、改狀態、刪除、匯出；會友寫的字一律當文字。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi, type AdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { ReportThreadView, lastAdminMessageSeen } from "../src/views/ReportThread.tsx";
import { filterParams, markOpened } from "../src/views/ReportInbox.tsx";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const R1 = "11111111-2222-4333-8444-555555555555";
const R2 = "21111111-2222-4333-8444-555555555555";
const MEMBER = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

const reporter = { id: MEMBER, name: "王小明", great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組" };
const COUNTS = { all: 9, open: 2, pending: 1, processing: 1, resolved: 5, ignored: 2, unread: 1 };

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, category: "bug", status: "pending", description: "<img src=x onerror=alert(1)>看不到進度",
    created_at: "2026-10-10T02:00:00Z", last_message_at: "2026-10-11T03:00:00Z", sort_at: "2026-10-11T03:00:00Z",
    unread: false, message_count: 2, reporter, ...extra
  };
}

function thread(id: string) {
  return {
    report: {
      id, category: "bug", status: "pending", description: "<b>整段</b>描述", url: "https://app.test/#/plan",
      created_at: "2026-10-10T02:00:00Z", last_message_at: "2026-10-11T03:00:00Z", closed_at: null,
      admin_last_read_at: null, member_last_read_at: "2026-10-11T02:30:00Z", has_diagnostics: true, reporter
    },
    messages: [
      { id: "m1", author_role: "admin", author_name: "王管理", is_internal: false, body: "請問是哪個計畫？", created_at: "2026-10-11T02:00:00Z",
        has_attachment: false, attachment_url: null, attachment_w: null, attachment_h: null },
      { id: "m2", author_role: "admin", author_name: "王管理", is_internal: true, body: "內部：可能是快取", created_at: "2026-10-11T02:10:00Z",
        has_attachment: false, attachment_url: null, attachment_w: null, attachment_h: null },
      { id: "m3", author_role: "member", author_name: null, is_internal: false, body: "<script>x</script>第四季", created_at: "2026-10-11T03:00:00Z",
        has_attachment: true, attachment_url: "https://x.supabase.co/storage/v1/object/sign/issue-report-shots/a.webp?token=t", attachment_w: 800, attachment_h: 600 }
    ]
  };
}

type Call = { action: string; params: any };

function makeRespond(overrides: Partial<Record<string, (params: any) => unknown>> = {}) {
  return (action: string, params: any): { status?: number; data?: unknown; error?: string } => {
    const override = overrides[action];
    if (override) return { data: override(params) };
    switch (action) {
      case "bootstrap":
        return { data: { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [],
          capabilities: ["console.access", "support.read", "support.write", "export"] } };
      case "report_list":
        return { data: { items: params.cursor ? [row(R2)] : [row(R1, { unread: true })], next_cursor: params.cursor ? null : { at: "2026-10-11T03:00:00Z", id: R1 }, counts: params.cursor ? null : COUNTS } };
      case "report_thread":
        return { data: thread(params.report_id) };
      case "report_diagnostics":
        return { data: { diagnostics: { app_version: "abc123", recent_requests: [], recent_errors: [{ at: "2026-10-11T02:00:00Z", kind: "error", message: "<i>boom</i>" }] } } };
      case "report_set_status":
        return { data: { status: params.status, closed_at: params.status === "resolved" ? "2026-10-12T00:00:00Z" : null } };
      case "report_post":
        return { data: { message_id: "m4" } };
      case "report_delete":
        return { data: { id: params.report_id } };
      case "report_export":
        return { data: { filename: "回報匯出_2026-10-12.csv", csv: "ID\r\n1\r\n", rows: 1, total: 1, truncated: false } };
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
    getToken: () => "token-in-memory"
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

async function setValue(input: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement, value: string, event = "input") {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
  await flush();
}

describe("inbox request budget", () => {
  it("opens with one report_list (open reports, first page with counts)", async () => {
    const { requests, el } = await mount("#/support");
    expect(requests).toEqual([
      { action: "bootstrap", params: {} },
      { action: "report_list", params: { status: "open", limit: 30 } }
    ]);
    expect(el.querySelector(".adm-tab--active")?.textContent).toContain("回報收件匣");
    expect(el.querySelector(".adm-chip--active")?.textContent).toBe("未結案2");
    expect(el.querySelectorAll(".adm-report-row")).toHaveLength(1);
    expect(el.querySelector(".adm-report-row .adm-dot")).not.toBeNull();
    expect(el.querySelector(".adm-report-row")?.getAttribute("href")).toBe(`#/support/report/${R1}`);
  });

  it("opening a report costs one report_thread; the list and the user search tab do not refetch", async () => {
    const { requests, el } = await mount("#/support");
    await go(`#/support/report/${R1}`);
    expect(actions(requests)).toEqual(["bootstrap", "report_list", "report_thread"]);
    expect(requests[2].params).toEqual({ report_id: R1 });
    expect(el.querySelector(".adm-report-row .adm-dot")).toBeNull(); // 打開就算管理員已讀

    await go("#/support/users");
    await go("#/support");
    await go(`#/support/report/${R1}`);
    expect(actions(requests)).toEqual(["bootstrap", "report_list", "report_thread", "report_thread"]);
  });

  it("a list that comes back after the thread was opened still shows it as read", async () => {
    let releaseList: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseList = resolve; });
    const respond = makeRespond();
    const requests: Call[] = [];
    window.location.hash = `#/support/report/${R1}`;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { action, params } = JSON.parse(String(init.body));
      requests.push({ action, params });
      if (action === "report_list") await gate;
      return new Response(JSON.stringify({ data: respond(action, params).data, request_id: "srv" }), { status: 200 });
    });
    const api = createAdminApi({ url: "https://api.test/admin-api", getToken: () => "t", fetchImpl });
    const auth: AdminAuth = { init: vi.fn(async () => ({ status: "signed_in" as const })), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), getToken: () => "t" };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AdminApp auth={auth} api={api} environment="staging" win={window} />); });
    await flush(20);
    expect(container.querySelector(".adm-message-item--member")).not.toBeNull();
    await act(async () => { releaseList(); });
    await flush();
    expect(container.querySelector(".adm-report-row")).not.toBeNull();
    expect(container.querySelector(".adm-report-row .adm-dot")).toBeNull();
    expect(container.querySelector(".adm-support-tabs .adm-tab__count")).toBeNull(); // 未讀 1 → 0
  });

  it("loads more with the cursor and switches filters", async () => {
    const { requests, el } = await mount("#/support");
    await click(button(el, "載入更多"));
    expect(requests.at(-1)).toEqual({ action: "report_list", params: { status: "open", limit: 30, cursor: { at: "2026-10-11T03:00:00Z", id: R1 } } });
    expect(el.querySelectorAll(".adm-report-row")).toHaveLength(2);

    await click(button(el, "有新訊息"));
    expect(requests.at(-1)).toEqual({ action: "report_list", params: { unread_only: true, limit: 30 } });
    expect(el.querySelector<HTMLButtonElement>('[aria-label="匯出 CSV"]')!.disabled).toBe(true);
    expect(filterParams("all")).toEqual({});
    expect(filterParams("ignored")).toEqual({ status: "ignored" });
  });

  it("a failed list shows retry and does not retry by itself", async () => {
    const respond = makeRespond();
    const failing = (action: string, params: any) => (action === "report_list" ? { status: 500, error: "admin_api_failed" } : respond(action, params));
    const { requests, el } = await mount("#/support", failing);
    await flush(50);
    expect(actions(requests)).toEqual(["bootstrap", "report_list"]);
    expect(button(el, "重試")).toBeTruthy();
  });
});

describe("report thread", () => {
  it("shows member text as text, groups notes, marks what the member has read", async () => {
    const { el } = await mount(`#/support/report/${R1}`);
    const original = el.querySelector(".adm-report-original")!;
    expect(original.textContent).toContain("<b>整段</b>描述");
    expect(original.querySelector("b")).toBeNull();
    const member = el.querySelector(".adm-message-item--member")!;
    expect(member.textContent).toContain("<script>x</script>第四季");
    expect(member.querySelector("script")).toBeNull();
    expect(member.querySelector("img")?.getAttribute("src")).toContain("token=t");
    expect(el.querySelector(".adm-message-item--note")?.textContent).toContain("內部備註，會友看不到");
    expect(el.querySelector(".adm-message-item--admin")?.textContent).toContain("會友已讀");
    const profile = [...el.querySelectorAll("a")].find((a) => a.textContent?.includes("查看這位會友"))!;
    expect(profile.getAttribute("href")).toBe(`#/support/user/${MEMBER}?${new URLSearchParams({ reason: "因回報 11111111" })}`);
  });

  it("loads diagnostics only when expanded, once", async () => {
    const { requests, el } = await mount(`#/support/report/${R1}`);
    expect(actions(requests)).not.toContain("report_diagnostics");
    const details = el.querySelector<HTMLDetailsElement>(".adm-diagnostics")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    await flush();
    expect(actions(requests).filter((a) => a === "report_diagnostics")).toHaveLength(1);
    expect(details.textContent).toContain("<i>boom</i>");
    expect(details.querySelector("i")).toBeNull();
    await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    await flush();
    expect(actions(requests).filter((a) => a === "report_diagnostics")).toHaveLength(1);
  });

  it("replies, then refreshes the thread (no second audit) and the list", async () => {
    const { requests, el } = await mount(`#/support/report/${R1}`);
    const before = requests.length;
    await setValue(el.querySelector<HTMLTextAreaElement>("#adm-reply")!, "已修正，請重新整理");
    await act(async () => { el.querySelector<HTMLFormElement>(".adm-composer")!.requestSubmit(); });
    await flush();
    expect(requests.slice(before)).toEqual([
      { action: "report_post", params: { report_id: R1, body: "已修正，請重新整理", is_internal: false } },
      { action: "report_thread", params: { report_id: R1, refresh: true } },
      { action: "report_list", params: { status: "open", limit: 30 } }
    ]);
    expect(el.querySelector<HTMLTextAreaElement>("#adm-reply")!.value).toBe("");
  });

  it("changes status and deletes with a confirmation", async () => {
    const { requests, el } = await mount(`#/support/report/${R1}`);
    await setValue(el.querySelector<HTMLSelectElement>("#adm-report-status")!, "resolved", "change");
    expect(requests.find((r) => r.action === "report_set_status")).toEqual({ action: "report_set_status", params: { report_id: R1, status: "resolved" } });

    await click(button(el, "刪除回報"));
    expect(actions(requests)).not.toContain("report_delete");
    await setValue(el.querySelector<HTMLInputElement>("#adm-delete-reason")!, "重複回報");
    await click(button(el, "確定刪除"));
    expect(requests.find((r) => r.action === "report_delete")).toEqual({ action: "report_delete", params: { report_id: R1, reason: "重複回報" } });
    expect(window.location.hash).toBe("#/support");
  });

  it("read-only support staff see no composer, status picker or delete", async () => {
    const respond = makeRespond({
      bootstrap: () => ({ me: { id: "a", name: "客服", email: null, role_code: "admin", role_label: null }, feature_settings: [], org: [],
        capabilities: ["console.access", "support.read"] })
    });
    const { el } = await mount(`#/support/report/${R1}`, respond);
    expect(el.querySelector(".adm-message-item--member")).not.toBeNull();
    expect(el.querySelector(".adm-composer")).toBeNull();
    expect(el.querySelector("#adm-report-status")).toBeNull();
    expect(button(el, "刪除回報")).toBeUndefined();
    expect(el.querySelector('[aria-label="匯出 CSV"]')).toBeNull();
  });

  it("refreshes in the background with refresh: true", async () => {
    const requests: Call[] = [];
    const api = makeApi(makeRespond(), requests);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReportThreadView api={api} reportId={R2} capabilities={["support.read"]} onChanged={() => {}} onOpened={() => {}} refreshMs={40} />);
    });
    await flush(100);
    expect(requests[0]).toEqual({ action: "report_thread", params: { report_id: R2 } });
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.slice(1).every((r) => r.action === "report_thread" && r.params.refresh === true)).toBe(true);
  });
});

describe("export", () => {
  it("downloads the server-made CSV for the current filter", async () => {
    const downloads: string[] = [];
    (URL as any).createObjectURL = vi.fn(() => "blob:test");
    (URL as any).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    const { requests, el } = await mount("#/support");
    await click(el.querySelector<HTMLButtonElement>('[aria-label="匯出 CSV"]')!);
    expect(requests.at(-1)).toEqual({ action: "report_export", params: { status: "open" } });
    expect(downloads).toEqual(["回報匯出_2026-10-12.csv"]);
    expect(el.textContent).toContain("已匯出 1 筆");
  });
});

describe("markOpened", () => {
  it("clears unread only for reports opened after their last message", () => {
    const items = [row(R1, { unread: true }), row(R2, { unread: true, last_message_at: "2026-10-12T00:00:00Z" })] as any;
    const opened = new Map([[R1, Date.parse("2026-10-11T04:00:00Z")], [R2, Date.parse("2026-10-11T04:00:00Z")]]);
    const out = markOpened(items, opened);
    expect(out.cleared).toBe(1);
    expect(out.items.map((item) => item.unread)).toEqual([false, true]);
  });
});

describe("lastAdminMessageSeen", () => {
  const msg = (id: string, author_role: "admin" | "member", created_at: string, is_internal = false) =>
    ({ id, author_role, author_name: null, is_internal, body: "", created_at, has_attachment: false, attachment_url: null, attachment_w: null, attachment_h: null });
  it("is the last public admin message at or before the member's read time", () => {
    const list = [msg("a", "admin", "2026-10-11T01:00:00Z"), msg("n", "admin", "2026-10-11T01:30:00Z", true), msg("b", "admin", "2026-10-11T03:00:00Z")];
    expect(lastAdminMessageSeen(list, "2026-10-11T02:00:00Z")).toBe("a");
    expect(lastAdminMessageSeen(list, "2026-10-11T04:00:00Z")).toBe("b");
    expect(lastAdminMessageSeen(list, null)).toBeNull();
    expect(lastAdminMessageSeen([msg("m", "member", "2026-10-11T01:00:00Z")], "2026-10-11T04:00:00Z")).toBeNull();
  });
});
