// #564 計畫總覽／名單：伺服器執行和會友 App 同一份規則（_shared/progress），這裡守住
//   · 對帳：漏斗每一層＝對應分格的人數、兩個條件各自加總＝範圍內人數、需要關心合計一致、meta 對不上就標出來；
//   · 後台 admin-api：SQL 重查角色（42501 → 403）、計畫不存在 404、preset key 由伺服器推、只有名單記稽核；
//   · 組長版 nlc-data：範圍只看 getVisibleProfileIds，前端傳的一律不看。
// SQL（plan_progress_people、admin_api_plan_*）已在 staging 以回滾交易驗過：包裝前後輸出相同、meta 與名單人數一致、
// 會友呼叫被擋、名單記一筆稽核。
import { describe, expect, it, vi } from "vitest";
import {
  CHECKIN_BUCKETS,
  PROGRESS_BUCKETS,
  buildPlanRoster,
  buildPlanSummary,
  parseScopeFilter,
  preparePlanReport,
  resolvePlanForReport
} from "../supabase/functions/_shared/progress/plan-report.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { PLAN_REPORT_ACTIONS, PLAN_REPORT_PLAN_COLUMNS, runPlanReport } from "../supabase/functions/nlc-data/plan-report.ts";
import { readFileSync } from "node:fs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CLIENT = "admin-spa-client";

// 約翰福音 21 章、21 天，一天一章；今天是第 11 天（應讀 11 天）
const PLAN_ROW = {
  id: PLAN_ID, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const TODAY = "2026-11-11";
const at = (day) => `${day}T04:00:00Z`; // 台北 12:00
const enrollment = (chapters, lastReadDay, extra = {}) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {},
  lastReadAt: lastReadDay ? at(lastReadDay) : null, readDays7: lastReadDay ? 1 : 0, ...extra
});
const person = (id, name, unit, enroll) => ({
  id, name, greatRegion: unit[0], pastoralZone: unit[1], smallGroup: unit[2], enrollment: enroll, teams: [], quiz: {}
});
const NORTH = ["北區", "北一", "A組"];
const SOUTH = ["南區", "南一", "B組"];
const PEOPLE = [
  person("p1", "甲", NORTH, enrollment(11, "2026-11-11")),               // 跟上、今天
  person("p2", "乙", NORTH, enrollment(10, "2026-11-10")),               // 只差 1 天＝今日未完成，算跟上；1 天前
  person("p3", "丙", NORTH, enrollment(8, "2026-11-07")),                // 落後 3 天；4 天沒打卡 → 關心
  person("p4", "丁", SOUTH, enrollment(2, "2026-11-02")),                // 落後 9 天、9 天沒打卡 → 關心（兩個原因）
  person("p5", "戊", SOUTH, enrollment(0, null)),                         // 報名沒讀 → 落後 11 天＋還沒開始讀
  person("p6", "己", SOUTH, enrollment(24, "2026-11-11", {               // 第二遍＝讀完一遍
    round: 2, maxRound: 2, upgradeHandled: true, byRound: { 1: 21, 2: 3 }
  })),
  person("p7", "庚", SOUTH, null)                                         // 未報名
];
const overview = (people = PEOPLE, meta) => ({
  today: TODAY,
  people,
  meta: meta || { inScope: people.length, enrolled: people.filter((row) => row.enrollment).length }
});
const report = (people, meta) => preparePlanReport({ resolved: resolvePlanForReport(PLAN_ROW), overview: overview(people, meta) });
const sum = (counts) => Object.values(counts).reduce((total, value) => total + value, 0);

