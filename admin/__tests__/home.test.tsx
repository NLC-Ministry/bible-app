// @vitest-environment jsdom
// 後台首頁（#569）：開後台＝bootstrap＋1 個 home_summary；只有數字、不含任何人的名字；
// 點「需要關心」「還沒滿的隊」「未結案的回報」進去時，那一頁的篩選已經設好，人數和首頁一樣。
// 回應用伺服器同一份規則（_shared/progress/plan-report.mjs）產生。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { QUIZ_STATUS_LABEL, quizNotReady, showQuiz, waitingDays, waitingText, type HomeSummary } from "../src/home.ts";
import { buildPlanRoster, buildPlanSummary, preparePlanReport, resolvePlanForReport } from "../../supabase/functions/_shared/progress/plan-report.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-11";
const PLAN_ROW = {
  id: PLAN, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const enrollment = (chapters: number, lastReadDay: string | null) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {}, lastReadAt: lastReadDay ? `${lastReadDay}T04:00:00Z` : null, readDays7: lastReadDay ? 1 : 0
});
const team = { id: "t1", name: "晨光隊", division: 3, size: 2 };
const person = (id: string, name: string, chapters: number, lastReadDay: string | null, teams: unknown[] = []) => ({
  id, name, greatRegion: "北區", pastoralZone: "北一", smallGroup: "A組", enrollment: enrollment(chapters, lastReadDay), teams, quiz: { published: 0, submitted: 0 }
});
const PEOPLE = [
  person("u1", "甲", 11, "2026-11-11", [team]),
  person("u2", "乙", 2, "2026-11-02", [team]),
  person("u3", "丙", 0, null)
];
const overview = { today: TODAY, people: PEOPLE, meta: { inScope: 3, enrolled: 3 } };
const report = () => preparePlanReport({ resolved: resolvePlanForReport(PLAN_ROW), overview });
const SUMMARY = buildPlanSummary(report());
const ROSTER = buildPlanRoster(report());

const homeSummary = (extra: Partial<HomeSummary> = {}): HomeSummary => ({
  plan: {
    plan: SUMMARY.plan, today: SUMMARY.today, schedule: SUMMARY.schedule, funnel: SUMMARY.funnel,
    care: SUMMARY.care, teams: SUMMARY.teams, meta: SUMMARY.meta
  },
  reports: { open: 3, unread: 1, oldest_open_at: "2026-11-08T01:00:00Z" },
  commentary: { pending: 355, approved: 2 },
  quiz: { enabled: true, configured: true, date: "2026-11-12", status: "waiting", needs_attention: true },
  changes: [{ action: "app_feature_settings.update", label: "修改功能開放設定", occurredAt: "2026-11-10T02:00:00Z" }],
  ...extra
});

const ALL_CAPS = ["console.access", "support.read", "plans.read", "content.manage", "audit.read", "operations.manage"];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = "";
  vi.useRealTimers();
});

