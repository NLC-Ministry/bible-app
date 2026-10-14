// @vitest-environment jsdom
// 後台隊伍除錯（#566）：請求預算（團隊分頁 1 個 team_list、隊伍頁只有 team_detail、歷程與跨階段點開才載）、
// 篩選不發請求、卡住「已滿」的隊被標紅、搜尋找得到隊伍、個人頁的團隊異動連到隊伍頁、路由。
// 回應用伺服器同一份規則（_shared/progress/team-report.mjs）產生。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { createAdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { describeItem } from "../src/items.ts";
import { formatRoute, parseRoute } from "../src/route.ts";
import { filterTeams, teamRowNote, type TeamListRow } from "../src/teams.ts";
import { buildPlanSummary, preparePlanReport, resolvePlanForReport } from "../../supabase/functions/_shared/progress/plan-report.mjs";
import { buildTeamDetail, buildTeamHistory, buildTeamLineage, buildTeamList } from "../../supabase/functions/_shared/progress/team-report.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = "22222222-2222-4222-8222-222222222222";
const PREV_PLAN = "33333333-3333-4333-8333-333333333333";
const TEAM_OK = "55555555-5555-4555-8555-555555555555";
const TEAM_STUCK = "66666666-6666-4666-8666-666666666666";
const TEAM_PREV = "77777777-7777-4777-8777-777777777777";
const TODAY = "2026-11-11";
const PLAN_ROW = {
  id: PLAN, name: "第2階段｜約翰福音", plan_kind: "church_campaign_stage", rules: { presetKey: "church_stage_02" }, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const resolved = () => resolvePlanForReport(PLAN_ROW);

const enrollment = (chapters: number) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {}, lastReadAt: chapters > 0 ? "2026-11-10T04:00:00Z" : null, readDays7: chapters > 0 ? 1 : 0
});
const person = (id: string, name: string, chapters: number) => ({
  id, name, greatRegion: "北區", pastoralZone: "北一", smallGroup: "A組", enrollment: enrollment(chapters), teams: [], quiz: { published: 0, submitted: 0 }
});
const PEOPLE = [person("u1", "甲", 11), person("u2", "乙", 4), person("u3", "丙", 9), person("u4", "丁", 2), person("u5", "戊", 6)];
const member = (user_id: string, name: string, role = "member", joined_via: string[] | null = null) => ({
  user_id, name, member_role: role, joined_at: "2026-11-01T02:00:00Z", division: 3, global_plan_id: PLAN, is_active: true,
  great_region: "北區", pastoral_zone: "北一", small_group: "A組", joined_via
});
const teamRow = (id: string, name: string, status: string, members: ReturnType<typeof member>[], extra: Record<string, unknown> = {}) => ({
  id, name, global_plan_id: PLAN, division: 3, status, captain_id: members[0].user_id, captain_name: members[0].name,
  carried_from_team_id: null, created_at: "2026-11-01T02:00:00Z", invite_code: "ABCDEF1234",
  members, elsewhere: [], events_after_end: 0, last_event_at: null, ...extra
});
// 晨光隊正常（招募中 2／3）；南風隊 2／3 人卻卡在「已滿」——會友看得到邀請碼，但狀態不對
const OK = teamRow(TEAM_OK, "晨光隊", "forming", [member("u1", "甲", "captain", ["create_reading_team"]), member("u2", "乙", "member", ["join_reading_team_by_code"])]);
const STUCK = teamRow(TEAM_STUCK, "南風隊", "ready", [member("u3", "丙", "captain", ["carry_reading_teams_to_stage"]), member("u4", "丁")], { carried_from_team_id: TEAM_PREV });

const TEAM_LIST = buildTeamList({ resolved: resolved(), data: { today: TODAY, teams: [OK, STUCK], people: PEOPLE } });
const detailOf = (row: typeof OK) => buildTeamDetail({ resolved: resolved(), data: { today: TODAY, team: row, people: PEOPLE, next_stages: [] } });
const HISTORY = buildTeamHistory({
  records_since: "2026-09-28T11:54:07Z",
  member_events: [{ id: 1, at: "2026-11-02T00:00:00Z", event_type: "insert", user_id: "u4", user_name: "丁", member_role: "member", txid: 8, functions: [], call_context: "SQL statement" }],
  team_events: []
});
const LINEAGE = buildTeamLineage({
  team_id: TEAM_STUCK,
  plans: [
    { id: PREV_PLAN, name: "第1階段", start_date: "2026-08-01", end_date: "2026-08-31", plan_kind: "church_campaign_stage" },
    { id: PLAN, name: PLAN_ROW.name, start_date: "2026-11-01", end_date: "2026-11-21", plan_kind: "church_campaign_stage" }
  ],
  names: { u3: "丙", u4: "丁", u5: "戊" },
  teams: [
    { id: TEAM_STUCK, name: "南風隊", global_plan_id: PLAN, division: 3, carried_from_team_id: TEAM_PREV, members: [{ user_id: "u3", member_role: "captain" }, { user_id: "u4", member_role: "member" }] },
    { id: TEAM_PREV, name: "南風隊", global_plan_id: PREV_PLAN, division: 3, carried_from_team_id: null, members: [{ user_id: "u3", member_role: "captain" }, { user_id: "u4", member_role: "member" }, { user_id: "u5", member_role: "member" }] }
  ],
  elsewhere: []
});
const SUMMARY = buildPlanSummary(preparePlanReport({ resolved: resolved(), overview: { today: TODAY, people: PEOPLE, meta: { inScope: 5, enrolled: 5 } } }));

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

