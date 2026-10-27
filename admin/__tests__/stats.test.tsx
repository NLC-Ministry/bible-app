// @vitest-environment jsdom
// 後台「報表」區（#568）：請求預算（打開分頁 1 個、切換顯示方式 0 個、換區間／換計畫 1 個）、圖表用 Chart.js 畫且換設定會重畫、
// 匯出與同步試算表各 1 個請求、沒有 export 權限就沒有按鈕、舊的營運區網址轉到這裡。資料用伺服器同一份整理規則產生。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi } from "../src/api.ts";
import { LEGACY_HELLO, LEGACY_INIT } from "../src/legacy.ts";
import type { AdminAuth } from "../src/auth.ts";
import { addDays, defaultUsageRange, rangeError, taipeiToday, topHours } from "../src/stats.ts";
import { buildUsage, normalizeRegistrationStats } from "../../supabase/functions/admin-api/stats.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAN = "33333333-3333-4333-8333-333333333333";
const PLANS = [
  { id: PLAN, name: "秋季速讀", plan_kind: "standard", start_date: "2026-10-01", end_date: "2026-12-31" },
  { id: OTHER_PLAN, name: "夏季速讀", plan_kind: "standard", start_date: "2026-06-01", end_date: "2026-08-31" }
];
const usageFor = (from: string, to: string) => buildUsage({
  from, to, today: to,
  days: [{ date: from, dau: 40, wau: 120, mau: 300, chapters: 95 }, { date: to, dau: 60, wau: 130, mau: 300, chapters: 150 }],
  l7: { current: { weekStart: "2026-10-12", weekEnd: "2026-10-18", coveredEnd: to, dayCount: 4, total: 10, buckets: [{ days: 2, users: 6 }, { days: 4, users: 4 }] } },
  hours: { cells: [{ dow: 1, hour: 6, sumUsers: 30, sumChapters: 70 }, { dow: 6, hour: 22, sumUsers: 9, sumChapters: 20 }], dayCounts: { 1: 1, 6: 1 } }
});
const statsFor = (planId: string) => normalizeRegistrationStats({
  planId,
  planName: planId === PLAN ? "秋季速讀" : "夏季速讀",
  summary: { withoutPastoralZoneNotJoined: 3, withoutPastoralZoneJoined: 1, withPastoralZoneNotJoined: 20, withPastoralZoneJoined: planId === PLAN ? 30 : 12, totalJoined: 31, totalRegistered: 54 },
  greatRegions: [{ label: "北區", signupCount: 20, registeredCount: 30, team3Count: 6, team6Count: 12 }],
  pastoralZones: [{ label: "北一", signupCount: 12, registeredCount: 18, team3Count: 3, team6Count: 6, leaderName: "<b>王</b>" }]
});

const CAPS = ["console.access", "support.read", "export", "plans.read", "operations.manage", "content.manage", "stats.read"];

