// #566 後台隊伍除錯：除錯檢查、「會友 App 應該顯示」（和 App 同一份規則）、加入方式、異動歷程、跨階段推斷、
// admin-api 的五個動作與 migration。
// SQL（admin_api_team_*）已在 staging 以回滾交易驗過：77 隊的計畫一次拿齊、隊伍頁帶出下一階段的帶隊條件、
// 只有 service_role 能執行、內部函式連 service_role 都不能直接呼叫。
import { describe, expect, it, vi } from "vitest";
import {
  buildTeamDetail,
  buildTeamHistory,
  buildTeamLineage,
  buildTeamList,
  carryReasonText,
  joinMethod
} from "../supabase/functions/_shared/progress/team-report.mjs";
import { resolvePlanForReport } from "../supabase/functions/_shared/progress/plan-report.mjs";
import { getTeamOverallPlanProgress, isTeamFull } from "../js/modules/team-progress-metrics.mjs";
import { isCampaignStageEnded } from "../js/data/campaign-stage-kinds.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { AUDIT_ACTION_LABEL } from "../supabase/functions/admin-api/audit.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { migrationFiles, readMigration } from "./migration-sql.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_ID = "44444444-4444-4444-8444-444444444444";
const TEAM_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_CLIENT = "admin-spa-client";
const TODAY = "2026-11-11";

// 階段計畫：約翰福音 21 天，今天第 11 天
const STAGE_ROW = {
  id: PLAN_ID, name: "第2階段｜約翰福音", plan_kind: "church_campaign_stage", rules: { presetKey: "church_stage_02" }, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const ENDED_ROW = { ...STAGE_ROW, end_date: "2026-11-05" };
const resolved = (row = STAGE_ROW) => resolvePlanForReport(row);

const enrollment = (chapters, extra = {}) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {}, lastReadAt: chapters > 0 ? "2026-11-10T04:00:00Z" : null, readDays7: chapters > 0 ? 1 : 0, ...extra
});
const person = (id, name, enroll) => ({ id, name, greatRegion: "北區", pastoralZone: "北一", smallGroup: "A組", enrollment: enroll, teams: [], quiz: { published: 0, submitted: 0 } });
const member = (user_id, name, role = "member", extra = {}) => ({
  user_id, name, member_role: role, joined_at: "2026-11-01T02:00:00Z", division: 3, global_plan_id: PLAN_ID, is_active: true,
  great_region: "北區", pastoral_zone: "北一", small_group: "A組", joined_via: null, ...extra
});
const team = (extra = {}) => ({
  id: TEAM_ID, name: "晨光隊", global_plan_id: PLAN_ID, division: 3, status: "forming", captain_id: "u1", captain_name: "甲",
  carried_from_team_id: null, created_at: "2026-11-01T02:00:00Z", invite_code: "ABCDEF1234",
  members: [member("u1", "甲", "captain", { joined_via: ["create_reading_team"] }), member("u2", "乙", "member", { joined_via: ["join_reading_team_by_code"] })],
  elsewhere: [], events_after_end: 0, last_event_at: null, ...extra
});
const PEOPLE = [person("u1", "甲", enrollment(11)), person("u2", "乙", enrollment(4)), person("u3", "丙", enrollment(0))];
const detail = (teamRow = team(), { row = STAGE_ROW, people = PEOPLE, next = [] } = {}) =>
  buildTeamDetail({ resolved: resolved(row), data: { today: TODAY, team: teamRow, people, next_stages: next } });
const failing = (result) => result.checks.filter((check) => !check.ok).map((check) => check.id);