const CAPS = ["console.access", "support.read", "plans.read", "operations.manage"];

async function mount(initialHash: string, caps = CAPS) {
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
      case "plan_options":
        data = { plans: [{ id: PLAN, name: PLAN_ROW.name, plan_kind: PLAN_ROW.plan_kind, start_date: PLAN_ROW.start_date, end_date: PLAN_ROW.end_date }], default_plan_id: PLAN };
        break;
      case "plan_summary": data = SUMMARY; break;
      case "team_list": data = TEAM_LIST; break;
      case "team_detail": data = detailOf(params.team_id === TEAM_STUCK ? STUCK : OK); break;
      case "team_history": data = HISTORY; break;
      case "team_lineage": data = LINEAGE; break;
      case "directory_list": data = { items: [], total: 0, next_cursor: null, plan_id: null, plans: [], all_count: 0 }; break;
      case "team_search":
        data = [{ id: TEAM_STUCK, name: "南風隊", division: 3, status: "ready", member_count: 2, captain_name: "丙", matched_code: true,
          plan: { id: PLAN, name: PLAN_ROW.name, plan_kind: PLAN_ROW.plan_kind, start_date: PLAN_ROW.start_date, end_date: PLAN_ROW.end_date } }];
        break;
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
const button = (el: Element, label: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  await flush();
};
const teamNames = (el: Element) => [...el.querySelectorAll(".adm-team-row__name")].map((node) => node.firstChild?.textContent);

describe("team list", () => {
  it("the teams tab loads one team_list; filtering and searching cost nothing; stuck teams come first", async () => {
    const { requests, el } = await mount("#/plans/teams");
    expect(actions(requests)).toEqual(["bootstrap", "plan_options", "plan_summary", "team_list"]);
    expect(requests[3].params).toEqual({ global_plan_id: PLAN });
    expect(teamNames(el)).toEqual(["南風隊", "晨光隊"]);
    const tiles = [...el.querySelectorAll(".adm-tile")].map((tile) => tile.textContent);
    expect(tiles).toContain("有異常1除錯檢查沒過");
    expect(el.querySelector(".adm-team-row__issues")?.textContent).toBe("狀態和實際人數一致沒過");

    await click([...el.querySelectorAll(".adm-segmented__option")].find((b) => b.textContent === "有異常"));
    expect(teamNames(el)).toEqual(["南風隊"]);
    await click([...el.querySelectorAll(".adm-segmented__option")].find((b) => b.textContent === "全部"));
    const search = el.querySelector<HTMLInputElement>("#adm-team-search")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "甲");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(teamNames(el)).toEqual(["晨光隊"]);
    expect(requests).toHaveLength(4);
    expect(el.querySelector(".adm-team-row")?.getAttribute("href")).toBe(`#/plans/teams/${TEAM_OK}?plan=${PLAN}`);
  });
});

