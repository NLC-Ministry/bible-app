// #565 後台「計畫」區：名單篩選、排序、從總覽點進名單的對帳，以及 admin-api 的四個新動作。
//   · 對帳：總覽漏斗每一層、需要關心每個數字點進名單，人數一定相同（同一份 plan-report.mjs 規則）；
//   · 名單匯出由伺服器用同一份規則重算、不帶 email、記一筆 export，記不成就不回檔案；
//   · 關心提醒：參數先擋、plan_key 由伺服器從計畫推出（和 App 的 presetKey || globalPlanId 相同）。
// SQL（admin_api_plan_options／plan_quiz／care_remind）已在 staging 以回滾交易驗過：小測驗分母＝總覽報名人數、
// 會友呼叫被擋、同一天第二則被拒、一則一筆稽核。
import { describe, expect, it, vi } from "vitest";
import {
  FUNNEL_DRILL_KEYS,
  buildPlanRoster,
  buildPlanSummary,
  defaultRosterFilters,
  drillRosterFilters,
  filterPlanRoster,
  parseRosterFilters,
  preparePlanReport,
  presetRosterFilters,
  resolvePlanForReport,
  sortPlanRoster,
  summarizeTeams
} from "../supabase/functions/_shared/progress/plan-report.mjs";
import { ADMIN_ACTIONS, CAPABILITIES } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { PLAN_ROSTER_EXPORT_HEADERS } from "../supabase/functions/admin-api/plans.ts";
import { migrationFiles, readMigration } from "./migration-sql.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_CLIENT = "admin-spa-client";

// 約翰福音 21 天、今天第 11 天（同 plan-report.test.mjs）
const PLAN_ROW = {
  id: PLAN_ID, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const TODAY = "2026-11-11";
const at = (day) => `${day}T04:00:00Z`;
const enrollment = (chapters, lastReadDay, extra = {}) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {},
  lastReadAt: lastReadDay ? at(lastReadDay) : null, readDays7: lastReadDay ? 1 : 0, ...extra
});
const team = (id, name, division, size, captain = false) => ({ id, name, division, status: "active", size, captain });
const person = (id, name, unit, enroll, teams = []) => ({
  id, name, greatRegion: unit[0], pastoralZone: unit[1], smallGroup: unit[2], enrollment: enroll, teams, quiz: { published: 4, submitted: 2 }
});
const DAWN = team("t1", "晨光隊", 3, 3, true);
const WIND = team("t2", "南風隊", 6, 2);
const PEOPLE = [
  person("p1", "甲", ["北區", "北一", "A組"], enrollment(11, "2026-11-11"), [DAWN]),            // 跟上、今天
  person("p2", "乙", ["北區", "北一", "A組"], enrollment(10, "2026-11-10"), [DAWN]),            // 今日未完成＝跟上
  person("p3", "丙", ["北區", "北二", "B組"], enrollment(8, "2026-11-07")),                      // 落後 3 天、4 天沒打卡
  person("p4", "丁", ["南區", "南一", "C組"], enrollment(2, "2026-11-02", { readDays7: 0 }), [WIND]), // 落後 9 天、9 天沒打卡
  person("p5", "戊", ["南區", "南一", "C組"], enrollment(0, null)),                              // 報名沒讀
  person("p6", "己", ["南區", "南二", "D組"], enrollment(24, "2026-11-11", {                     // 讀完一遍
    round: 2, maxRound: 2, upgradeHandled: true, byRound: { 1: 21, 2: 3 }
  })),
  person("p7", "庚", ["南區", "南二", "D組"], null)                                               // 未報名
];
const overview = (people = PEOPLE) => ({
  today: TODAY,
  people,
  meta: { inScope: people.length, enrolled: people.filter((row) => row.enrollment).length }
});
const report = () => preparePlanReport({ resolved: resolvePlanForReport(PLAN_ROW), overview: overview() });
const ids = (rows) => rows.map((row) => row.id);