describe("team checks", () => {
  it("a healthy unfilled team passes every check; the after-end check only applies to an ended stage", () => {
    const result = detail();
    expect(failing(result)).toEqual([]);
    expect(result.checks.find((check) => check.id === "after_end").applicable).toBe(false);
    expect(result.issues).toBe(0);
  });

  it("flags a status stuck at 'ready' below capacity (the invite code still shows, by the App's rule)", () => {
    const result = detail(team({ status: "ready" }));
    expect(failing(result)).toEqual(["status"]);
    expect(result.checks[0].problems[0]).toBe("狀態是「已滿」，實際 2／3 人，應該是「招募中」");
    expect(result.app.inviteVisible).toBe(true);
    expect(result.app.inviteVisible).toBe(!isTeamFull(2, 3));
  });

  it("flags over capacity, a missing or doubled captain, and members not enrolled or deactivated", () => {
    const four = team({
      status: "ready",
      captain_id: "u9",
      captain_name: "不在隊上的人",
      members: [
        member("u1", "甲", "captain"), member("u2", "乙", "captain"),
        member("u3", "丙"), member("u4", "丁", "member", { is_active: false })
      ]
    });
    const result = detail(four);
    expect(failing(result)).toEqual(["capacity", "captain", "enrolled"]);
    const captain = result.checks.find((check) => check.id === "captain").problems;
    expect(captain).toContain("隊長（不在隊上的人）不在成員名單裡");
    expect(captain).toContain("有 2 位成員的角色是隊長：甲、乙");
    // 丙有報名（0 章也算報名）；丁的帳號停用了
    expect(result.checks.find((check) => check.id === "enrolled").problems).toEqual(["丁 的帳號已停用"]);
    const unenrolled = detail(team({ members: [...team().members, member("u7", "未報名的人")] }));
    expect(unenrolled.checks.find((check) => check.id === "enrolled").problems).toEqual(["未報名的人 沒有報名這個計畫"]);
  });

  it("someone in two teams of the same plan and division, and changes after an ended stage", () => {
    const result = detail(team({ elsewhere: [{ user_id: "u2", team_id: "t9", team_name: "南風隊" }], events_after_end: 2 }), { row: ENDED_ROW });
    expect(failing(result)).toEqual(["duplicate", "after_end"]);
    expect(result.checks.find((check) => check.id === "duplicate").problems).toEqual(["乙 同時在「南風隊」"]);
    expect(result.checks.find((check) => check.id === "after_end").problems).toEqual(["結束日（2026-11-05）之後有 2 筆異動"]);
    expect(result.plan).toMatchObject({ stage: true, ended: true });
    expect(isCampaignStageEnded(ENDED_ROW, TODAY)).toBe(true);
    expect(result.app.inviteNote).toContain("階段已結束");
  });
});

describe("what the member app should show", () => {
  it("team progress is the App's getTeamOverallPlanProgress over each member's current round", () => {
    const result = detail();
    expect(result.app.progress).toBe(getTeamOverallPlanProgress([{ currentRound: 1, chaptersRead: 11 }, { currentRound: 1, chaptersRead: 4 }], 21).averageProgress);
    expect(result.app.progress).toBe(36);
    expect(result.app.invite).toBe("看得到邀請碼（2／3 人，還缺 1 人）。");
    const full = detail(team({ status: "ready", members: [...team().members, member("u3", "丙")] }));
    expect(full.app.inviteVisible).toBe(false);
    expect(full.app.invite).toContain("團隊統計會固定以 3 人計算");
  });

  it("the carry button: shown with who would be skipped; hidden once carried, when the captain already has a team, or the next stage ended", () => {
    const nextPlan = { id: NEXT_ID, name: "第3階段｜使徒行傳", plan_kind: "church_campaign_stage", start_date: "2026-11-22", end_date: "2026-12-20" };
    const shown = detail(team(), { next: [{ plan: nextPlan, carried: null, captain_team: null, captain_block: null,
      member_blocks: [{ user_id: "u2", reason: "plan_requires_pastoral_zone", team_name: null }] }] }).app.carry;
    expect(shown.stages[0]).toMatchObject({ shown: true, skipped: [{ id: "u2", name: "乙", reason: "還沒設定牧區" }], warning: "" });
    expect(shown.stages[0].reason).toBe("隊長打開「第3階段｜使徒行傳」的組隊視窗時會看到「帶「晨光隊」加入」。");

    const blocked = detail(team(), { next: [{ plan: nextPlan, carried: null, captain_team: null, captain_block: "plan_audience_restricted", member_blocks: [] }] }).app.carry;
    expect(blocked.stages[0]).toMatchObject({ shown: true, warning: "但按下去整隊帶不過去：隊長大區不在那個階段的開放範圍。" });

    const carried = detail(team(), { next: [{ plan: nextPlan, carried: { id: "t2", name: "晨光隊" }, captain_team: { id: "t2", name: "晨光隊" }, captain_block: null, member_blocks: [] }] }).app.carry;
    expect(carried.stages[0]).toMatchObject({ shown: false, carriedTeam: { id: "t2", name: "晨光隊" }, reason: "已經帶進去了：「晨光隊」。" });

    const hasTeam = detail(team(), { next: [{ plan: nextPlan, carried: null, captain_team: { id: "t3", name: "別隊" }, captain_block: null, member_blocks: [] }] }).app.carry;
    expect(hasTeam.stages[0]).toMatchObject({ shown: false, reason: "隊長在「第3階段｜使徒行傳」已經有 3 人組的隊「別隊」。" });

    const ended = detail(team(), { next: [{ plan: { ...nextPlan, end_date: "2026-11-10" }, carried: null, captain_team: null, captain_block: null, member_blocks: [] }] }).app.carry;
    expect(ended.stages[0]).toMatchObject({ shown: false, reason: "下一階段已經結束。" });

    const noCaptain = detail(team({ captain_id: "u2" }), { next: [{ plan: nextPlan, carried: null, captain_team: null, captain_block: null, member_blocks: [] }] }).app.carry;
    expect(noCaptain.stages[0].shown).toBe(false);

    expect(detail().app.carry.message).toContain("還沒有以這個計畫為上一階段的階段計畫");
    expect(detail(team(), { row: { ...STAGE_ROW, plan_kind: "standard" } }).app.carry).toMatchObject({ applicable: false, stages: [] });
    expect(carryReasonText("already_in_target_team")).toBe("已在那個階段加入別隊");
  });

  it("members carry their join method and the same progress label as the roster", () => {
    const { members } = detail();
    expect(members.map((row) => [row.name, row.roleLabel, row.joinMethod.label, row.statusLabel])).toEqual([
      ["甲", "隊長", "建隊", "在進度上"],
      ["乙", "隊員", "邀請碼", "落後 7天"]
    ]);
    expect(joinMethod(null).key).toBe("unknown");
    expect(joinMethod([]).key).toBe("manual");
    expect(joinMethod(["carry_reading_teams_to_stage"]).label).toBe("帶隊帶入");
    expect(joinMethod(["some_admin_fn"]).label).toBe("其他（some_admin_fn）");
  });
});