class FakeChart {
  static made: { type: string; data: unknown }[] = [];
  static destroyed = 0;
  constructor(_canvas: HTMLCanvasElement, config: { type: string; data: unknown }) { FakeChart.made.push(config); }
  destroy() { FakeChart.destroyed += 1; }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = "";
  delete (window as any).Chart;
  FakeChart.made = [];
  FakeChart.destroyed = 0;
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

type MountOptions = { caps?: string[]; failures?: Record<string, [number, string]> };
async function mount(initialHash: string, { caps = CAPS, failures = {} }: MountOptions = {}) {
  window.location.hash = initialHash;
  (window as any).Chart = FakeChart;
  const requests: { action: string; params: any }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    if (failures[action]) return new Response(JSON.stringify({ error: failures[action][1] }), { status: failures[action][0] });
    let data: unknown = null;
    switch (action) {
      case "bootstrap":
        data = { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [], capabilities: caps };
        break;
      case "reading_usage":
        data = usageFor(params.from, params.to);
        break;
      case "registration_stats": {
        const planId = params.global_plan_id || PLAN;
        data = { plans: PLANS, planId, stats: statsFor(planId) };
        break;
      }
      case "registration_export":
        data = { filename: "報名與註冊統計-秋季速讀-2026-10-15.csv", csv: "a,b", rows: 2, total: 2, truncated: false };
        break;
      case "registration_sheet_sync":
        data = { synced: true, planName: "秋季速讀" };
        break;
      case "plan_options":
        data = { plans: PLANS, default_plan_id: PLAN };
        break;
      case "plan_quiz":
        data = {
          enrolled: 10,
          daily: { enabled: true, configured: true, participants: 4, days: [{ date: "2026-10-14", eligible: 10, submitted: 4 }] },
          exam: { enabled: true, papers: [] },
          lightning: null
        };
        break;
      default:
        data = null;
    }
    return new Response(JSON.stringify({ data, request_id: "srv" }), { status: 200 });
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
  await flush();
  return { requests, el: container };
}

const actions = (requests: { action: string }[]) => requests.map((r) => r.action);
const button = (el: Element, label: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  await flush();
};
const today = taipeiToday();

describe("讀經使用率", () => {
  it("opens with one reading_usage for the last 30 days and draws the charts with Chart.js", async () => {
    const { requests, el } = await mount("#/stats");
    expect(actions(requests)).toEqual(["bootstrap", "reading_usage"]);
    expect(requests[1].params).toEqual(defaultUsageRange(today));
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toContain("報表");
    expect(el.textContent).toMatch(/有讀＝[^。]*任何一章，不限計畫書卷/);
    // 每天讀經人數 2 張、每日趨勢 1 張、L7 1 張、時段 1 張
    expect(FakeChart.made).toHaveLength(5);
    expect(el.querySelectorAll("canvas[role='img']")).toHaveLength(5);
    // 每日趨勢的表格：伺服器每天一列，不是原始紀錄
    expect(el.textContent).toContain("245");
  });

  it("switching the hour view redraws without a request; a new range costs one request", async () => {
    const { requests, el } = await mount("#/stats");
    const before = requests.length;
    const made = FakeChart.made.length;
    await click(button(el, "週末"));
    await click(button(el, "章數"));
    expect(requests).toHaveLength(before);
    expect(FakeChart.made.length).toBe(made + 2);
    expect(FakeChart.destroyed).toBeGreaterThanOrEqual(2);

    await click(button(el, "近 7 天"));
    expect(requests.slice(before)).toEqual([{ action: "reading_usage", params: { from: addDays(today, -6), to: today } }]);
    // 回到 30 天走快取，不重抓
    await click(button(el, "近 30 天"));
    expect(requests).toHaveLength(before + 1);
  });

  it("an invalid range shows why and sends nothing", async () => {
    const { requests, el } = await mount("#/stats");
    const before = requests.length;
    const input = el.querySelectorAll<HTMLInputElement>(".adm-stats__date input")[0];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, addDays(today, -200));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(el.textContent).toContain("日期區間最長 180 天");
    expect(requests).toHaveLength(before);
  });

  it("says so when Chart.js cannot load, and the tables still have the numbers", async () => {
    const { el } = await mount("#/stats");
    expect(el.querySelector("table")).toBeTruthy();
    expect(rangeError("2026-10-02", "2026-10-01")).toBe("起日不能晚於迄日。");
    expect(topHours([0, 3, 3, 1])).toEqual([{ hour: 1, value: 3 }, { hour: 2, value: 3 }, { hour: 3, value: 1 }]);
  });
});

