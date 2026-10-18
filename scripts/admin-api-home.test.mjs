// 後台首頁（#569）的 admin-api：home_summary 只有數字、不記稽核、不含任何人的名字；
// 計畫那幾格（需要關心、還沒滿的隊、本期進度）和計畫總覽同一份規則、同一個預設計畫，點進去的人數一定一樣。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildPlanSummary, preparePlanReport, resolvePlanForReport } from "../supabase/functions/_shared/progress/plan-report.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CLIENT = "admin-spa-client";
const PLAN_ROW = {
  id: PLAN_ID, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const TODAY = "2026-11-11";
const enrollment = (chapters, lastReadDay) => ({
  round: 1, maxRound: chapters > 0 ? 1 : 0, upgradeHandled: false, books: ["約翰福音"],
  chapters, byRound: chapters > 0 ? { 1: chapters } : {},
  lastReadAt: lastReadDay ? `${lastReadDay}T04:00:00Z` : null, readDays7: lastReadDay ? 1 : 0
});
const team = { id: "t1", name: "晨光隊", division: 3, size: 2 };
const PEOPLE = [
  { id: "p1", name: "甲", greatRegion: "北區", pastoralZone: "北一", smallGroup: "A組", enrollment: enrollment(11, "2026-11-11"), teams: [team], quiz: {} },
  { id: "p2", name: "乙", greatRegion: "北區", pastoralZone: "北一", smallGroup: "A組", enrollment: enrollment(2, "2026-11-02"), teams: [team], quiz: {} },
  { id: "p3", name: "丙", greatRegion: "南區", pastoralZone: "南一", smallGroup: "B組", enrollment: enrollment(0, null), teams: [], quiz: {} },
  { id: "p4", name: "丁", greatRegion: "南區", pastoralZone: "南一", smallGroup: "B組", enrollment: null, teams: [], quiz: {} }
];
const OVERVIEW = { today: TODAY, people: PEOPLE, meta: { inScope: 4, enrolled: 3 } };
const COUNTS = {
  reports: { open: 3, unread: 1, oldest_open_at: "2026-11-08T01:00:00Z" },
  commentary: { pending: 355, approved: 2 },
  quiz: { enabled: true, configured: true, date: "2026-11-12", status: "waiting", needs_attention: true },
  changes: [{ action: "app_feature_settings.update", occurred_at: "2026-11-10T02:00:00Z" }, { action: "publish_global_plan_rules", occurred_at: "2026-11-09T02:00:00Z" }]
};

function setup({ options = { data: { plans: [], default_plan_id: PLAN_ID }, error: null }, counts = { data: COUNTS, error: null }, role = "admin" } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: role, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event") return { data: 1, error: null };
      if (fn === "admin_api_plan_options") return options;
      if (fn === "admin_api_plan_info") return { data: PLAN_ROW, error: null };
      if (fn === "admin_api_plan_people") return { data: OVERVIEW, error: null };
      if (fn === "admin_api_home_counts") return counts;
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
const sqlCalls = (calls) => calls.filter((call) => /^admin_api_(plan|home)_/.test(call.fn));

describe("admin-api home_summary (#569)", () => {
  it("default plan → the same summary rules as the plan overview → the other counts; nothing audited", async () => {
    const { deps, calls } = setup();
    const res = await json(await handleAdminRequest(post({ action: "home_summary", params: {} }), deps));
    expect(res.status).toBe(200);
    expect(sqlCalls(calls).map((call) => call.fn)).toEqual([
      "admin_api_plan_options", "admin_api_plan_info", "admin_api_plan_people", "admin_api_home_counts"
    ]);
    const people = calls.find((call) => call.fn === "admin_api_plan_people");
    expect(people.args).toMatchObject({ p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID, p_audit: false });
    expect(calls.find((call) => call.fn === "admin_api_home_counts").args).toEqual({ p_actor_id: ADMIN_ID, p_global_plan_id: PLAN_ID });
    expect(calls.some((call) => call.fn === "admin_api_record_event")).toBe(false);

    // 計畫那幾格＝計畫總覽同一份規則算出來的數字
    const summary = buildPlanSummary(preparePlanReport({ resolved: resolvePlanForReport(PLAN_ROW), overview: OVERVIEW }));
    const { plan } = res.body.data;
    expect(plan.plan.name).toBe("約翰福音 21 天");
    expect(plan.care).toEqual(summary.care);
    expect(plan.teams).toEqual(summary.teams);
    expect(plan.funnel).toEqual(summary.funnel);
    expect(plan.schedule).toEqual(summary.schedule);
    expect(plan.care.total).toBeGreaterThan(0);
    expect(plan.teams.unfilled).toBe(1);

    expect(res.body.data.reports).toEqual(COUNTS.reports);
    expect(res.body.data.commentary).toEqual(COUNTS.commentary);
    expect(res.body.data.quiz).toEqual(COUNTS.quiz);
    // 設定變更：只有動作（中文）與時間
    expect(res.body.data.changes).toEqual([
      { action: "app_feature_settings.update", label: "修改功能開放設定", occurredAt: "2026-11-10T02:00:00Z" },
      { action: "publish_global_plan_rules", label: "發布計畫規則", occurredAt: "2026-11-09T02:00:00Z" }
    ]);
  });

  it("carries no one's name: no roster rows, no operator", async () => {
    const { deps } = setup();
    const res = await json(await handleAdminRequest(post({ action: "home_summary", params: {} }), deps));
    const text = JSON.stringify(res.body.data);
    for (const name of ["甲", "乙", "丙", "丁"]) expect(text).not.toContain(`"${name}"`);
    expect(res.body.data.plan).not.toHaveProperty("people");
    expect(res.body.data.plan).not.toHaveProperty("units");
  });

  it("no plan at all: plan is null and the counts still come back", async () => {
    const { deps, calls } = setup({ options: { data: { plans: [], default_plan_id: null }, error: null } });
    const res = await json(await handleAdminRequest(post({ action: "home_summary", params: {} }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBeNull();
    expect(sqlCalls(calls).map((call) => call.fn)).toEqual(["admin_api_plan_options", "admin_api_home_counts"]);
    expect(calls.find((call) => call.fn === "admin_api_home_counts").args.p_global_plan_id).toBeNull();
  });

  it("SQL saying 'not an admin' is a 403; a failed count is an error, never an empty page", async () => {
    const forbidden = setup({ options: { data: null, error: { code: "42501", message: "forbidden" } } });
    expect(await json(await handleAdminRequest(post({ action: "home_summary", params: {} }), forbidden.deps)))
      .toMatchObject({ status: 403, body: { error: "forbidden" } });
    const broken = setup({ counts: { data: null, error: { code: "XX000", message: "boom" } } });
    expect((await handleAdminRequest(post({ action: "home_summary", params: {} }), broken.deps)).status).toBe(500);
  });

  it("a non-admin role never reaches the SQL", async () => {
    const { deps, calls } = setup({ role: "zone_leader" });
    expect((await handleAdminRequest(post({ action: "home_summary", params: {} }), deps)).status).toBe(403);
    expect(sqlCalls(calls)).toEqual([]);
  });

  it("only needs console access; the SQL re-checks the admin and is service_role only", () => {
    expect(ADMIN_ACTIONS.home_summary.capabilities).toEqual(["console.access"]);
    const sql = readFileSync(new URL("../supabase/migrations/20261016012410_admin_api_home.sql", import.meta.url), "utf8");
    expect(sql).toContain("PERFORM public.admin_api_assert_admin(p_actor_id);");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_api_home_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.admin_api_home_counts(uuid, uuid) TO service_role;");
    // 明天的小測驗用日曆同一份狀態，不另寫一套
    expect(sql).toContain("public.get_daily_quiz_calendar(p_global_plan_id, v_tomorrow, 1, p_actor_id)");
    // 設定變更不回操作者與對象
    expect(sql).not.toMatch(/'actor_id'|'target_user_id'|'target_id'/);
  });
});
