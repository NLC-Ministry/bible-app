// @vitest-environment jsdom
// 請求預算（#555、#550、#567）：用假的 admin-api 數請求。開後台＝bootstrap＋預設頁（回報收件匣）的 1 個清單、
// 打開某人 1 個（除錯檢查＋各區筆數）；各區點開才調閱、筆數 0 的不打；同一個人 60 秒內重開不重抓。
// 名單的搜尋（停 300ms 才送）在 accounts.test.tsx，隊伍搜尋在 teams.test.tsx。
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

const REPORT = { section: "reports", id: "r1", at: "2026-10-05T00:00:00Z", category: "bug", status: "pending", description: "<b>看不到進度</b>" };

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
    counts: { plans: 1, reading_logs: 42, teams: 0, team_events: 0, tests: 0, vouchers: 3, reports: 1, notifications: 0 },
    voucher_states: { unredeemed: 1, redeemed: 1, expired: 1, voided: 0 },
    notes: { verse_notes: 7, devotional_notes: 0, last_updated_at: "2026-10-02T00:00:00Z" },
    checks: [
      { id: "duplicate_enrollment", label: "沒有重複報名", status: "ok", summary: "每個計畫只報名一次。", details: [] },
      {
        id: "orphan_logs", label: "打卡都有歸屬計畫", status: "fail", summary: "5 筆打卡（5 章）沒有歸屬任何計畫。",
        details: ["書卷：出埃及記"], impact: "累積章數會多算 5 章。", fix: "之後評估", links: [{ kind: "user", id: OTHER, label: "李大華" }]
      },
      { id: "app_version", label: "App 是最新版", status: "unknown", summary: "這個人沒有回報過，不知道 App 版本。", details: [] }
    ],
    app_plans: [{
      plan: { id: "11111111-1111-4111-8111-111111111111", name: "第四季速讀", start_date: "2026-10-01", end_date: "2026-12-31", state: "running", books: [], total_days: 92, expected_days: 10 },
      shown: true, account_active: true, enrolled: true, status: "behind", status_label: "落後 3天", round: 1, progress: 38, chapters: 42,
      behind_days: 3, last_read_at: "2026-10-07T00:00:00Z", days_since_read: 3, read_days_7: 2, care: true, care_reasons: ["3 天沒打卡"], teams: []
    }],
    today: "2026-10-10"
  };
}

