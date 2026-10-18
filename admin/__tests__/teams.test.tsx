// @vitest-environment jsdom
// 後台隊伍除錯（#566）：請求預算（團隊分頁 1 個 team_list、隊伍頁只有 team_detail、歷程與跨階段點開才載）、
// 篩選不發請求、卡住「已滿」的隊被標紅、搜尋找得到隊伍、個人頁的團隊異動連到隊伍頁、路由；
// 修正動作（#571）：要 teams.write、再確認一次才送、已結束的階段不給按、隊長只剩自己＝解散、加人被擋寫出是哪一隊。
// 回應用伺服器同一份規則（_shared/progress/team-report.mjs）產生。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { AdminApiError, createAdminApi, describeAdminError } from "../src/api.ts";
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
const TEAM_SOLO = "88888888-8888-4888-8888-888888888888";
const TEAM_ENDED = "99999999-9999-4999-8999-999999999999";
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
const SOLO = teamRow(TEAM_SOLO, "戊的個人隊", "forming", [member("u5", "戊", "captain", ["create_reading_team"])]);
const detailOf = (row: typeof OK, plan = PLAN_ROW) => buildTeamDetail({ resolved: resolvePlanForReport(plan), data: { today: TODAY, team: row, people: PEOPLE, next_stages: [] } });
const ENDED_PLAN = { ...PLAN_ROW, end_date: "2026-11-05" };
const DETAILS: Record<string, () => unknown> = {
  [TEAM_OK]: () => detailOf(OK),
  [TEAM_STUCK]: () => detailOf(STUCK),
  [TEAM_SOLO]: () => detailOf(SOLO),
  [TEAM_ENDED]: () => detailOf({ ...STUCK, id: TEAM_ENDED }, ENDED_PLAN)
};
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