describe("報名註冊", () => {
  it("opens with one registration_stats (it brings the plan list) and escapes names", async () => {
    const { requests, el } = await mount("#/stats/registrations");
    expect(actions(requests)).toEqual(["bootstrap", "registration_stats"]);
    expect(requests[1].params).toEqual({ global_plan_id: null });
    expect(el.querySelector<HTMLSelectElement>("#adm-stats-plan")!.value).toBe(PLAN);
    expect(el.textContent).toContain("總註冊人數");
    expect(el.textContent).toContain("北一");
    expect(el.textContent).toContain("<b>王</b>");
    expect(el.querySelector("b")).toBeNull();
  });

  it("switching plans costs one request and keeps the plan in the URL", async () => {
    const { requests, el } = await mount("#/stats/registrations");
    const pick = el.querySelector<HTMLSelectElement>("#adm-stats-plan")!;
    await act(async () => {
      pick.value = OTHER_PLAN;
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await flush();
    expect(window.location.hash).toBe(`#/stats/registrations?plan=${OTHER_PLAN}`);
    expect(requests.slice(2)).toEqual([{ action: "registration_stats", params: { global_plan_id: OTHER_PLAN } }]);
  });

  it("export downloads the server's CSV; the sheet sync sends only the plan id", async () => {
    (URL as any).createObjectURL = vi.fn(() => "blob:test");
    (URL as any).revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    const { requests, el } = await mount("#/stats/registrations");
    await click(button(el, "匯出 CSV"));
    expect(downloads).toEqual(["報名與註冊統計-秋季速讀-2026-10-15.csv"]);
    await click(button(el, "更新到 Google 試算表"));
    expect(requests.slice(2)).toEqual([
      { action: "registration_export", params: { global_plan_id: PLAN } },
      { action: "registration_sheet_sync", params: { global_plan_id: PLAN } }
    ]);
    expect(el.querySelector(".adm-status")?.textContent).toContain("已更新到 Google 試算表");
  });

  it("shows the sheet failure in words", async () => {
    const { el } = await mount("#/stats/registrations", { failures: { registration_sheet_sync: [502, "sheet_sync_failed"] } });
    await click(button(el, "更新到 Google 試算表"));
    expect(el.querySelector(".adm-status")).toBeNull();
    expect(el.textContent).toMatch(/試算表/);
  });

  it("hides export and the sheet sync without the export capability", async () => {
    const { el } = await mount("#/stats/registrations", { caps: CAPS.filter((cap) => cap !== "export") });
    expect(el.textContent).toContain("總註冊人數");
    expect(button(el, "匯出 CSV")).toBeUndefined();
    expect(button(el, "更新到 Google 試算表")).toBeUndefined();
  });
});

describe("導覽", () => {
  it("shows 報表 only with stats.read", async () => {
    const { el } = await mount("#/", { caps: CAPS.filter((cap) => cap !== "stats.read") });
    expect([...el.querySelectorAll(".adm-nav__link")].map((link) => link.textContent)).not.toContain("報表");
  });

  it("報表 keeps two tabs; the quiz overview (#619) still shares the chosen plan with 報名註冊 (#581)", async () => {
    const { requests, el } = await mount("#/stats/registrations");
    const tabs = [...el.querySelectorAll(".adm-tabs a")].map((a) => a.textContent);
    expect(tabs).toEqual(["讀經使用率", "報名註冊"]);
    const pick = el.querySelector<HTMLSelectElement>("#adm-stats-plan")!;
    await act(async () => {
      pick.value = OTHER_PLAN;
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await go("#/quiz");
    expect(actions(requests).slice(3)).toEqual(["plan_options", "plan_quiz"]);
    expect(requests.at(-1)!.params).toEqual({ global_plan_id: OTHER_PLAN });
    expect(el.querySelector<HTMLSelectElement>("#adm-quiz-plan")!.value).toBe(OTHER_PLAN);
    expect(el.textContent).toContain("每日小測驗作答率");
    // 回到報名註冊：還是同一個計畫、快取裡有就不再打
    await go("#/stats/registrations");
    expect(el.querySelector<HTMLSelectElement>("#adm-stats-plan")!.value).toBe(OTHER_PLAN);
    expect(actions(requests).slice(5)).toEqual([]);
  });

  it("an old 測驗作答 bookmark opens the quiz area (#619)", async () => {
    const { el } = await mount("#/stats/quiz");
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("測驗");
    expect(el.querySelector("#adm-quiz-plan")).not.toBeNull();
  });

  it("the old 營運 pages land on the report tabs", async () => {
    // 網址不改寫（同其他搬走的區塊），直接打開對應的分頁
    const { requests, el } = await mount("#/operations/reading-activity");
    expect(actions(requests)).toEqual(["bootstrap", "reading_usage"]);
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toContain("報表");
    await go("#/operations/registrations");
    expect(actions(requests).slice(2)).toEqual(["registration_stats"]);
    expect(el.querySelector("#adm-stats-plan")).toBeTruthy();
  });
});

// #620：計畫、測驗、報表三區只有一個「目前選的計畫」；照搬的小測驗與組隊狀況用外框的計畫選單，經 bridge 告訴 iframe
describe("one chosen plan for 計畫、測驗、報表 (#620)", () => {
  const pickIn = async (el: Element, selector: string, value: string) => {
    const select = el.querySelector<HTMLSelectElement>(selector);
    expect(select).toBeTruthy();
    await act(async () => {
      select!.value = value;
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };
  const valueOf = (el: Element, selector: string) => el.querySelector<HTMLSelectElement>(selector)?.value;

  it("the legacy quiz and team tabs get the shell's plan menu; picking anywhere moves every area", async () => {
    const { el } = await mount("#/stats/registrations");
    await pickIn(el, "#adm-stats-plan", OTHER_PLAN);
    await go("#/quiz/quizzes");
    expect(el.querySelector<HTMLSelectElement>("#adm-legacy-plan")!.disabled).toBe(false);
    expect(valueOf(el, "#adm-legacy-plan")).toBe(OTHER_PLAN);

    await pickIn(el, "#adm-legacy-plan", PLAN);
    await go("#/quiz");
    expect(valueOf(el, "#adm-quiz-plan")).toBe(PLAN);
    await go("#/stats/registrations");
    expect(valueOf(el, "#adm-stats-plan")).toBe(PLAN);
    await go("#/plans");
    expect(valueOf(el, "#adm-plan-pick")).toBe(PLAN);

    await pickIn(el, "#adm-plan-pick", OTHER_PLAN);
    await go("#/plans/team-status");
    expect(valueOf(el, "#adm-legacy-plan")).toBe(OTHER_PLAN);
    // 計畫設定（所有計畫的設定）不分計畫，沒有選單
    await go("#/plans/settings");
    expect(el.querySelector("#adm-legacy-plan")).toBeNull();
  });

  it("Lightning Quiz and the big exam do not take a plan: the menu is disabled and says why", async () => {
    const { el } = await mount("#/quiz/lightning-quiz");
    const bar = () => el.querySelector(".adm-legacy__plan");
    expect(el.querySelector<HTMLSelectElement>("#adm-legacy-plan")!.disabled).toBe(true);
    expect(bar()!.textContent).toContain("雲柱不分計畫");
    await go("#/quiz/exam");
    expect(el.querySelector<HTMLSelectElement>("#adm-legacy-plan")!.disabled).toBe(true);
    expect(bar()!.textContent).toContain("大測驗在每張試卷的設定裡選計畫");
    await go("#/quiz/quizzes");
    expect(el.querySelector<HTMLSelectElement>("#adm-legacy-plan")!.disabled).toBe(false);
    expect(bar()!.textContent).not.toContain("不分計畫");
  });

  it("tells the iframe the plan at the handshake and again whenever it changes", async () => {
    const { el } = await mount("#/quiz/quizzes");
    const frame = el.querySelector<HTMLIFrameElement>("iframe.adm-legacy__frame")!;
    const posted: { message: any; transfer: any[] }[] = [];
    (frame.contentWindow as any).postMessage = (message: unknown, _origin: string, transfer: any[]) => posted.push({ message, transfer });
    const hello = new MessageEvent("message", { data: { type: LEGACY_HELLO }, origin: window.location.origin });
    Object.defineProperty(hello, "source", { value: frame.contentWindow });
    await act(async () => { window.dispatchEvent(hello); });
    expect(posted[0].message).toMatchObject({ type: LEGACY_INIT, section: "quizzes", plan: PLAN });

    const port = posted[0].transfer[0] as MessagePort;
    const heard: unknown[] = [];
    port.onmessage = (event) => heard.push(event.data);
    await pickIn(el, "#adm-legacy-plan", OTHER_PLAN);
    await flush();
    expect(heard).toContainEqual({ type: "plan", plan: OTHER_PLAN });
    port.close();
  });

  it("without plans.read there is no plan to give: no menu, no request, the iframe keeps its own filter", async () => {
    const { requests, el } = await mount("#/quiz/quizzes", { caps: ["console.access", "support.read", "content.manage"] });
    expect(el.querySelector("iframe.adm-legacy__frame")).not.toBeNull();
    expect(el.querySelector("#adm-legacy-plan")).toBeNull();
    expect(actions(requests)).toEqual(["bootstrap"]);
  });
});
