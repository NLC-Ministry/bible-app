// @vitest-environment jsdom
// 系統區（#550 第四組）：稽核紀錄的請求預算、篩選、展開明細、網址條件、匯出與權限；功能開放設定（照搬）的分頁。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi, type AdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { diffRows, formatAuditValue, personName } from "../src/audit.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN = "11111111-2222-4333-8444-555555555551";
const MEMBER = "11111111-2222-4333-8444-555555555552";
const OTHER = "11111111-2222-4333-8444-555555555553";
const ALL_CAPS = ["console.access", "support.read", "audit.read", "settings.manage", "content.manage", "export"];

function event(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, occurred_at: "2026-10-12T02:05:00Z", source: "admin-api", source_label: "後台", action: "set_profile_managed_scopes",
    label: "設定管理範圍", resource: "profiles", result: "ok", reason: null, request_id: `adm-req-${id}`,
    actor: { id: ADMIN, name: "王管理" }, actor_role: "admin", actor_role_label: "系統管理員",
    target_user: { id: MEMBER, name: "李區長" }, target_id: MEMBER,
    changes: { managed_zones: { before: [], after: ["一牧區"] } }, detail: null,
    changes_omitted: false, detail_omitted: false,
    ...extra
  };
}

const PAGE = [
  event(103, { reason: "<img src=x onerror=alert(1)>因回報調整" }),
  event(102, {
    source: "nlc-data", source_label: "舊管理畫面", action: "exam_publish", label: "發布大測驗", resource: "rpc", result: "denied",
    target_user: null, target_id: "paper-1", changes: null, detail: { error: { code: "42501" } }
  }),
  event(101, { action: "profiles.update", label: "修改會友資料", changes: null, changes_omitted: true, detail: null })
];

type Call = { action: string; params: any };
type Out = { status?: number; data?: unknown; error?: string };