describe("team list", () => {
  const list = buildTeamList({ resolved: resolved(), data: { today: TODAY, people: PEOPLE, teams: [
    team(),
    team({ id: "t-full", name: "滿隊", status: "ready", members: [...team().members, member("u3", "丙")] }),
    team({ id: "t-stuck", name: "卡住隊", status: "ready" })
  ] } });

  it("counts teams, unfilled and teams with issues", () => {
    expect(list.counts).toEqual({ teams: 3, unfilled: 2, issues: 1, members: 3 });
    // 滿隊：丙沒有讀（0 章）但有報名，所以沒事；卡住隊：狀態不對
    const byName = Object.fromEntries(list.teams.map((row) => [row.name, row]));
    expect(byName["卡住隊"]).toMatchObject({ issues: 1, issueLabels: ["狀態和實際人數一致"], missing: 1 });
    expect(byName["滿隊"]).toMatchObject({ issues: 0, missing: 0 });
  });
});

describe("history", () => {
  it("describes who did what in plain words, keeping the engineering details apart", () => {
    const history = buildTeamHistory({
      records_since: "2026-09-28T11:54:07Z",
      member_events: [
        { id: 3, at: "2026-11-03T00:00:00Z", event_type: "delete", user_id: "u3", user_name: "丙", member_role: "member", txid: 9, functions: ["remove_reading_team_member"], call_context: "PL/pgSQL function public.remove_reading_team_member(uuid,uuid,uuid) line 30" },
        { id: 2, at: "2026-11-02T00:00:00Z", event_type: "insert", user_id: "u2", user_name: "乙", member_role: "member", txid: 8, functions: ["join_reading_team_by_code"] },
        { id: 1, at: "2026-11-01T00:00:01Z", event_type: "insert", user_id: "u1", user_name: "甲", member_role: "captain", txid: 7, functions: ["create_reading_team"] }
      ],
      team_events: [
        { id: 5, at: "2026-11-04T00:00:00Z", event_type: "update", name_old: "晨光", name_new: "晨光隊", status_old: "forming", status_new: "forming", division_old: 3, division_new: 3, txid: 10, functions: ["rename_reading_team"] },
        { id: 4, at: "2026-11-01T00:00:00Z", event_type: "insert", name_new: "晨光", txid: 7, functions: ["create_reading_team"] }
      ]
    });
    expect(history.recordsSince).toBe("2026-09-28T11:54:07Z");
    expect(history.events.map((event) => [event.text, event.actor])).toEqual([
      ["隊名從「晨光」改成「晨光隊」", "隊長或管理員改名"],
      ["丙 被移出", "隊長或管理員（紀錄看不出是哪一位）"],
      ["乙 加入（邀請碼）", "本人用邀請碼"],
      ["甲（隊長） 加入（建隊）", "本人建立隊伍"],
      ["建立隊伍「晨光」", "隊長建立"]
    ]);
    expect(history.events[1].engineering).toMatchObject({ functions: ["remove_reading_team_member"], txid: 9 });
    expect(JSON.stringify(history)).not.toContain("jwt");
  });
});