describe("plan summary reconciles", () => {
  const summary = buildPlanSummary(report());

  it("each person lands in exactly one progress bucket and one check-in bucket", () => {
    expect(summary.buckets.progress).toEqual({ on_track: 2, completed: 1, behind: 1, behind_long: 2, not_enrolled: 1 });
    expect(summary.buckets.checkin).toEqual({ today: 2, recent: 1, lapsed: 1, dormant: 1, none: 2 });
    expect(sum(summary.buckets.progress)).toBe(summary.funnel.inScope);
    expect(sum(summary.buckets.checkin)).toBe(summary.funnel.inScope);
    expect(Object.keys(summary.buckets.progress)).toEqual(PROGRESS_BUCKETS.map((bucket) => bucket.id));
    expect(Object.keys(summary.buckets.checkin)).toEqual(CHECKIN_BUCKETS.map((bucket) => bucket.id));
  });

  it("funnel layers equal the matching bucket counts", () => {
    const { funnel, buckets, care } = summary;
    expect(funnel).toMatchObject({ inScope: 7, enrolled: 6, onTrack: 3, completedOnce: 1, care: 3 });
    expect(funnel.enrolled).toBe(funnel.inScope - buckets.progress.not_enrolled);
    expect(funnel.onTrack).toBe(buckets.progress.on_track + buckets.progress.completed);
    expect(funnel.completedOnce).toBe(buckets.progress.completed);
    // 關心的「落後」門檻和「落後 7 天以上」那一格相同
    expect(care.behind).toBe(buckets.progress.behind_long);
    expect(care).toEqual({ behind: 2, noCheckin: 2, neverRead: 1, total: 3 });
    expect(care.total).toBe(funnel.care);
  });

  it("units add up to the scope, and narrowing the scope only ever shrinks it", () => {
    expect(summary.units.level).toBe("greatRegion");
    for (const key of ["inScope", "enrolled", "onTrack", "completedOnce", "care"]) {
      expect(summary.units.rows.reduce((total, row) => total + row[key], 0), key).toBe(summary.funnel[key]);
    }
    const north = buildPlanSummary(report(), { greatRegion: "北區" });
    expect(north.scope.greatRegion).toBe("北區");
    expect(north.funnel.inScope).toBe(3);
    expect(sum(north.buckets.progress)).toBe(3);
    // 不存在的單位不會變成「全部」
    const unknown = buildPlanSummary(report(), { greatRegion: "不存在" });
    expect(unknown.funnel.inScope).toBeLessThanOrEqual(summary.funnel.inScope);
  });

  it("states today's reading from the church schedule", () => {
    expect(summary.today).toBe(TODAY);
    expect(summary.schedule).toMatchObject({ totalDays: 21, totalChapters: 21, dayNumber: 11, started: true, ended: false, expectedDays: 11 });
    expect(summary.schedule.today).toEqual([{ book: "約翰福音", from: 11, to: 11 }]);
  });

  it("carries no names", () => {
    const text = JSON.stringify(summary);
    for (const row of PEOPLE) expect(text).not.toContain(`"${row.name}"`);
  });

  it("flags a mismatch between the SQL count and the rows", () => {
    expect(summary.meta).toEqual({ inScope: 7, enrolled: 6, rows: 7, rowsEnrolled: 6, consistent: true });
    expect(buildPlanSummary(report(PEOPLE, { inScope: 8, enrolled: 6 })).meta.consistent).toBe(false);
    expect(buildPlanSummary(report(PEOPLE, { inScope: 7, enrolled: 5 })).meta.consistent).toBe(false);
    expect(buildPlanSummary(report(PEOPLE, {})).meta.consistent).toBe(false);
  });

  it("a leader's subset never counts more than the whole church", () => {
    const subset = buildPlanSummary(report(PEOPLE.filter((row) => row.greatRegion === "南區")));
    for (const key of ["inScope", "enrolled", "onTrack", "completedOnce", "care"]) {
      expect(subset.funnel[key], key).toBeLessThanOrEqual(summary.funnel[key]);
    }
    expect(subset.meta.consistent).toBe(true);
  });
});

describe("plan roster", () => {
  const roster = buildPlanRoster(report());

  it("one row per person, most behind first, no email", () => {
    // 只差 1 天（p2）也排在前面，但不算落後那一格
    expect(roster.people.slice(0, 4).map((row) => [row.id, row.behindDays])).toEqual([["p5", 11], ["p4", 9], ["p3", 3], ["p2", 1]]);
    expect(roster.people.slice(4).map((row) => row.behindDays)).toEqual([0, 0, 0]);
    expect(roster.people).toHaveLength(7);
    expect(JSON.stringify(roster)).not.toMatch(/email/i);
    expect(roster.meta.consistent).toBe(true);
  });

  it("rows carry both dimensions and the care reasons the summary counted", () => {
    const byId = Object.fromEntries(roster.people.map((row) => [row.id, row]));
    expect(byId.p2).toMatchObject({ status: "today_pending", progressBucket: "on_track", checkinBucket: "recent", care: false });
    expect(byId.p4.careReasons.map((reason) => reason.type)).toEqual(["behind", "no_checkin"]);
    expect(byId.p5.careReasons.map((reason) => reason.type)).toEqual(["behind", "never_read"]);
    expect(byId.p6).toMatchObject({ progressBucket: "completed", care: false, byRound: { 1: 21, 2: 3 } });
    expect(byId.p7).toMatchObject({ enrolled: false, progressBucket: "not_enrolled", checkinBucket: "none" });
    expect(roster.people.filter((row) => row.care)).toHaveLength(buildPlanSummary(report()).care.total);
  });
});