type Responder = (params: any) => unknown;
async function mount(initialHash: string, caps = CAPS, responses: Record<string, Responder> = {}) {
  window.location.hash = initialHash;
  const requests: { action: string; params: any }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action, params } = JSON.parse(String(init.body));
    requests.push({ action, params });
    let data: unknown = null;
    if (responses[action]) return new Response(JSON.stringify({ data: responses[action](params), request_id: "srv" }), { status: 200 });
    switch (action) {
      case "bootstrap":
        data = { me: { id: "admin-1", name: "王管理", email: null, role_code: "admin", role_label: "系統管理員" }, feature_settings: [], org: [], capabilities: caps };
        break;
      case "plan_options":
        data = { plans: [{ id: PLAN, name: PLAN_ROW.name, plan_kind: PLAN_ROW.plan_kind, start_date: PLAN_ROW.start_date, end_date: PLAN_ROW.end_date }], default_plan_id: PLAN };
        break;
      case "plan_summary": data = SUMMARY; break;
      case "team_list": data = TEAM_LIST; break;
      case "team_detail": data = (DETAILS[params.team_id] || DETAILS[TEAM_OK])(); break;
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

describe("team fixes (#571)", () => {
  const FIX_CAPS = [...CAPS, "teams.write"];
  const setInput = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const confirmBox = (el: Element) => el.querySelector<HTMLElement>(".adm-team-fix")!;

  it("without teams.write the team page stays read-only", async () => {
    const { el } = await mount(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`);
    expect(button(el, "重算狀態")).toBeUndefined();
    expect(button(el, "移出")).toBeUndefined();
    expect(button(el, "加人")).toBeUndefined();
  });

  it("重算狀態 shows on the failed status check, asks once more, sends the reason and reloads the team", async () => {
    const { requests, el } = await mount(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`, FIX_CAPS, {
      team_recompute_status: () => ({ team_id: TEAM_STUCK, member_count: 2, status_before: "ready", status: "forming", changed: true })
    });
    await click(el.querySelector(".adm-team-check--bad")!.querySelector("button"));
    expect(actions(requests)).toEqual(["bootstrap", "team_detail"]);
    expect(confirmBox(el).textContent).toContain("把狀態改成「招募中」");
    await setInput(confirmBox(el).querySelector("input")!, " 舊資料 ");
    await click([...confirmBox(el).querySelectorAll("button")].find((b) => b.textContent === "重算狀態"));
    expect(actions(requests).slice(2)).toEqual(["team_recompute_status", "team_detail"]);
    expect(requests[2].params).toEqual({ team_id: TEAM_STUCK, reason: "舊資料" });
    expect(el.querySelector(".adm-team-fix__done")?.textContent).toBe("狀態已從「已滿」改成「招募中」。");
  });

  it("移出: members get a button, the captain with others does not; cancel sends nothing", async () => {
    const { requests, el } = await mount(`#/plans/teams/${TEAM_OK}?plan=${PLAN}`, FIX_CAPS, {
      team_remove_member: (params) => ({ team_id: TEAM_OK, global_plan_id: PLAN, removed_user_id: params.user_id, dissolved: false, member_count: 1, status: "forming" })
    });
    const rows = [...el.querySelectorAll(".adm-team-member")];
    expect(rows[0].textContent).toContain("隊上還有其他人，不能移出隊長");
    expect(rows[0].querySelector("button")).toBeNull();
    await click(rows[1].querySelector("button"));
    expect(confirmBox(el).textContent).toContain("把「乙」移出「晨光隊」（剩 1／3 人）");
    await click(button(confirmBox(el), "取消"));
    expect(el.querySelector(".adm-team-fix")).toBeNull();
    expect(actions(requests)).toEqual(["bootstrap", "team_detail"]);

    await click(el.querySelectorAll(".adm-team-member")[1].querySelector("button"));
    await click([...confirmBox(el).querySelectorAll("button")].find((b) => b.textContent === "移出"));
    expect(actions(requests).slice(2)).toEqual(["team_remove_member", "team_detail"]);
    expect(requests[2].params).toEqual({ team_id: TEAM_OK, user_id: "u2" });
    expect(el.querySelector(".adm-team-fix__done")?.textContent).toBe("已把「乙」移出這隊。");
  });

  it("the captain alone can be removed, which dissolves the team and goes back to the list", async () => {
    const { requests, el } = await mount(`#/plans/teams/${TEAM_SOLO}?plan=${PLAN}`, FIX_CAPS, {
      team_remove_member: () => ({ team_id: TEAM_SOLO, global_plan_id: PLAN, removed_user_id: "u5", dissolved: true, member_count: 0, status: null })
    });
    await click(button(el, "移出（解散）"));
    expect(confirmBox(el).textContent).toContain("移出＝解散「戊的個人隊」");
    await click(button(confirmBox(el), "移出並解散"));
    expect(requests.find((r) => r.action === "team_remove_member")!.params).toEqual({ team_id: TEAM_SOLO, user_id: "u5" });
    expect(window.location.hash).toBe(`#/plans/teams?plan=${PLAN}`);
  });

  it("加人: search, pick, confirm; someone already in another team is blocked with that team's name and link", async () => {
    const { requests, el } = await mount(`#/plans/teams/${TEAM_OK}?plan=${PLAN}`, FIX_CAPS, {
      user_search: () => [
        { id: "u1", name: "甲", email_masked: null, great_region: "北區", pastoral_zone: "北一", small_group: "A組", is_active: true },
        { id: "u3", name: "丙", email_masked: "c***@x.com", great_region: "北區", pastoral_zone: "北一", small_group: "A組", is_active: true }
      ],
      team_add_member: () => ({ added: false, blocked: "already_in_other_team", other_team: { id: TEAM_STUCK, name: "南風隊" } })
    });
    await click(button(el, "加人"));
    await setInput(el.querySelector<HTMLInputElement>(".adm-team-add input")!, "北");
    await click(button(el.querySelector(".adm-team-add")!, "搜尋"));
    expect(requests.find((r) => r.action === "user_search")!.params).toEqual({ q: "北" });
    const hits = [...el.querySelectorAll(".adm-team-add__hit")];
    expect(hits[0].textContent).toContain("已在這隊");
    expect(hits[0].querySelector("button")!.disabled).toBe(true);
    await click(hits[1].querySelector("button"));
    expect(confirmBox(el).textContent).toContain("把「丙」以隊員身分加進「晨光隊」（3／3 人）");
    await click(button(confirmBox(el), "加進這隊"));
    expect(requests.find((r) => r.action === "team_add_member")!.params).toEqual({ team_id: TEAM_OK, user_id: "u3" });
    const notice = el.querySelector(".adm-team-fix__done")!;
    expect(notice.textContent).toContain("「丙」已在同計畫同組別的「南風隊」，沒有加入");
    expect(notice.querySelector("a")!.getAttribute("href")).toBe(`#/plans/teams/${TEAM_STUCK}?plan=${PLAN}`);
    // 被擋下沒有改到資料：不重載隊伍頁
    expect(actions(requests).filter((action) => action === "team_detail")).toHaveLength(1);
  });

  it("server refusals read in plain words", () => {
    const say = (code: string) => describeAdminError(new AdminApiError(400, code, "req"));
    expect(say("team_stage_ended")).toContain("階段已經結束");
    expect(say("team_captain_has_members")).toBe("隊上還有其他人，不能移出隊長。");
    expect(say("user_not_enrolled")).toContain("還沒報名這個計畫");
    expect(say("reading_team_full")).toBe("這隊已經滿了，不能再加人。");
    expect(say("user_inactive")).toContain("帳號已停用");
  });

  it("an ended stage shows why nothing can be changed and offers no buttons", async () => {
    const { el } = await mount(`#/plans/teams/${TEAM_ENDED}?plan=${PLAN}`, FIX_CAPS);
    expect(el.textContent).toContain("階段已結束，名單不能修改");
    expect(button(el, "重算狀態")).toBeUndefined();
    expect(button(el, "移出")).toBeUndefined();
    expect(button(el, "加人")).toBeUndefined();
  });
});