describe("lineage", () => {
  it("lines the stages up and infers who was skipped when carrying", () => {
    const lineage = buildTeamLineage({
      team_id: "t2",
      plans: [
        { id: "p1", name: "第1階段", start_date: "2026-08-01", end_date: "2026-08-31", plan_kind: "church_campaign_stage" },
        { id: "p2", name: "第2階段", start_date: "2026-09-01", end_date: "2026-09-30", plan_kind: "church_campaign_stage" }
      ],
      names: { u1: "甲", u2: "乙", u3: "丙", u4: "丁" },
      teams: [
        { id: "t2", name: "晨光隊", global_plan_id: "p2", division: 3, carried_from_team_id: "t1", members: [{ user_id: "u1", member_role: "captain" }, { user_id: "u4", member_role: "member" }] },
        { id: "t1", name: "晨光隊", global_plan_id: "p1", division: 3, carried_from_team_id: null, members: [{ user_id: "u1", member_role: "captain" }, { user_id: "u2", member_role: "member" }, { user_id: "u3", member_role: "member" }] }
      ],
      elsewhere: [{ global_plan_id: "p2", division: 3, user_id: "u2", team_id: "t9", team_name: "南風隊" }]
    });
    expect(lineage.stages.map((stage) => [stage.plan.name, stage.current, stage.hasParent])).toEqual([["第1階段", false, false], ["第2階段", true, true]]);
    expect(lineage.stages[1].added).toEqual([{ id: "u4", name: "丁" }]);
    expect(lineage.stages[1].removed).toEqual([
      { id: "u2", name: "乙", elsewhere: { id: "t9", name: "南風隊" }, inferred: "推斷：帶隊時被略過——他在這一階段已經在「南風隊」" },
      { id: "u3", name: "丙", elsewhere: null, inferred: "推斷：帶隊時沒帶進來（例如沒設牧區），或之後被移出" }
    ]);
  });
});

// ── admin-api ──────────────────────────────────────────────────────────────
function setupAdmin({ info = { data: STAGE_ROW, error: null }, teamInfo, detailData, actorRole = "admin" } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: actorRole, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_plan_info") return info;
      if (fn === "admin_api_team_list") return { data: { today: TODAY, people: PEOPLE, teams: [team({ status: "ready" })] }, error: null };
      if (fn === "admin_api_team_info") return teamInfo || { data: { team_id: TEAM_ID, plan: STAGE_ROW }, error: null };
      if (fn === "admin_api_team_detail") return detailData || { data: { today: TODAY, team: team(), people: PEOPLE, next_stages: [] }, error: null };
      if (fn === "admin_api_team_history") return { data: { records_since: null, member_events: [], team_events: [] }, error: null };
      if (fn === "admin_api_team_lineage") return { data: { team_id: TEAM_ID, teams: [], plans: [], elsewhere: [], names: {} }, error: null };
      if (fn === "admin_api_team_search") return { data: [{ id: TEAM_ID, name: "晨光隊" }], error: null };
      return { data: null, error: { message: `unexpected ${fn}` } };
    }),
    log: () => {},
    randomId: () => "generated-request-id"
  };
  return { deps, calls };
}
const post = (body) => new Request("https://example.supabase.co/functions/v1/admin-api", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://bible-speed-reading-admin.vercel.app",
    Authorization: "Bearer token-abc",
    "x-request-id": "req-from-client-1"
  },
  body: JSON.stringify(body)
});
const json = async (response) => ({ status: response.status, body: await response.json() });
const sqlCalls = (calls) => calls.filter((call) => /^admin_api_(team_|plan_info)/.test(call.fn));