describe("scope filter params", () => {
  it("accepts unit names only, up to 100 characters", () => {
    expect(parseScopeFilter(undefined)).toEqual({ ok: true, scope: {} });
    expect(parseScopeFilter({ greatRegion: "北區", pastoralZone: "" })).toEqual({ ok: true, scope: { greatRegion: "北區" } });
    expect(parseScopeFilter({ greatRegion: 1 })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(parseScopeFilter({ greatRegion: "x".repeat(101) })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(parseScopeFilter(["北區"])).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(parseScopeFilter("北區")).toEqual({ ok: false, error: "invalid_org_filter" });
  });
});

// ── 後台 admin-api ─────────────────────────────────────────────────────────
function setupAdmin({ info = { data: PLAN_ROW, error: null }, people = { data: overview(), error: null }, role = "admin" } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: role, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event") return { data: 1, error: null };
      if (fn === "admin_api_plan_info") return info;
      if (fn === "admin_api_plan_people") return people;
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
const planCalls = (calls) => calls.filter((call) => call.fn.startsWith("admin_api_plan_"));

describe("admin-api plan_summary / plan_roster", () => {
  it("need plans.read; only the roster asks SQL to audit", () => {
    expect(ADMIN_ACTIONS.plan_summary.capabilities).toEqual(["plans.read"]);
    expect(ADMIN_ACTIONS.plan_roster.capabilities).toEqual(["plans.read"]);
    const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-1" };
    expect(ADMIN_ACTIONS.plan_summary.buildArgs({ global_plan_id: PLAN_ID }, ctx).args.p_audit).toBe(false);
    expect(ADMIN_ACTIONS.plan_roster.buildArgs({ global_plan_id: PLAN_ID }, ctx).args.p_audit).toBe(true);
    expect(ADMIN_ACTIONS.plan_roster.buildArgs({ global_plan_id: "nope" }, ctx)).toEqual({ ok: false, error: "invalid_plan_id" });
  });

  it("summary: plan info first, then people with the preset key the server derived — never a client scope", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({
      action: "plan_summary", params: { global_plan_id: PLAN_ID, scope: { greatRegion: "北區" }, p_whole_church: false, p_visible_ids: ["x"] }
    }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.funnel.inScope).toBe(3);
    expect(res.body.data.meta.consistent).toBe(true);
    const [info, people] = planCalls(calls);
    expect(info).toEqual({ fn: "admin_api_plan_info", args: { p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID } });
    expect(people.fn).toBe("admin_api_plan_people");
    // 一般計畫的 preset key＝計畫 id（和 App 的 plan.presetKey 同一個函式推出來）
    expect(people.args).toMatchObject({ p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID, p_audit: false, p_preset_key: resolvePlanForReport(PLAN_ROW).plan.presetKey });
    expect(people.args.p_preset_key).toBe(PLAN_ID);
    expect(Object.keys(people.args).sort()).toEqual(["p_actor_id", "p_actor_role", "p_audit", "p_global_plan_id", "p_preset_key", "p_request_id"]);
  });

  it("roster: audits through SQL and returns every row", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "plan_roster", params: { global_plan_id: PLAN_ID } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.people).toHaveLength(7);
    expect(planCalls(calls)[1].args.p_audit).toBe(true);
  });

  it("SQL saying 'not an admin' (42501) is a 403; a missing plan is a 404; a bad scope is a 400 before any SQL", async () => {
    const forbidden = setupAdmin({ info: { data: null, error: { code: "42501", message: "forbidden" } } });
    expect(await json(await handleAdminRequest(post({ action: "plan_roster", params: { global_plan_id: PLAN_ID } }), forbidden.deps)))
      .toMatchObject({ status: 403, body: { error: "forbidden" } });
    expect(planCalls(forbidden.calls).map((call) => call.fn)).toEqual(["admin_api_plan_info"]);

    const missing = setupAdmin({ info: { data: null, error: null } });
    expect(await json(await handleAdminRequest(post({ action: "plan_summary", params: { global_plan_id: PLAN_ID } }), missing.deps)))
      .toMatchObject({ status: 404, body: { error: "plan_not_found" } });

    const badScope = setupAdmin();
    expect(await json(await handleAdminRequest(post({ action: "plan_summary", params: { global_plan_id: PLAN_ID, scope: { greatRegion: 3 } } }), badScope.deps)))
      .toMatchObject({ status: 400, body: { error: "invalid_org_filter" } });
    expect(planCalls(badScope.calls)).toEqual([]);
  });

  it("a non-admin role never reaches the plan SQL", async () => {
    const { deps, calls } = setupAdmin({ role: "zone_leader" });
    expect((await handleAdminRequest(post({ action: "plan_summary", params: { global_plan_id: PLAN_ID } }), deps)).status).toBe(403);
    expect(planCalls(calls)).toEqual([]);
  });
});