function makeRespond(capabilities = ALL_CAPS, overrides: Partial<Record<string, (params: any) => Out>> = {}) {
  return (action: string, params: any): Out => {
    const override = overrides[action];
    if (override) return override(params);
    switch (action) {
      case "bootstrap":
        return { data: { me: { id: ADMIN, name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [], capabilities } };
      case "audit_list":
        if (params.cursor) return { data: { items: [event(50, { label: "查看使用者", action: "view_user", changes: null })], next_cursor: null, total: null, facets: null, since: "x", actor: null, target: null } };
        return { data: {
          items: PAGE,
          next_cursor: 101,
          total: 4,
          since: "2026-10-05T00:00:00Z",
          facets: {
            actions: [{ action: "set_profile_managed_scopes", label: "設定管理範圍", count: 2 }, { action: "exam_publish", label: "發布大測驗", count: 1 }],
            actors: [{ id: ADMIN, name: "王管理", count: 3 }]
          },
          actor: params.actor_id ? { id: params.actor_id, name: params.actor_id === OTHER ? "趙同工" : "王管理" } : null,
          target: params.target_user_id ? { id: params.target_user_id, name: "李區長" } : null
        } };
      case "audit_event":
        return { data: event(params.id, { action: "profiles.update", label: "修改會友資料", changes: { name: { before: "李小明", after: "李區長" }, email: { after: null } } }) };
      case "audit_export":
        return { data: { filename: "稽核紀錄_2026-10-12.csv", csv: "\"時間\"\r\n", rows: 4, total: 4, truncated: false } };
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
const rows = (el: Element) => [...el.querySelectorAll<HTMLElement>(".adm-audit__row")];
const selectNamed = (el: Element, name: string) =>
  [...el.querySelectorAll("label")].find((l) => l.textContent?.startsWith(name))?.querySelector("select") as HTMLSelectElement;

async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await flush();
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

describe("稽核紀錄", () => {
  it("opens #/system with one audit_list and shows who did what to whom, as plain text", async () => {
    const { requests, el } = await mount("#/system");
    expect(actions(requests)).toEqual(["bootstrap", "audit_list"]);
    expect(requests[1].params).toEqual({ days: 7, limit: 50 });

    // 上方分頁：稽核紀錄（目前）＋功能開放設定（照搬）
    const tabs = [...el.querySelectorAll<HTMLAnchorElement>(".adm-tabs a")];
    expect(tabs.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["稽核紀錄", "#/system/audit", "page"],
      ["功能開放設定", "#/system/settings", null]
    ]);
    expect(el.querySelector(".adm-audit__count")?.textContent).toBe("4 筆");
    const list = rows(el);
    expect(list).toHaveLength(3);
    expect(list[0].textContent).toContain("設定管理範圍");
    expect(list[0].textContent).toContain("王管理・系統管理員");
    expect(list[0].textContent).toContain("對象 李區長");
    expect(list[1].textContent).toContain("被拒絕");
    expect(list[1].textContent).toContain("舊管理畫面");
    expect(list[1].textContent).toContain("對象 paper-1");
    expect(list[1].classList.contains("adm-audit__row--flagged")).toBe(true);
    // 「載入更多」顯示剩下幾筆
    expect(button(el, "載入更多").textContent).toContain("還有 1 筆");

    // 點開：變更內容是表格、理由是文字（不會變成 HTML）、連結到操作者／對象的紀錄與使用者頁
    await click(list[0].querySelector<HTMLButtonElement>(".adm-audit__summary")!);
    expect(actions(requests)).toEqual(["bootstrap", "audit_list"]);
    const detail = list[0].querySelector(".adm-audit__detail")!;
    expect([...detail.querySelectorAll(".adm-diff tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual([
      ["managed_zones", "[]", "[\"一牧區\"]"]
    ]);
    expect(detail.textContent).toContain("<img src=x onerror=alert(1)>因回報調整");
    expect(detail.querySelector("img")).toBeNull();
    expect(detail.textContent).toContain("adm-req-103");
    const links = [...detail.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([`#/system/audit?actor=${ADMIN}`, `#/system/audit?target=${MEMBER}`, `#/support/user/${MEMBER}`]);

    // 補充資訊是 JSON 文字
    await click(list[1].querySelector<HTMLButtonElement>(".adm-audit__summary")!);
    expect(list[1].querySelector("pre")?.textContent).toContain("\"42501\"");
  });

  it("fetches one audit_event only for a row whose changes were too big for the list, and caches it", async () => {
    const { requests, el } = await mount("#/system");
    const row = rows(el)[2];
    await click(row.querySelector<HTMLButtonElement>(".adm-audit__summary")!);
    expect(actions(requests).slice(2)).toEqual(["audit_event"]);
    expect(requests[2].params).toEqual({ id: 101 });
    expect([...row.querySelectorAll(".adm-diff tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual([
      ["name", "李小明", "李區長"],
      ["email", "—", "（空）"]
    ]);
    // 收起再打開不再抓
    await click(row.querySelector<HTMLButtonElement>(".adm-audit__summary")!);
    await click(row.querySelector<HTMLButtonElement>(".adm-audit__summary")!);
    expect(actions(requests).slice(2)).toEqual(["audit_event"]);
  });

  it("sends one audit_list per filter change and maps the source filter to the server's value", async () => {
    const { requests, el } = await mount("#/system");
    await choose(selectNamed(el, "動作"), "exam_publish");
    expect(requests.at(-1)).toEqual({ action: "audit_list", params: { days: 7, action: "exam_publish", limit: 50 } });
    expect(selectNamed(el, "動作").options[1].textContent).toBe("設定管理範圍（2）");

    await click(button(el, "被拒絕"));
    expect(requests.at(-1)!.params).toEqual({ days: 7, action: "exam_publish", result: "denied", limit: 50 });

    await click(button(el, "舊管理畫面"));
    expect(requests.at(-1)!.params).toMatchObject({ source: "legacy" });

    await choose(el.querySelector<HTMLSelectElement>("#adm-audit-days")!, "30");
    expect(requests.at(-1)!.params).toMatchObject({ days: 30, action: "exam_publish", result: "denied", source: "legacy" });

    await click(button(el, "清除全部條件"));
    expect(requests.at(-1)!.params).toEqual({ days: 30, limit: 50 });
    expect(actions(requests).filter((a) => a === "audit_list")).toHaveLength(6);

    // 載入更多：帶游標、接在後面
    await click(button(el, "載入更多"));
    expect(requests.at(-1)!.params).toMatchObject({ days: 30, cursor: 101 });
    expect(rows(el)).toHaveLength(4);
    expect(button(el, "載入更多")).toBeUndefined();
  });

  it("keeps the actor and target filters in the URL so other pages can link here", async () => {
    const { requests, el } = await mount(`#/system/audit?target=${MEMBER}`);
    expect(requests[1].params).toEqual({ days: 7, target_user_id: MEMBER, limit: 50 });
    const chip = el.querySelector(".adm-audit__active .adm-chip")!;
    expect(chip.textContent).toContain("對象：李區長");

    // 選操作者 → 網址變了 → 重抓（對象條件保留）
    await choose(selectNamed(el, "操作者"), ADMIN);
    expect(window.location.hash).toBe(`#/system/audit?actor=${ADMIN}&target=${MEMBER}`);
    expect(requests.at(-1)!.params).toEqual({ days: 7, actor_id: ADMIN, target_user_id: MEMBER, limit: 50 });

    // 拿掉對象
    await click(chip.querySelector("button")!);
    expect(window.location.hash).toBe(`#/system/audit?actor=${ADMIN}`);
    expect(requests.at(-1)!.params).toEqual({ days: 7, actor_id: ADMIN, limit: 50 });

    // 網址帶了不在選項裡的操作者：仍列出名字
    await go(`#/system/audit?actor=${OTHER}`);
    expect(selectNamed(el, "操作者").value).toBe(OTHER);
    expect(selectNamed(el, "操作者").selectedOptions[0].textContent).toBe("趙同工");
  });

  it("exports the current filters through admin-api and downloads the CSV", async () => {
    const createObjectURL = vi.fn(() => "blob:audit");
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = vi.fn();
    const { requests, el } = await mount("#/system");
    await click(button(el, "被拒絕"));
    await click(button(el, "匯出 CSV"));
    expect(requests.at(-1)).toEqual({ action: "audit_export", params: { days: 7, result: "denied" } });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(el.querySelector("[role=status]")?.textContent).toBe("已匯出 4 筆。");
  });

  it("does not refetch when coming back from the settings tab", async () => {
    const { requests } = await mount("#/system");
    await go("#/system/settings");
    expect(document.querySelector("iframe.adm-legacy__frame")).not.toBeNull();
    await go("#/system");
    expect(actions(requests)).toEqual(["bootstrap", "audit_list"]);
  });
});

describe("系統區的權限", () => {
  it("shows only the tabs the account may use", async () => {
    // 只能看稽核：沒有功能開放設定分頁（只剩一個就不顯示分頁列）、沒有匯出鈕
    const { el } = await mount("#/system", makeRespond(["console.access", "audit.read"]));
    expect(el.querySelector(".adm-tabs")).toBeNull();
    expect(button(el, "匯出 CSV")).toBeUndefined();
    expect(rows(el)).toHaveLength(3);
  });

  it("lets a settings-only account into the system area but not the audit log", async () => {
    const { requests, el } = await mount("#/system", makeRespond(["console.access", "settings.manage"]));
    const nav = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    expect(nav).toContain("系統");
    expect(nav).not.toContain("內容");
    expect(actions(requests)).toEqual(["bootstrap"]);
    // 分頁列只剩功能開放設定，點得過去
    expect([...el.querySelectorAll<HTMLAnchorElement>(".adm-tabs a")].map((a) => [a.textContent, a.getAttribute("href")]))
      .toEqual([["功能開放設定", "#/system/settings"]]);
    expect(el.textContent).toContain("你的帳號不能看稽核紀錄");
  });

  it("blocks the copied settings page without settings.manage", async () => {
    const { el } = await mount("#/system/settings", makeRespond(["console.access", "audit.read"]));
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("你的帳號沒有這個區塊的後台權限");
  });

  it("hides the whole area without audit.read or settings.manage", async () => {
    const { el } = await mount("#/system", makeRespond(["console.access", "support.read"]));
    expect([...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent)).not.toContain("系統");
    expect(el.textContent).toContain("你的帳號沒有這一區的後台權限");
  });
});

describe("audit helpers", () => {
  it("turns #549 field diffs into table rows and leaves other shapes to the JSON view", () => {
    expect(diffRows({ is_hidden: { before: false, after: true }, title: { after: "新標題" } })).toEqual([
      { field: "is_hidden", before: "false", after: "true" },
      { field: "title", before: "—", after: "新標題" }
    ]);
    expect(diffRows({ deleted: { id: 1, title: "x" } })).toBeNull();
    expect(diffRows({ truncated: true, bytes: 40000 })).toBeNull();
    expect(diffRows({})).toBeNull();
    expect(diffRows(null)).toBeNull();
    expect(diffRows(["a"])).toBeNull();
    expect(formatAuditValue("")).toBe("（空字串）");
    expect(formatAuditValue({ a: 1 })).toBe("{\"a\":1}");
    expect(personName({ id: MEMBER, name: null })).toBe("（已刪除的帳號 11111111）");
    expect(personName({ id: MEMBER, name: "  " })).toBe("（已刪除的帳號 11111111）");
    expect(personName(null)).toBe("—");
  });
});
