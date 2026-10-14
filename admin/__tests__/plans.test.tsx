// @vitest-environment jsdom
// 後台「計畫」區（#565）：請求預算（需要時才調閱）、從總覽點進名單人數一致、名單篩選與白話句子、
// 展開一列不發請求、關心提醒、匯出、測驗作答的顯示規則。資料用伺服器同一份規則（_shared/progress）產生。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { describeFilters, drillFilters, presetFilters } from "../src/plans.ts";
import {
  buildPlanRoster,
  buildPlanSummary,
  preparePlanReport,
  resolvePlanForReport
} from "../../supabase/functions/_shared/progress/plan-report.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAN = "33333333-3333-4333-8333-333333333333";
const PLAN_ROW = {
  id: PLAN, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const at = (day: string) => `${day}T04:00:00Z`;
const enrollment = (chapters: number, lastReadDay: string | null, extra: Record<string, unknown> = {}) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {},
  lastReadAt: lastReadDay ? at(lastReadDay) : null, readDays7: lastReadDay ? 1 : 0, ...extra
});
const person = (id: string, name: string, unit: string[], enroll: unknown, teams: unknown[] = []) => ({
  id, name, greatRegion: unit[0], pastoralZone: unit[1], smallGroup: unit[2], enrollment: enroll, teams, quiz: { published: 4, submitted: 2 }
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PEOPLE = [
  person(uuid(1), "甲", ["北區", "北一", "A組"], enrollment(11, "2026-11-11"), [{ id: "t1", name: "晨光隊", division: 3, status: "active", size: 2, captain: true }]),
  person(uuid(2), "乙", ["北區", "北一", "A組"], enrollment(10, "2026-11-10")),
  person(uuid(3), "丙", ["北區", "北二", "B組"], enrollment(8, "2026-11-07")),
  person(uuid(4), "丁", ["南區", "南一", "C組"], enrollment(2, "2026-11-02", { readDays7: 0 })),
  person(uuid(5), "<b>戊</b>", ["南區", "南一", "C組"], enrollment(0, null)),
  person(uuid(6), "己", ["南區", "南二", "D組"], enrollment(24, "2026-11-11", { round: 2, maxRound: 2, upgradeHandled: true, byRound: { 1: 21, 2: 3 } })),
  person(uuid(7), "庚", ["南區", "南二", "D組"], null)
];
const report = (meta?: Record<string, number>) => preparePlanReport({
  resolved: resolvePlanForReport(PLAN_ROW),
  overview: { today: "2026-11-11", people: PEOPLE, meta: meta || { inScope: 7, enrolled: 6 } }
});

type Quiz = Record<string, unknown>;
const QUIZ: Quiz = {
  today: "2026-11-11", enrolled: 6,
  daily: { enabled: true, configured: true, participants: 3, days: [{ date: "2026-11-10", eligible: 5, submitted: 2 }, { date: "2026-11-11", eligible: 5, submitted: 4 }] },
  exam: { enabled: false, papers: [{ id: "e1", title: "期末考", status: "open", open_at: null, close_at: null, started: 1, submitted: 1, graded: 0, pending: 1, enrolled_takers: 1, average: null }] },
  lightning: null
};

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

const CAPS = ["console.access", "support.read", "export", "plans.read", "plans.remind", "operations.manage", "content.manage"];

type MountOptions = { caps?: string[]; meta?: Record<string, number>; quiz?: Quiz; failures?: Record<string, number> };
async function mount(initialHash: string, { caps = CAPS, meta, quiz = QUIZ, failures = {} }: MountOptions = {}) {
  window.location.hash = initialHash;
  const requests: { action: string; params: any }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    if (failures[action]) return new Response(JSON.stringify({ error: "admin_api_failed" }), { status: failures[action] });
    let data: unknown = null;
    switch (action) {
      case "bootstrap":
        data = { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [], capabilities: caps };
        break;
      case "plan_options":
        data = { plans: [{ id: PLAN, name: PLAN_ROW.name, plan_kind: "standard", start_date: "2026-11-01", end_date: "2026-11-21" },
          { id: OTHER_PLAN, name: "夏季", plan_kind: "standard", start_date: "2026-06-01", end_date: "2026-08-31" }], default_plan_id: PLAN };
        break;
      case "plan_summary":
        data = buildPlanSummary(report(meta));
        break;
      case "plan_roster":
        data = buildPlanRoster(report(meta));
        break;
      case "plan_quiz":
        data = quiz;
        break;
      case "plan_roster_export":
        data = { filename: "計畫名單.csv", csv: "a,b", rows: 3, total: 7, truncated: false };
        break;
      case "care_remind":
        data = { id: "r1", reason: params.reason, message: params.message, status: "unread", sent_on: "2026-11-11" };
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
const buttons = (el: Element, label: string) => [...el.querySelectorAll("button")].filter((b) => b.textContent?.includes(label));
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  await flush();
};
const sentence = (el: Element) => el.querySelector(".adm-roster__sentence")?.textContent || "";
const names = (el: Element) => [...el.querySelectorAll(".adm-roster__name")].map((node) => node.firstChild?.textContent);

describe("plan area request budget", () => {
  it("opens with plan options + the summary (numbers only); each tab loads only what it shows", async () => {
    const { requests, el } = await mount("#/plans");
    expect(actions(requests)).toEqual(["bootstrap", "plan_options", "plan_summary"]);
    expect(requests[2].params).toEqual({ global_plan_id: PLAN });
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("計畫");
    expect(el.textContent).toContain("第 11 天／共 21 天");
    expect(el.textContent).toContain("今天應讀到 約翰福音 11 章");
    expect(el.textContent).toContain("資料核對：7／7 人");
    // 總覽不含任何人名
    expect(el.textContent).not.toContain("丁");

    await go("#/plans/roster");
    expect(actions(requests).slice(3)).toEqual(["plan_roster"]);
    await go("#/plans/teams");
    await go("#/plans");
    expect(requests).toHaveLength(4);
    await go("#/plans/quiz");
    expect(actions(requests).slice(4)).toEqual(["plan_quiz"]);
    await go("#/plans/roster");
    await go("#/plans/quiz");
    expect(requests).toHaveLength(5);
  });

  it("switching plans reloads the summary for that plan; the settings tab costs nothing", async () => {
    const { requests, el } = await mount("#/plans");
    const pick = el.querySelector<HTMLSelectElement>("#adm-plan-pick")!;
    expect(pick.value).toBe(PLAN);
    await act(async () => {
      pick.value = OTHER_PLAN;
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await flush();
    expect(window.location.hash).toBe(`#/plans?plan=${OTHER_PLAN}`);
    expect(requests[requests.length - 1]).toEqual({ action: "plan_summary", params: { global_plan_id: OTHER_PLAN } });
    const before = requests.length;
    await go("#/plans/settings");
    await go("#/plans");
    // 回來時還是剛剛選的計畫（快取，不重抓）
    expect(requests).toHaveLength(before);
    expect(el.querySelector<HTMLSelectElement>("#adm-plan-pick")!.value).toBe(OTHER_PLAN);
  });
});

describe("overview → roster", () => {
  it("each funnel layer opens a roster with exactly that many people", async () => {
    const { el } = await mount("#/plans");
    const expected: [string, number][] = [["註冊", 7], ["報名", 6], ["近 7 天有讀", 4], ["跟上進度", 3], ["讀完一遍", 1]];
    for (const [label, count] of expected) {
      await go("#/plans");
      const row = [...el.querySelectorAll(".adm-funnel__row")].find((node) => node.querySelector(".adm-funnel__label")?.textContent === label);
      expect(row?.textContent, label).toContain(`${count} 人`);
      await click(row);
      expect(window.location.hash).toBe("#/plans/roster");
      expect(sentence(el), label).toContain(`→ ${count} 人`);
    }
  });

  it("the care numbers open the same people, and the explanation says why they overlap", async () => {
    const { el } = await mount("#/plans");
    expect(el.textContent).toContain("前兩個加起來會比合計多");
    await click(buttons(el, "打開這 3 人的名單")[0]);
    expect(sentence(el)).toContain("需要關心");
    expect(sentence(el)).toContain("→ 3 人");
    expect(names(el)).toEqual(["<b>戊</b>", "丁", "丙"]);
    // 會友輸入的文字當文字顯示
    expect(el.querySelector(".adm-roster__name b")).toBeNull();
    await go("#/plans");
    await click(buttons(el, "落後 7 天以上")[0]);
    expect(sentence(el)).toContain("→ 2 人");
  });

  it("expands a region into its pastoral zones without a request", async () => {
    const { requests, el } = await mount("#/plans");
    const before = requests.length;
    expect(el.querySelectorAll(".adm-table tbody tr")).toHaveLength(2);
    await click([...el.querySelectorAll<HTMLButtonElement>(".adm-table__toggle")].find((b) => b.textContent === "南區"));
    const rows = [...el.querySelectorAll(".adm-table tbody tr")].map((tr) => tr.querySelector("th")?.textContent);
    expect(rows).toEqual(["北區", "南區", "南一", "南二"]);
    expect(requests).toHaveLength(before);
  });
});

describe("roster", () => {
  it("defaults to enrolled people, most behind first, with the late marker", async () => {
    const { el } = await mount("#/plans/roster");
    expect(sentence(el)).toBe("報名者 → 6 人");
    expect(names(el).slice(0, 3)).toEqual(["<b>戊</b>", "丁", "丙"]);
    const ding = [...el.querySelectorAll(".adm-roster__row")].find((li) => li.textContent?.includes("丁"))!;
    expect(ding.querySelector(".adm-roster__late")?.textContent).toBe("9 天沒打卡");
    expect(ding.textContent).toContain("南區・南一・C組");
  });

  it("ticks inside a condition are a union, conditions intersect, and the sentence says so", async () => {
    const { el } = await mount("#/plans/roster");
    await click(buttons(el, "全部")[0]);
    expect(sentence(el)).toBe("全部的人 → 7 人");
    await click(buttons(el, "報名者")[0]);
    // 只留「落後 2–6 天」「落後 7 天以上」：先取消跟上、讀完
    await click(buttons(el, "跟上進度")[0]);
    await click(buttons(el, "讀完一遍")[0]);
    expect(sentence(el)).toBe("進度是「落後 2–6 天」或「落後 7 天以上」 → 3 人");
    for (const label of ["今天", "1–2 天前", "3–6 天前", "沒有紀錄"]) await click(buttons(el, label)[0]);
    expect(sentence(el)).toBe("進度是「落後 2–6 天」或「落後 7 天以上」，且最後打卡是「7 天以上」 → 1 人");
    expect(names(el)).toEqual(["丁"]);
    expect(describeFilters({ ...presetFilters("enrolled"), team: "no" })).toBe("報名者，且沒有隊");
  });

  it("names the unticked boxes when most of a condition is ticked, so the sentence stays short", () => {
    const enrolled = presetFilters("enrolled");
    expect(describeFilters({ ...enrolled, checkin: ["today", "recent", "lapsed", "none"] })).toBe("報名者，且最後打卡不是「7 天以上」");
    expect(describeFilters({ ...enrolled, checkin: ["today", "recent", "none"] })).toBe("報名者，且最後打卡不是「3–6 天前」也不是「7 天以上」");
    expect(describeFilters({ ...enrolled, progress: ["completed", "behind", "behind_long"] })).toBe("報名者，且進度不是「跟上進度」");
    expect(describeFilters({ ...enrolled, progress: ["on_track", "completed", "behind", "not_enrolled"] })).toBe("進度不是「落後 7 天以上」");
  });

  it("a shortcut is left by ticking any box, which keeps only that box", async () => {
    const { el } = await mount("#/plans/roster");
    await click(buttons(el, "需要關心")[0]);
    expect(el.textContent).toContain("捷徑");
    await click(buttons(el, "落後 2–6 天")[0]);
    expect(sentence(el)).toBe("進度是「落後 2–6 天」 → 1 人");
    expect(drillFilters("care").shortcut).toBe("care");
  });

  it("searches name and unit, and sorts by chapters", async () => {
    const { el } = await mount("#/plans/roster");
    const input = el.querySelector<HTMLInputElement>("#adm-roster-q")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " 北一 ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(sentence(el)).toBe("報名者，且姓名或單位含「北一」 → 2 人");
    const sort = el.querySelector<HTMLSelectElement>("#adm-roster-sort")!;
    await act(async () => {
      sort.value = "chapters_desc";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(names(el)).toEqual(["甲", "乙"]);
  });

  it("expanding a row costs no request; the care reminder sends once and shows what was sent", async () => {
    const { requests, el } = await mount("#/plans/roster");
    const before = requests.length;
    const row = [...el.querySelectorAll(".adm-roster__row")].find((li) => li.textContent?.includes("丁"))!;
    await click(row.querySelector(".adm-roster__summary")!);
    expect(requests).toHaveLength(before);
    expect(row.textContent).toContain("第 1 遍 2 章");
    expect(row.textContent).toContain("落後 9 天、9 天沒打卡");
    expect(row.textContent).toContain("沒有隊");
    const person = row.querySelector<HTMLAnchorElement>(".adm-link")!;
    expect(person.getAttribute("href")).toContain(`#/support/user/${uuid(4)}?reason=`);

    await click(buttons(row, "關心提醒")[0]);
    expect(row.querySelector<HTMLSelectElement>("select")!.value).toBe("behind");
    expect(row.querySelector("textarea")!.value).toContain("Hi 丁！");
    await click(buttons(row, "送出")[0]);
    expect(requests[requests.length - 1]).toEqual({
      action: "care_remind",
      params: { global_plan_id: PLAN, recipient_id: uuid(4), reason: "behind", message: "Hi 丁！這週的讀經進度稍微落後囉，有任何困難都可以跟我說喔，加油！" }
    });
    expect(row.textContent).toContain("今天已送出關心提醒");
    expect(buttons(row, "關心提醒").filter((b) => b.textContent === "關心提醒")).toHaveLength(0);
  });

  it("exports with the same conditions and sort, through the server", async () => {
    const { requests, el } = await mount("#/plans/roster");
    await click(buttons(el, "需要關心")[0]);
    await click(buttons(el, "匯出這份名單")[0]);
    expect(requests[requests.length - 1]).toEqual({
      action: "plan_roster_export",
      params: { global_plan_id: PLAN, filters: { ...drillFilters("care") }, sort: "behind" }
    });
    expect(el.textContent).toContain("已匯出 3 人");
  });

  it("hides the reminder and export without their capabilities, and the person link without support.read", async () => {
    const { el } = await mount("#/plans/roster", { caps: ["console.access", "plans.read"] });
    expect(buttons(el, "匯出這份名單")).toHaveLength(0);
    const row = el.querySelector(".adm-roster__row")!;
    await click(row.querySelector(".adm-roster__summary")!);
    expect(buttons(row, "關心提醒")).toHaveLength(0);
    expect(row.querySelector(".adm-link")).toBeNull();
    // 沒有 operations.manage：不顯示「新增計畫」
    expect(buttons(el, "新增計畫")).toHaveLength(0);
    expect([...el.querySelectorAll("a")].some((a) => a.textContent?.includes("新增計畫"))).toBe(false);
  });

  it("warns when the server's own count does not match the rows", async () => {
    const { el } = await mount("#/plans/roster", { meta: { inScope: 8, enrolled: 6 } });
    expect(el.textContent).toContain("人數對不上");
    expect(el.textContent).toContain("資料核對：7／8 人");
  });
});

describe("teams and quiz tabs", () => {
  it("teams: numbers from the summary, drilling into the roster with the same count", async () => {
    const { requests, el } = await mount("#/plans/teams");
    expect(actions(requests)).toEqual(["bootstrap", "plan_options", "plan_summary"]);
    await click([...el.querySelectorAll(".adm-tile")].find((tile) => tile.textContent?.startsWith("沒有隊")));
    expect(sentence(el)).toBe("報名者，且沒有隊 → 5 人");
  });

  it("quiz: shows what this plan has; a switched-off feature is one small line; nothing configured says so", async () => {
    const { el } = await mount("#/plans/quiz");
    expect(el.textContent).toContain("每日小測驗作答率");
    expect(el.textContent).toContain("11/11：4／5 人交卷（80%）");
    expect(el.textContent).not.toContain("大測驗・期末考");
    expect(el.textContent).toContain("大測驗：功能開放設定目前關閉");
    expect(el.textContent).not.toContain("雲柱測驗（本期期間）");
  });

  it("quiz: lightning counts this period's enrolled people and links to the content area", async () => {
    const quiz = { ...QUIZ, daily: { enabled: true, configured: false, participants: 0, days: [] }, exam: { enabled: true, papers: [] },
      lightning: { from: "2026-11-01", to: "2026-11-11", questions: 9, participants: 3, weeks: [{ week_start: "2026-11-02", questions: 7, participants: 3 }] } };
    const { el } = await mount("#/plans/quiz", { quiz });
    expect(el.textContent).not.toContain("每日小測驗作答率");
    expect(el.textContent).toContain("雲柱測驗（本期期間）");
    expect(el.textContent).toContain("報名者 6 人的 50%");
    expect(el.querySelector<HTMLAnchorElement>("a[href='#/content/lightning-quiz']")).not.toBeNull();
  });

  it("quiz: a failed load shows an error, never an empty page", async () => {
    const { el } = await mount("#/plans/quiz", { failures: { plan_quiz: 500 } });
    expect(el.querySelector(".adm-notice--danger")?.textContent).toContain("後台服務發生錯誤");
    expect(buttons(el, "重試")).toHaveLength(1);
  });
});