describe("roster drill-downs reconcile with the summary", () => {
  const summary = buildPlanSummary(report());
  const roster = buildPlanRoster(report()).people;
  const count = (key) => filterPlanRoster(roster, drillRosterFilters(key)).length;

  it("every funnel layer opens a roster with exactly that many people", () => {
    for (const key of ["inScope", "enrolled", "active7", "onTrack", "completedOnce", "care"]) {
      expect(count(key), key).toBe(summary.funnel[key]);
    }
    expect(summary.funnel).toMatchObject({ inScope: 7, enrolled: 6, active7: 4, onTrack: 3, completedOnce: 1, care: 3 });
  });

  it("each care number opens the same people the summary counted", () => {
    expect(count("careBehind")).toBe(summary.care.behind);
    expect(count("careCheckin")).toBe(summary.care.noCheckin + summary.care.neverRead);
    expect(ids(filterPlanRoster(roster, drillRosterFilters("care"))).sort()).toEqual(["p3", "p4", "p5"]);
    expect(FUNNEL_DRILL_KEYS).toEqual(["inScope", "enrolled", "active7", "onTrack", "completedOnce", "care", "careBehind", "careCheckin"]);
    // 認不得的 key 回預設（報名者），不會變成「全部」
    expect(drillRosterFilters("toString")).toEqual(defaultRosterFilters());
  });

  it("the three quick buttons: enrolled (default), care, everyone", () => {
    expect(filterPlanRoster(roster, presetRosterFilters("enrolled"))).toHaveLength(summary.funnel.enrolled);
    expect(filterPlanRoster(roster, presetRosterFilters("care"))).toHaveLength(summary.funnel.care);
    expect(filterPlanRoster(roster, presetRosterFilters("all"))).toHaveLength(summary.funnel.inScope);
  });
});

describe("roster filters", () => {
  const roster = buildPlanRoster(report()).people;
  const run = (filters) => ids(filterPlanRoster(roster, { ...defaultRosterFilters(), ...filters })).sort();

  it("ticks inside one condition are a union; conditions intersect", () => {
    expect(run({ progress: ["behind"] })).toEqual(["p3"]);
    expect(run({ progress: ["behind", "behind_long"] })).toEqual(["p3", "p4", "p5"]);
    expect(run({ progress: ["behind", "behind_long"], checkin: ["dormant"] })).toEqual(["p4"]);
    expect(run({ progress: [], checkin: ["today"] })).toEqual([]);
  });

  it("team: has a team / no team (enrolled only)", () => {
    expect(run({ team: "yes" })).toEqual(["p1", "p2", "p4"]);
    expect(run({ team: "no" })).toEqual(["p3", "p5", "p6"]);
    // 「沒有隊」不含未報名的人，即使條件是「全部」
    expect(run({ ...presetRosterFilters("all"), team: "no" })).toEqual(["p3", "p5", "p6"]);
  });

  it("searches name and units", () => {
    expect(run({ q: "南二" })).toEqual(["p6"]);
    expect(run({ q: "甲" })).toEqual(["p1"]);
  });

  it("parses what the console sends and rejects anything else", () => {
    expect(parseRosterFilters(undefined)).toEqual({ ok: true, filters: defaultRosterFilters() });
    expect(parseRosterFilters({ progress: ["completed", "on_track"], team: "yes", q: "  北區 " })).toEqual({ ok: true, filters: {
      shortcut: "", progress: ["on_track", "completed"], checkin: defaultRosterFilters().checkin, team: "yes", q: "北區"
    } });
    for (const bad of [[], "care", { shortcut: "everyone" }, { progress: ["late"] }, { progress: "behind" }, { checkin: [1] },
      { team: "maybe" }, { q: 3 }, { q: "x".repeat(51) }]) {
      expect(parseRosterFilters(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "invalid_roster_filter" });
    }
  });
});

describe("roster sort", () => {
  const roster = buildPlanRoster(report()).people;
  it("most behind first by default; chapters both ways; ties by name", () => {
    expect(ids(sortPlanRoster(roster)).slice(0, 3)).toEqual(["p5", "p4", "p3"]);
    expect(ids(sortPlanRoster(roster, "chapters_desc")).slice(0, 2)).toEqual(["p6", "p1"]);
    expect(ids(sortPlanRoster(roster, "chapters_asc")).slice(0, 2).sort()).toEqual(["p5", "p7"]);
    expect(ids(sortPlanRoster(roster, "chapters_asc")).at(-1)).toBe("p6");
    expect(sortPlanRoster(roster)).not.toBe(roster);
  });
});