// ── 組長版 nlc-data ────────────────────────────────────────────────────────
describe("nlc-data plan_summary / plan_roster (leader view)", () => {
  const deps = (people = overview()) => ({
    fetchPlanRow: vi.fn(async () => ({ data: PLAN_ROW, error: null })),
    rpc: vi.fn(async () => ({ data: people, error: null }))
  });

  it("are the two report actions and read the columns the schedule needs", () => {
    expect([...PLAN_REPORT_ACTIONS]).toEqual(["plan_summary", "plan_roster"]);
    expect(PLAN_REPORT_PLAN_COLUMNS).toBe("id, name, plan_kind, start_date, end_date, target_books, rules, is_hidden");
  });

  it("uses the server's visible ids and ignores any scope the client sends", async () => {
    const d = deps();
    const forged = { p_global_plan_id: PLAN_ID, p_whole_church: true, p_visible_ids: null, p_actor_id: "someone-else", p_preset_key: "forged" };
    const res = await runPlanReport("plan_roster", forged, ["p1", "p2"], ADMIN_ID, d);
    expect(res.status).toBe(200);
    expect(d.rpc).toHaveBeenCalledWith("get_pastoral_overview", {
      p_global_plan_id: PLAN_ID, p_preset_key: PLAN_ID, p_whole_church: false, p_visible_ids: ["p1", "p2"], p_actor_id: ADMIN_ID
    });
    expect(res.planId).toBe(PLAN_ID);
    expect(res.people).toBe(7);
  });

  it("whole church only when getVisibleProfileIds returned null", async () => {
    const d = deps();
    await runPlanReport("plan_summary", { p_global_plan_id: PLAN_ID }, null, ADMIN_ID, d);
    expect(d.rpc.mock.calls[0][1]).toMatchObject({ p_whole_church: true, p_visible_ids: null });
  });

  it("an empty managed scope never widens to the whole church (only the leader themself)", async () => {
    const d = deps(overview([]));
    const res = await runPlanReport("plan_summary", { p_global_plan_id: PLAN_ID }, [], ADMIN_ID, d);
    expect(d.rpc.mock.calls[0][1]).toMatchObject({ p_whole_church: false, p_visible_ids: [ADMIN_ID] });
    expect(res.body.data.funnel.inScope).toBe(0);
  });

  it("validates the plan id and scope, and 404s an unknown plan", async () => {
    const d = deps();
    expect(await runPlanReport("plan_summary", { p_global_plan_id: "nope" }, null, ADMIN_ID, d)).toEqual({ status: 400, body: { error: "invalid_plan_id" } });
    expect(await runPlanReport("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: [] } }, null, ADMIN_ID, d))
      .toEqual({ status: 400, body: { error: "invalid_org_filter" } });
    expect(d.fetchPlanRow).not.toHaveBeenCalled();
    const missing = { fetchPlanRow: vi.fn(async () => ({ data: null, error: null })), rpc: vi.fn() };
    expect(await runPlanReport("plan_roster", { p_global_plan_id: PLAN_ID }, null, ADMIN_ID, missing)).toEqual({ status: 404, body: { error: "plan_not_found" } });
    expect(missing.rpc).not.toHaveBeenCalled();
  });

  it("gives the same numbers as the admin console for the same people", async () => {
    const leader = await runPlanReport("plan_summary", { p_global_plan_id: PLAN_ID }, null, ADMIN_ID, deps());
    const { deps: adminDeps } = setupAdmin();
    const admin = await json(await handleAdminRequest(post({ action: "plan_summary", params: { global_plan_id: PLAN_ID } }), adminDeps));
    expect(leader.body.data).toEqual(admin.body.data);
  });

  it("index.ts gates the actions on canManagePlans, scopes with getVisibleProfileIds and audits the roster", () => {
    const src = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = src.indexOf("if (PLAN_REPORT_ACTIONS.has(action)) {");
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, src.indexOf("return jsonResponse(result.body, result.status);", start));
    expect(block).toContain("if (!canManagePlans(profile)) return jsonResponse({ error: \"forbidden\" }, 403);");
    expect(block).toContain("const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);");
    expect(block).toContain("runPlanReport(action, body.args, visibleIds, profile.id,");
    expect(block).toContain("p_action: \"view_plan_roster\"");
    expect(block).toContain("if (action === \"plan_roster\" && result.status === 200) {");
  });
});