describe("team page", () => {
  it("opening a team costs only team_detail; the stuck status is flagged red with its impact and fix", async () => {
    const { requests, el } = await mount("#/plans/teams");
    await go(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`);
    expect(actions(requests).slice(4)).toEqual(["team_detail"]);
    expect(requests[4].params).toEqual({ team_id: TEAM_STUCK });
    const bad = [...el.querySelectorAll(".adm-team-check--bad")];
    expect(bad).toHaveLength(1);
    expect(bad[0].textContent).toContain("狀態是「已滿」，實際 2／3 人，應該是「招募中」");
    expect(bad[0].textContent).toContain("影響：");
    expect(bad[0].textContent).toContain("怎麼修：");
    expect(el.textContent).toContain("1 項異常");
    expect(el.textContent).toContain("會友 App 應該顯示");
    // 成員連到個人頁、加入方式寫白話
    const members = [...el.querySelectorAll(".adm-team-member")];
    expect(members.map((row) => row.querySelector(".adm-team-member__name a")?.textContent)).toEqual(["丙", "丁"]);
    expect(members[0].textContent).toContain("帶隊帶入");
    // 從上一階段帶來 → 連到那一隊
    expect([...el.querySelectorAll("a")].some((a) => a.getAttribute("href") === `#/plans/teams/${TEAM_PREV}`)).toBe(true);
    expect(el.textContent).not.toContain("jwt");
  });

  it("history and lineage load only when opened, once each (cached on reopen)", async () => {
    const { requests, el } = await mount(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`);
    // 直接打開隊伍頁：不載計畫選單與總覽
    expect(actions(requests)).toEqual(["bootstrap", "team_detail"]);

    await click(button(el, "異動歷程"));
    expect(actions(requests).slice(2)).toEqual(["team_history"]);
    expect(el.textContent).toContain("丁 加入");
    expect(el.textContent).toContain("之前的加入、移出沒有紀錄");
    expect(el.querySelector(".adm-pre")).toBeNull();
    await click(button(el, "顯示工程細節"));
    expect(el.querySelector(".adm-pre")?.textContent).toBe("SQL statement");

    await click(button(el, "跨階段對應"));
    expect(actions(requests).slice(3)).toEqual(["team_lineage"]);
    const removed = el.querySelector(".adm-team-lineage__removed")?.textContent || "";
    expect(removed).toContain("少了 戊");
    expect(removed).toContain("推斷");

    await click(button(el, "異動歷程"));
    await click(button(el, "異動歷程"));
    expect(requests).toHaveLength(4);
  });
});

describe("finding a team", () => {
  const typeQuery = async (el: HTMLElement, value: string) => {
    const input = el.querySelector<HTMLInputElement>("#adm-directory-q")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush(350);
    await flush();
  };

  it("the people search also finds teams (with plans.read), linking to the team page with its plan (#567)", async () => {
    const { requests, el } = await mount("#/people", [...CAPS, "accounts.read"]);
    expect(el.querySelector<HTMLInputElement>("#adm-directory-q")!.placeholder).toContain("邀請碼");
    await typeQuery(el, "ABCDEF1234");
    expect(actions(requests).slice(2).sort()).toEqual(["directory_list", "team_search"]);
    expect(requests.find((r) => r.action === "team_search")!.params).toEqual({ q: "ABCDEF1234" });
    const link = [...el.querySelectorAll<HTMLAnchorElement>(".adm-team-matches .adm-result")].find((a) => a.textContent?.includes("南風隊"));
    expect(link?.getAttribute("href")).toBe(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`);
    expect(link?.textContent).toContain("邀請碼相符");
    expect(link?.textContent).toContain(PLAN_ROW.name);

    // 改別的條件、搜尋字沒變：不重找隊伍
    const before = requests.length;
    await act(async () => { el.querySelector<HTMLInputElement>(".adm-filters__footer input[type=checkbox]")!.click(); });
    await flush();
    expect(actions(requests).slice(before)).toEqual(["directory_list"]);
    // 太短的字不找隊伍
    await typeQuery(el, "a");
    expect(actions(requests).slice(before + 1)).toEqual(["directory_list"]);
    expect(el.querySelector(".adm-team-matches")).toBeNull();
  });

  it("without plans.read the search stays people-only", async () => {
    const { requests, el } = await mount("#/people", ["console.access", "support.read", "accounts.read"]);
    await typeQuery(el, "南風");
    expect(actions(requests).slice(1)).toEqual(["directory_list", "directory_list"]);
  });

  it("a team event on the personal page links to the team page only with plans.read and a living team", () => {
    const item = { section: "team_events" as const, id: "e1", at: "2026-11-02T00:00:00Z", event_type: "insert", team_id: TEAM_OK, team_name: "晨光隊", global_plan_id: PLAN, plan_name: PLAN_ROW.name };
    expect(describeItem(item, { teamLinks: true }).href).toBe(`#/plans/teams/${TEAM_OK}?plan=${PLAN}`);
    expect(describeItem(item).href).toBeUndefined();
    expect(describeItem({ ...item, team_name: null }, { teamLinks: true }).href).toBeUndefined();
  });
});

describe("route and list rules", () => {
  it("parses and formats the team page route", () => {
    expect(parseRoute(`#/plans/teams/${TEAM_OK.toUpperCase()}?plan=${PLAN}`)).toEqual({ view: "plans", tab: "teams", planId: PLAN, teamId: TEAM_OK });
    expect(formatRoute({ view: "plans", tab: "teams", planId: null, teamId: TEAM_OK })).toBe(`#/plans/teams/${TEAM_OK}`);
    expect(parseRoute("#/plans/teams/not-a-uuid")).toEqual({ view: "not_found" });
  });

  it("filters unfilled / issues, issues first, then division and name", () => {
    const row = (id: string, name: string, extra: Partial<TeamListRow>): TeamListRow => ({
      id, name, division: 3, status: "forming", statusLabel: "招募中", memberCount: 3, missing: 0, captainName: "甲",
      carried: false, issues: 0, issueLabels: [], ...extra
    });
    const rows = [row("a", "乙隊", {}), row("b", "甲隊", { missing: 1 }), row("c", "丙隊", { issues: 2, division: 5 }), row("d", "丁隊", { division: 2, missing: 1 })];
    expect(filterTeams(rows, "all").map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
    expect(filterTeams(rows, "unfilled").map((r) => r.id)).toEqual(["d", "b"]);
    expect(filterTeams(rows, "issues").map((r) => r.id)).toEqual(["c"]);
    expect(teamRowNote(rows[2])).toBe("2 項異常");
    expect(teamRowNote(rows[1])).toBe("還缺 1 人");
    expect(teamRowNote(rows[0])).toBe("已滿");
  });
});