async function flush(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function mount(initialHash: string, { caps = ALL_CAPS, home = homeSummary() }: { caps?: string[]; home?: HomeSummary } = {}) {
  window.location.hash = initialHash;
  const requests: { action: string; params: any }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    let data: unknown = null;
    switch (action) {
      case "bootstrap":
        data = { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [], capabilities: caps };
        break;
      case "home_summary": data = home; break;
      case "plan_options":
        data = { plans: [{ id: PLAN, name: PLAN_ROW.name, plan_kind: PLAN_ROW.plan_kind, start_date: PLAN_ROW.start_date, end_date: PLAN_ROW.end_date }], default_plan_id: PLAN };
        break;
      case "plan_summary": data = SUMMARY; break;
      case "plan_roster": data = ROSTER; break;
      case "team_list": data = { plan: {}, today: TODAY, teams: [], counts: { teams: 0, unfilled: 0, issues: 0, members: 0 } }; break;
      case "report_list": data = { items: [], next_cursor: null, counts: { all: 3, open: 3, pending: 2, processing: 1, resolved: 0, ignored: 0, unread: 1 } }; break;
      default: data = null;
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
const tile = (el: Element, label: string) => [...el.querySelectorAll<HTMLAnchorElement>("a.adm-home__tile")].find((a) => a.textContent?.includes(label));
const follow = async (link: HTMLAnchorElement | undefined) => {
  expect(link).toBeTruthy();
  await act(async () => {
    link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    window.location.hash = link!.getAttribute("href") || "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await flush();
  await flush();
};

describe("home page", () => {
  it("opening the console makes bootstrap + one home_summary, nothing else; the menu is ordered by what there is to do", async () => {
    const { requests, el } = await mount("");
    expect(actions(requests)).toEqual(["bootstrap", "home_summary"]);
    expect(requests[1].params).toEqual({});
    const nav = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    expect(nav).toEqual(["首頁", "計畫", "測驗", "人", "回報收件匣", "內容", "系統"]); // #619：測驗跟在計畫後面
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("首頁");
  });

  it("shows only numbers, with the default plan's name; no one's name", async () => {
    const { el } = await mount("#/");
    const text = el.textContent || "";
    expect(text).toContain("約翰福音 21 天");
    expect(tile(el, "未結案的回報")?.textContent).toContain("3");
    expect(tile(el, "未結案的回報")?.textContent).toContain("有新訊息 1 則");
    expect(tile(el, "需要關心")?.textContent).toContain(`${SUMMARY.care.total} 人`);
    expect(tile(el, "還沒滿的隊")?.textContent).toContain(`${SUMMARY.teams.unfilled} 隊`);
    expect(tile(el, "待審的經文注釋")?.textContent).toContain("355 則");
    expect(tile(el, "明天的小測驗")?.textContent).toContain("還沒出題");
    expect(text).toContain("修改功能開放設定");
    for (const name of ["甲", "乙", "丙"]) expect(el.querySelector(".adm-home")?.textContent).not.toContain(name);
    // 有待辦的格子標出來
    expect(tile(el, "需要關心")?.className).toContain("adm-home__tile--todo");
    expect(tile(el, "明天的小測驗")?.className).toContain("adm-home__tile--todo");
  });

  it("「需要關心」opens the default plan's roster already filtered: the same number of people", async () => {
    const { requests, el } = await mount("#/");
    await follow(tile(el, "需要關心"));
    expect(window.location.hash).toBe(`#/plans/roster?plan=${PLAN}`);
    expect(actions(requests)).toEqual(["bootstrap", "home_summary", "plan_options", "plan_summary", "plan_roster"]);
    expect(el.querySelectorAll(".adm-roster__item, .adm-roster li").length).toBeGreaterThan(0);
    expect(el.textContent).toContain(`${SUMMARY.care.total} 人`);
  });

  it("「還沒滿的隊」opens the teams tab with the 還沒滿 filter on", async () => {
    const { el } = await mount("#/");
    await follow(tile(el, "還沒滿的隊"));
    expect(window.location.hash).toBe(`#/plans/teams?plan=${PLAN}`);
    const active = [...el.querySelectorAll("[aria-pressed='true'], [aria-checked='true']")].map((node) => node.textContent);
    expect(active.some((label) => label?.includes("還沒滿"))).toBe(true);
  });

  it("「未結案的回報」opens the inbox on 未結案", async () => {
    const { requests, el } = await mount("#/");
    await follow(tile(el, "未結案的回報"));
    expect(window.location.hash).toBe("#/support");
    expect(requests.at(-1)).toEqual({ action: "report_list", params: { status: "open", limit: 30 } });
    expect(el.querySelector(".adm-chip--active")?.textContent).toContain("未結案");
  });

  it("hides what the account cannot open, and the quiz when it is off or not set up", async () => {
    const { el } = await mount("#/", { caps: ["console.access", "support.read"], home: homeSummary({ quiz: { enabled: false, configured: true, date: "2026-11-12", status: "waiting", needs_attention: true } }) });
    expect(tile(el, "未結案的回報")).toBeTruthy();
    expect(tile(el, "需要關心")).toBeUndefined();
    expect(tile(el, "待審的經文注釋")).toBeUndefined();
    expect(tile(el, "明天的小測驗")).toBeUndefined();
    expect(el.textContent).not.toContain("最近的設定變更");
  });

  it("says so when there is no plan, and shows an error instead of an empty page", async () => {
    const { el } = await mount("#/", { home: homeSummary({ plan: null }) });
    expect(el.textContent).toContain("還沒有任何計畫");
    expect(tile(el, "需要關心")).toBeUndefined();
    expect(tile(el, "未結案的回報")).toBeTruthy();
  });
});

describe("home rules", () => {
  it("counts how long the oldest open report has waited", () => {
    const now = new Date("2026-11-11T02:00:00Z");
    expect(waitingDays("2026-11-08T01:00:00Z", now)).toBe(3);
    expect(waitingDays("2026-11-11T01:00:00Z", now)).toBe(0);
    expect(waitingDays(null, now)).toBeNull();
    expect(waitingText(3)).toBe("最舊的已等 3 天");
    expect(waitingText(0)).toBe("最舊的今天送出");
    expect(waitingText(null)).toBe("");
  });

  it("shows tomorrow's quiz only when it is on, set up and inside the plan", () => {
    const quiz = { enabled: true, configured: true, date: "2026-11-12", status: "scheduled" as const, needs_attention: false };
    expect(showQuiz(quiz)).toBe(true);
    expect(showQuiz({ ...quiz, enabled: false })).toBe(false);
    expect(showQuiz({ ...quiz, configured: false })).toBe(false);
    expect(showQuiz({ ...quiz, status: "outside_plan" })).toBe(false);
    expect(showQuiz(null)).toBe(false);
    expect(quizNotReady("waiting")).toBe(true);
    expect(quizNotReady("failed")).toBe(true);
    expect(quizNotReady("scheduled")).toBe(false);
    expect(quizNotReady("skipped")).toBe(false);
    expect(QUIZ_STATUS_LABEL.scheduled).toBe("已準備好");
  });
});