describe("admin-api team actions", () => {
  it("all need plans.read; every label is in the audit log's vocabulary", () => {
    for (const name of ["team_list", "team_detail", "team_history", "team_lineage", "team_search"]) {
      expect(ADMIN_ACTIONS[name].capabilities, name).toEqual(["plans.read"]);
      expect(AUDIT_ACTION_LABEL[name], name).toBeTruthy();
    }
    expect(AUDIT_ACTION_LABEL.view_team).toBe("查看隊伍");
    expect(AUDIT_ACTION_LABEL.view_plan_teams).toBe("打開隊伍清單");
  });

  it("team_list derives the preset key from the plan, and returns checked teams", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "team_list", params: { global_plan_id: PLAN_ID, p_preset_key: "forged" } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({ teams: 1, issues: 1 });
    expect(sqlCalls(calls)).toEqual([
      { fn: "admin_api_plan_info", args: { p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID } },
      { fn: "admin_api_team_list", args: { p_actor_id: ADMIN_ID, p_actor_role: "admin", p_global_plan_id: PLAN_ID, p_request_id: "req-from-client-1", p_preset_key: resolved().plan.presetKey } }
    ]);
  });

  it("team_detail looks up the team's plan first; a missing team is 404; bad ids never reach SQL", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "team_detail", params: { team_id: TEAM_ID } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.team).toMatchObject({ id: TEAM_ID, inviteCode: "ABCDEF1234", memberCount: 2 });
    expect(sqlCalls(calls).map((call) => call.fn)).toEqual(["admin_api_team_info", "admin_api_team_detail"]);
    expect(sqlCalls(calls)[1].args).toEqual({ p_actor_id: ADMIN_ID, p_actor_role: "admin", p_team_id: TEAM_ID, p_request_id: "req-from-client-1", p_preset_key: resolved().plan.presetKey });

    const missing = setupAdmin({ teamInfo: { data: null, error: null } });
    expect(await json(await handleAdminRequest(post({ action: "team_detail", params: { team_id: TEAM_ID } }), missing.deps)))
      .toMatchObject({ status: 404, body: { error: "team_not_found" } });

    for (const action of ["team_detail", "team_history", "team_lineage"]) {
      const bad = setupAdmin();
      expect((await handleAdminRequest(post({ action, params: { team_id: "nope" } }), bad.deps)).status, action).toBe(400);
      expect(sqlCalls(bad.calls), action).toEqual([]);
    }
  });

  it("SQL's role re-check becomes 403", async () => {
    const { deps } = setupAdmin({ teamInfo: { data: null, error: { code: "42501", message: "forbidden" } } });
    expect((await handleAdminRequest(post({ action: "team_detail", params: { team_id: TEAM_ID } }), deps)).status).toBe(403);
  });

  it("team_search uses the same query rule as user_search", async () => {
    const { deps, calls } = setupAdmin();
    expect(await json(await handleAdminRequest(post({ action: "team_search", params: { q: "  晨光 " } }), deps)))
      .toMatchObject({ status: 200, body: { data: [{ id: TEAM_ID }] } });
    expect(sqlCalls(calls)).toEqual([{ fn: "admin_api_team_search", args: { p_actor_id: ADMIN_ID, p_query: "晨光" } }]);
    const bad = setupAdmin();
    expect((await handleAdminRequest(post({ action: "team_search", params: { q: "a" } }), bad.deps)).status).toBe(400);
    expect(sqlCalls(bad.calls)).toEqual([]);
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_team_debug.sql"));
  const sql = readMigration(file);
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  const body = (fn) => {
    const start = sql.indexOf(`FUNCTION public.${fn}(`);
    return sql.slice(start, sql.indexOf("$function$;", start));
  };

  it("grants the six actions to service_role only; the helpers to nobody", () => {
    const helpers = ["_admin_api_context_functions", "_admin_api_team_rows", "_admin_api_plan_row"];
    const actions = ["admin_api_team_list", "admin_api_team_info", "admin_api_team_detail", "admin_api_team_history", "admin_api_team_lineage", "admin_api_team_search"];
    expect(fns).toEqual([...helpers, ...actions]);
    for (const fn of actions) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
      expect(body(fn), fn).toContain("PERFORM public.admin_api_assert_admin(p_actor_id);");
    }
    for (const fn of helpers) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
      expect(sql, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`));
    }
  });

  it("audits opening the list and a team; never returns jwt_claims; only reads", () => {
    expect(body("admin_api_team_list")).toContain("audit.record('admin-api', 'view_plan_teams'");
    expect(body("admin_api_team_detail")).toContain("audit.record('admin-api', 'view_team'");
    const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(code).not.toContain("jwt_claims");
    expect(code).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM) public\./);
  });
});