describe("team numbers and unit drill-down", () => {
  const summary = buildPlanSummary(report());
  it("counts enrolled people with and without a team, and unfilled teams", () => {
    expect(summary.teams).toEqual({ enrolled: 6, withTeam: 3, withoutTeam: 3, teams: 2, unfilled: 1 });
    expect(summarizeTeams([])).toEqual({ enrolled: 0, withTeam: 0, withoutTeam: 0, teams: 0, unfilled: 0 });
  });
  it("regions carry their pastoral zones, which add back up to the region", () => {
    expect(summary.units.level).toBe("greatRegion");
    expect(summary.units.rows.map((row) => [row.name, row.withTeam])).toEqual([["北區", 2], ["南區", 1]]);
    expect(summary.units.children.level).toBe("pastoralZone");
    for (const row of summary.units.rows) {
      const children = summary.units.children.rows[row.name];
      for (const key of ["inScope", "enrolled", "onTrack", "care", "withTeam"]) {
        expect(children.reduce((total, child) => total + child[key], 0), `${row.name}.${key}`).toBe(row[key]);
      }
    }
    expect(summary.units.children.rows["南區"].map((row) => row.name)).toEqual(["南一", "南二"]);
  });
});

// ── admin-api ──────────────────────────────────────────────────────────────
function setupAdmin({ info = { data: PLAN_ROW, error: null }, record = { data: 1, error: null }, remind } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: "admin", is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event") return record;
      if (fn === "admin_api_plan_info") return info;
      if (fn === "admin_api_plan_people") return { data: overview(), error: null };
      if (fn === "admin_api_plan_options") return { data: { plans: [], default_plan_id: null }, error: null };
      if (fn === "admin_api_plan_quiz") return { data: { enrolled: 6 }, error: null };
      if (fn === "admin_api_care_remind") return remind || { data: { id: "r1", reason: args.p_reason, message: args.p_message }, error: null };
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
const sqlCalls = (calls) => calls.filter((call) => call.fn.startsWith("admin_api_plan_") || call.fn === "admin_api_care_remind" || call.fn === "admin_api_record_event");
const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-1" };

describe("admin-api plan area actions", () => {
  it("declare their capabilities; reminders need their own", () => {
    expect(CAPABILITIES).toContain("plans.remind");
    expect(ADMIN_ACTIONS.plan_options.capabilities).toEqual(["plans.read"]);
    expect(ADMIN_ACTIONS.plan_quiz.capabilities).toEqual(["plans.read"]);
    expect(ADMIN_ACTIONS.plan_roster_export.capabilities).toEqual(["plans.read", "export"]);
    expect(ADMIN_ACTIONS.care_remind.capabilities).toEqual(["plans.remind"]);
    expect(ADMIN_ACTIONS.plan_options.buildArgs({ p_actor_id: "forged" }, ctx)).toEqual({ ok: true, args: { p_actor_id: ADMIN_ID } });
  });

  it("plan_quiz asks SQL with the preset key the server derived", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "plan_quiz", params: { global_plan_id: PLAN_ID, p_preset_key: "forged" } }), deps));
    expect(res).toMatchObject({ status: 200, body: { data: { enrolled: 6 } } });
    expect(sqlCalls(calls)).toEqual([
      { fn: "admin_api_plan_info", args: { p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID } },
      { fn: "admin_api_plan_quiz", args: { p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID, p_preset_key: PLAN_ID } }
    ]);
    const bad = setupAdmin();
    expect((await handleAdminRequest(post({ action: "plan_quiz", params: { global_plan_id: "nope" } }), bad.deps)).status).toBe(400);
    expect(sqlCalls(bad.calls)).toEqual([]);
  });

  it("plan_roster_export builds the CSV with the console's rules, without email, and audits it", async () => {
    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "plan_roster_export", params: {
      global_plan_id: PLAN_ID, filters: drillRosterFilters("care"), sort: "chapters_desc"
    } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rows: 3, total: 7, truncated: false });
    expect(res.body.data.filename).toMatch(/^計畫名單_約翰福音 21 天_\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = res.body.data.csv.split("\r\n");
    expect(lines[0]).toMatch(/^"匯出時間（台灣時間）"/);
    expect(lines[1]).toBe(PLAN_ROSTER_EXPORT_HEADERS.map((header) => `"${header}"`).join(","));
    expect(lines.slice(2).map((line) => line.split(",")[3])).toEqual(['"丙"', '"丁"', '"戊"']);
    expect(lines.find((line) => line.includes('"丁"'))).toContain('"落後 9 天、9 天沒打卡"');
    expect(res.body.data.csv).not.toMatch(/email|@/i);
    const sql = sqlCalls(calls);
    expect(sql.map((call) => call.fn)).toEqual(["admin_api_plan_info", "admin_api_plan_people", "admin_api_record_event"]);
    // 名單那步不記 view_plan_roster，改記一筆 export
    expect(sql[1].args.p_audit).toBe(false);
    expect(sql[2].args).toMatchObject({
      p_action: "export", p_result: "ok", p_actor_id: ADMIN_ID, p_resource: "global_plans",
      p_detail: { kind: "plan_roster", global_plan_id: PLAN_ID, plan_name: PLAN_ROW.name, sort: "chapters_desc", rows: 3 }
    });
  });

  it("plan_roster_export returns no file when the audit fails, and checks the filters before any SQL", async () => {
    const failing = setupAdmin({ record: { data: null, error: { message: "boom" } } });
    const res = await json(await handleAdminRequest(post({ action: "plan_roster_export", params: { global_plan_id: PLAN_ID } }), failing.deps));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("csv");

    for (const params of [{ filters: { team: "maybe" } }, { sort: "name" }]) {
      const bad = setupAdmin();
      const out = await json(await handleAdminRequest(post({ action: "plan_roster_export", params: { global_plan_id: PLAN_ID, ...params } }), bad.deps));
      expect(out.status, JSON.stringify(params)).toBe(400);
      expect(sqlCalls(bad.calls)).toEqual([]);
    }
  });

  it("care_remind validates before SQL and derives the plan key on the server", async () => {
    const base = { global_plan_id: PLAN_ID, recipient_id: MEMBER_ID, reason: "care", message: "  最近好嗎？  " };
    for (const [patch, error] of [
      [{ recipient_id: "x" }, "invalid_recipient"], [{ reason: "nag" }, "invalid_reason"],
      [{ message: "   " }, "invalid_message"], [{ message: "字".repeat(301) }, "invalid_message"], [{ global_plan_id: 1 }, "invalid_plan_id"]
    ]) {
      const bad = setupAdmin();
      expect(await json(await handleAdminRequest(post({ action: "care_remind", params: { ...base, ...patch } }), bad.deps)))
        .toMatchObject({ status: 400, body: { error } });
      expect(sqlCalls(bad.calls)).toEqual([]);
    }

    const { deps, calls } = setupAdmin();
    const res = await json(await handleAdminRequest(post({ action: "care_remind", params: { ...base, p_plan_key: "forged", sender_id: MEMBER_ID } }), deps));
    expect(res.status).toBe(200);
    const remind = sqlCalls(calls).find((call) => call.fn === "admin_api_care_remind");
    expect(remind.args).toEqual({
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_recipient_id: MEMBER_ID, p_global_plan_id: PLAN_ID,
      p_reason: "care", p_message: "最近好嗎？", p_request_id: "req-from-client-1", p_plan_key: PLAN_ID
    });
  });

  it("care_remind passes SQL's reason through (already sent today → 400)", async () => {
    const { deps } = setupAdmin({ remind: { data: null, error: { code: "22023", message: "care_reminder_already_sent" } } });
    expect(await json(await handleAdminRequest(post({ action: "care_remind", params: {
      global_plan_id: PLAN_ID, recipient_id: MEMBER_ID, reason: "care", message: "hi"
    } }), deps))).toMatchObject({ status: 400, body: { error: "care_reminder_already_sent" } });
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_plan_area.sql"));
  const sql = readMigration(file);
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);

  it("grants every function to service_role only", () => {
    expect(fns).toEqual(["admin_api_plan_options", "admin_api_plan_quiz", "admin_api_care_remind"]);
    for (const fn of fns) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
      expect(sql, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*authenticated`));
    }
  });

  it("every function re-checks the actor; reminders audit in the same function and never rewrite a sent one", () => {
    for (const fn of fns) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, body.indexOf("$function$;")), fn).toContain("PERFORM public.admin_api_assert_admin(p_actor_id);");
    }
    const remind = sql.slice(sql.indexOf("FUNCTION public.admin_api_care_remind("));
    expect(remind).toContain("audit.record('admin-api', 'care_reminder.send'");
    expect(remind).toContain("RAISE EXCEPTION 'care_reminder_already_sent'");
    expect(remind).not.toMatch(/UPDATE public\.care_reminders/);
  });
});