function respond(action: string, params: any) {
  switch (action) {
    case "bootstrap":
      return { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [],
        capabilities: ["console.access", "support.read", "support.pii", "audit.read", "export"] };
    case "user_summary":
      return summaryFor(params.user_id, params.user_id === USER ? "王小明" : "李大華");
    case "user_section":
      if (params.section === "reports") return { items: [REPORT], next_cursor: null };
      if (params.section === "reading_logs" && !params.cursor) {
        return { items: [5, 4, 3, 2, 1].map((n) => log(`l${n}`, `2026-10-0${n}T00:00:00Z`, n)), next_cursor: { at: "2026-10-01T00:00:00Z", id: "l1" } };
      }
      return { items: [log("l0", "2026-09-30T00:00:00Z", 99)], next_cursor: null };
    case "user_timeline":
      return { items: [log("t1", "2026-10-09T00:00:00Z", 7)], next_cursor: null };
    case "report_list":
      return { items: [], next_cursor: null, counts: { all: 0, open: 0, pending: 0, processing: 0, resolved: 0, ignored: 0, unread: 0 } };
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
    getToken: () => "token-in-memory",
    getIdToken: () => null
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

/** 點個人頁某一區的標題（展開或收起） */
async function togglePanel(el: HTMLElement, name: string) {
  const button = [...el.querySelectorAll<HTMLButtonElement>(".adm-panel__toggle")].find((b) => b.querySelector(".adm-panel__label")?.textContent === name);
  if (!button) throw new Error(`no panel ${name}`);
  await act(async () => { button.click(); });
  await flush();
}

const PERSON = `#/people/user/${USER}?reason=${encodeURIComponent("因回報 #1")}`;

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("admin console request budget", () => {
  it("opening the console makes bootstrap + one inbox page, nothing else", async () => {
    const { requests, el } = await mount("#/support");
    expect(actions(requests)).toEqual(["bootstrap", "report_list"]);
    expect(el.textContent).toContain("王管理");
    expect(el.textContent).toContain("測試站");
    const nav = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    expect(nav[0]).toContain("客服");
  });

  it("opening a person makes exactly one request (checks + counts); reopening within 60 s makes none", async () => {
    const { requests, el } = await mount("#/support");
    await go(PERSON);
    expect(actions(requests)).toEqual(["bootstrap", "report_list", "user_summary"]);
    expect(requests[2].params).toEqual({ user_id: USER, reason: "因回報 #1" });
    expect(el.textContent).toContain("王小明");
    expect(el.querySelector<HTMLInputElement>("#adm-person-reason")!.value).toBe("因回報 #1");
    // 各區先顯示筆數，內容還沒調閱
    expect(el.textContent).toContain("打卡紀錄42 筆");
    expect(el.textContent).toContain("3 筆（未兌換 1・已兌換 1・已過期 1）");
    expect(el.textContent).toContain("7 則（不顯示內容）");
    expect(el.textContent).not.toContain("創世記");

    // 換人再回來：新的人 1 個請求，回來的人 0 個
    await go(`#/people/user/${OTHER}`);
    await go(`#/people/user/${USER}`);
    expect(actions(requests)).toEqual(["bootstrap", "report_list", "user_summary", "user_summary"]);
  });

  it("a direct link to a person costs bootstrap + one summary; old /support/user links still work", async () => {
    const { requests, el } = await mount(`#/support/user/${USER}/reading_logs`);
    expect(actions(requests)).toEqual(["bootstrap", "user_summary"]);
    expect(el.textContent).toContain("王小明");
  });

  it("shows the checks and what the member's App should show", async () => {
    const { el } = await mount(PERSON);
    const checks = [...el.querySelectorAll(".adm-check")];
    expect(checks.map((check) => check.className)).toEqual(["adm-check adm-check--ok", "adm-check adm-check--fail", "adm-check adm-check--unknown"]);
    expect(checks[1].textContent).toContain("5 筆打卡（5 章）沒有歸屬任何計畫。");
    expect(checks[1].textContent).toContain("累積章數會多算 5 章。");
    expect(checks[1].querySelector("a")!.getAttribute("href")).toBe(`#/people/user/${OTHER}?${new URLSearchParams({ reason: "從王小明的除錯檢查查看" })}`);
    expect(el.textContent).toContain("除錯檢查（1 項要看）");
    expect(el.textContent).toContain("第 1 遍・38%・落後 3天");
    expect(el.textContent).toContain("3 天沒打卡");
  });

  it("loads a section only when opened, with the reason; more with a cursor; zero-count and local sections cost nothing", async () => {
    const { requests, el } = await mount(PERSON);
    await togglePanel(el, "打卡紀錄");
    expect(requests[2]).toEqual({ action: "user_section", params: { user_id: USER, section: "reading_logs", limit: 20, reason: "因回報 #1" } });
    expect(el.textContent).toContain("共 42 筆，已顯示 5 筆");
    const more = [...el.querySelectorAll("button")].find((b) => b.textContent === "載入更多")!;
    await act(async () => { more.click(); });
    await flush();
    expect(requests[3]).toEqual({
      action: "user_section",
      params: { user_id: USER, section: "reading_logs", cursor: { at: "2026-10-01T00:00:00Z", id: "l1" }, limit: 20, reason: "因回報 #1" }
    });
    expect(el.textContent).toContain("創世記 99 章");

    // 收起再打開、筆數 0 的區塊、帳號／徽章／經文筆記：都不打請求
    await togglePanel(el, "打卡紀錄");
    await togglePanel(el, "打卡紀錄");
    expect(el.textContent).toContain("創世記 99 章");
    await togglePanel(el, "測驗");
    expect(el.textContent).toContain("沒有測驗。");
    await togglePanel(el, "帳號");
    await togglePanel(el, "徽章");
    expect(el.textContent).toContain("伺服器沒有這份資料");
    await togglePanel(el, "經文筆記");
    expect(el.textContent).toContain("屬於個人靈修，後台不顯示。");
    expect(requests).toHaveLength(4);

    await togglePanel(el, "時間軸");
    expect(requests[4]).toEqual({ action: "user_timeline", params: { user_id: USER, limit: 30, reason: "因回報 #1" } });
    expect(el.textContent).toContain("創世記 7 章");
  });

  it("an edited reason is used for sections opened afterwards", async () => {
    const { requests, el } = await mount(PERSON);
    await typeInto(el.querySelector<HTMLInputElement>("#adm-person-reason")!, "會友來電");
    await togglePanel(el, "回報");
    expect(requests.at(-1)).toEqual({ action: "user_section", params: { user_id: USER, section: "reports", limit: 20, reason: "會友來電" } });
  });

  it("member-entered text renders as text, never as HTML", async () => {
    const { el } = await mount(PERSON);
    await togglePanel(el, "回報");
    expect(el.textContent).toContain("<b>看不到進度</b>");
    expect(el.querySelector(".adm-items b")).toBeNull();
  });
});

describe("personal data is masked until revealed", () => {
  it("shows masked email/phone and calls reveal_pii (audited) only on demand", async () => {
    const { requests, el } = await mount(PERSON);
    await togglePanel(el, "帳號");
    expect(el.textContent).toContain("wa***@example.com");
    expect(el.textContent).not.toContain("wang@example.com");
    const show = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("顯示 email"))!;
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

describe("access", () => {
  it("an account without console access sees the no-permission screen and no further requests", async () => {
    window.location.hash = "#/support";
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)).action);
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    });
    const auth: AdminAuth = { init: async () => ({ status: "signed_in" }), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), getToken: () => "t", getIdToken: () => null };
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
