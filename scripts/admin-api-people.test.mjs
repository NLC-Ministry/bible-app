// #567 後台「人」區：個人頁的除錯檢查、「會友 App 現在應該顯示」、App 版本比對，以及名單游標分頁與分區調閱的 SQL。
// SQL（admin_api_user_summary／user_section／user_timeline／directory_list）已在 staging 以回滾交易驗過：
// 名單第二頁接在第一頁最後一人之後、各區第一頁記一筆 view_user_section、摘要的 app_plans 只含這一個人。
import { describe, expect, it, vi } from "vitest";
import { buildPlanRoster, preparePlanReport, resolvePlanForReport } from "../supabase/functions/_shared/progress/plan-report.mjs";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { appVersionCheck, buildPersonReport, formatBuildId } from "../supabase/functions/admin-api/people.ts";
import { ADMIN_ACTIONS, MEMBER_APP_ORIGIN, memberAppOrigin, parseAppVersion } from "../supabase/functions/admin-api/policy.ts";
import { AUDIT_ACTION_LABEL } from "../supabase/functions/admin-api/audit.ts";
import { latestFunctionDefinition, migrationFiles, readMigration } from "./migration-sql.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CLIENT = "admin-spa-client";

// 約翰福音 21 天、今天第 11 天（同 plan-area.test.mjs）
const PLAN_ROW = {
  id: PLAN_ID, name: "約翰福音 21 天", plan_kind: "standard", rules: null, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const TODAY = "2026-11-11";
const personFacts = (enrollment) => ({
  id: USER_ID, name: "丙", greatRegion: "北區", pastoralZone: "北一", smallGroup: "B組",
  enrollment, teams: [{ id: "t1", name: "晨光隊", division: 3, status: "ready", size: 3, captain: false }], quiz: { published: 4, submitted: 2 }
});
const ENROLLMENT = {
  round: 1, maxRound: 1, upgradeHandled: false, books: ["約翰福音"], chapters: 8, byRound: { 1: 8 },
  lastReadAt: "2026-11-07T04:00:00Z", readDays7: 1
};
const appPlan = (enrollment = ENROLLMENT) => ({
  plan: PLAN_ROW,
  people: { today: TODAY, people: [personFacts(enrollment)], meta: { inScope: 1, enrolled: enrollment ? 1 : 0 } }
});

const CLEAN_FACTS = {
  today: TODAY,
  duplicate_enrollments: [],
  orphan_logs: { count: 0, chapters: 0, books: [], first_read_at: null, last_read_at: null },
  chapter_totals: [{ plan_id: "rp1", global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", app_total: 8, in_books: 8 }],
  identities: { count: 1, shared_member_id: [], shared_email: [] },
  team_conflicts: [],
  grace: [{ global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", end_date: "2026-11-21", grace_days: 2, cutoff: "2026-11-23", late_writes: 0 }],
  last_report_build: { build_id: "20261101090000", reported_at: "2026-11-05T02:00:00Z" }
};
const summary = (facts = {}, extra = {}) => ({
  account: { id: USER_ID, name: "丙", is_active: true, role_code: "member" },
  identities: [], org: {}, member_hub: {},
  counts: { plans: 1, teams: 1, reading_logs: 8, team_events: 1, tests: 0, vouchers: 0, reports: 1, notifications: 0 },
  voucher_states: { unredeemed: 0, redeemed: 0, expired: 0, voided: 0 },
  notes: { verse_notes: 3, devotional_notes: 0, last_updated_at: "2026-11-02T00:00:00Z" },
  facts: { ...CLEAN_FACTS, ...facts },
  app_plans: [appPlan()],
  ...extra
});
const LATEST = { version: "20261101090000", minVersion: null };
const byId = (report) => Object.fromEntries(report.checks.map((check) => [check.id, check]));

describe("個人頁的除錯檢查", () => {
  it("列出事故清單的七項，沒事時全部通過", () => {
    const report = buildPersonReport(summary(), LATEST);
    expect(report.checks.map((check) => check.id)).toEqual([
      "duplicate_enrollment", "orphan_logs", "chapter_totals", "identity", "team_conflict", "grace", "app_version"
    ]);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
    // 事實不直接給前端：前端只拿判斷好的檢查
    expect(report).not.toHaveProperty("facts");
    expect(report.notes).toEqual({ verse_notes: 3, devotional_notes: 0, last_updated_at: "2026-11-02T00:00:00Z" });
  });

  it("沒有歸屬計畫的打卡標紅，說明章數會多算", () => {
    const check = byId(buildPersonReport(summary({
      orphan_logs: { count: 5, chapters: 5, books: ["出埃及記"], first_read_at: "2026-08-20T00:00:00Z", last_read_at: "2026-08-25T00:00:00Z" }
    }), LATEST)).orphan_logs;
    expect(check).toMatchObject({ status: "fail", summary: "5 筆打卡（5 章）沒有歸屬任何計畫。" });
    expect(check.details).toEqual(["書卷：出埃及記", "閱讀時間：2026-08-20 ～ 2026-08-25"]);
    expect(check.impact).toContain("多算");
  });

  it("重複報名、同計畫同組別兩隊、截止後寫入都標紅；章數不一致只是提醒", () => {
    const checks = byId(buildPersonReport(summary({
      duplicate_enrollments: [{ global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", count: 2 }],
      team_conflicts: [{ global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", division: 3, teams: [{ id: "t1", name: "晨光隊" }, { id: "t2", name: "南風隊" }] }],
      grace: [{ global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", end_date: "2026-11-21", grace_days: 0, cutoff: "2026-11-21", late_writes: 2 }],
      chapter_totals: [{ plan_id: "rp1", global_plan_id: PLAN_ID, plan_name: "約翰福音 21 天", app_total: 45, in_books: 40 }]
    }), LATEST));
    expect(checks.duplicate_enrollment).toMatchObject({ status: "fail", details: ["「約翰福音 21 天」有 2 筆報名"] });
    expect(checks.team_conflict).toMatchObject({ status: "fail" });
    expect(checks.team_conflict.links).toEqual([
      { kind: "team", id: "t1", label: "晨光隊", plan_id: PLAN_ID },
      { kind: "team", id: "t2", label: "南風隊", plan_id: PLAN_ID }
    ]);
    expect(checks.grace).toMatchObject({ status: "fail", details: ["「約翰福音 21 天」：2026-11-21 截止；之後寫入 2 筆"] });
    expect(checks.chapter_totals).toMatchObject({ status: "warn", details: ["「約翰福音 21 天」：App 累積章數 45、計畫進度算 40（5 章不在這個計畫的書卷裡）"] });
  });

  it("登入身分：同一個會員中心 id 有別的帳號是錯誤、同 email 是提醒，都附連結", () => {
    const shared = byId(buildPersonReport(summary({ identities: { count: 1, shared_member_id: [{ id: OTHER_ID, name: "丙（舊）" }], shared_email: [] } }), LATEST)).identity;
    expect(shared).toMatchObject({ status: "fail", links: [{ kind: "user", id: OTHER_ID, label: "丙（舊）" }] });
    const email = byId(buildPersonReport(summary({ identities: { count: 2, shared_member_id: [], shared_email: [{ id: OTHER_ID, name: null }] } }), LATEST)).identity;
    expect(email).toMatchObject({ status: "warn", links: [{ kind: "user", id: OTHER_ID, label: "（未填姓名）" }] });
    expect(byId(buildPersonReport(summary({ identities: { count: 0, shared_member_id: [], shared_email: [] } }), LATEST)).identity.status).toBe("warn");
  });

  it("App 版本：只能從最近一次回報知道；比強制更新門檻舊是錯誤", () => {
    const facts = (buildId) => ({ last_report_build: buildId ? { build_id: buildId, reported_at: "2026-11-05T02:00:00Z" } : null });
    expect(appVersionCheck(facts(null), LATEST).status).toBe("unknown");
    expect(appVersionCheck(facts("20261101090000"), null).status).toBe("unknown");
    expect(appVersionCheck(facts("20261101090000"), LATEST).status).toBe("ok");
    expect(appVersionCheck(facts("20261020090000"), LATEST)).toMatchObject({
      status: "warn",
      details: ["最近一次回報（2026-11-05）時的版本：2026-10-20 09:00", "目前最新版本：2026-11-01 09:00"]
    });
    expect(appVersionCheck(facts("20261020090000"), { version: "20261101090000", minVersion: "20261025000000" }).status).toBe("fail");
    expect(formatBuildId("nope")).toBe("nope");
  });

  it("/version.json 的網址預設 staging，正式站靠 ADMIN_API_MEMBER_APP_URL 覆蓋；格式不對就退回預設（#609：不從 project ref 判斷）", () => {
    expect(memberAppOrigin()).toBe(MEMBER_APP_ORIGIN.staging);
    expect(memberAppOrigin("")).toBe(MEMBER_APP_ORIGIN.staging);
    expect(memberAppOrigin(MEMBER_APP_ORIGIN.production + "/")).toBe(MEMBER_APP_ORIGIN.production);
    expect(memberAppOrigin("https://preview.example.com/")).toBe("https://preview.example.com");
    expect(memberAppOrigin("javascript:alert(1)")).toBe(MEMBER_APP_ORIGIN.staging);
    expect(parseAppVersion({ version: "20261101090000", minVersion: "x" })).toEqual({ version: "20261101090000", minVersion: null });
    expect(parseAppVersion({ version: "latest" })).toBeNull();
  });
});

describe("會友 App 現在應該顯示", () => {
  it("用和計畫名單同一份規則算（同一份事實，結果一樣）", () => {
    const [shown] = buildPersonReport(summary(), LATEST).app_plans;
    const roster = buildPlanRoster(preparePlanReport({ resolved: resolvePlanForReport(PLAN_ROW), overview: appPlan().people }));
    const row = roster.people[0];
    expect(shown).toMatchObject({
      shown: true, enrolled: true,
      status_label: row.statusLabel, round: row.round, progress: row.progress, chapters: row.chapters,
      behind_days: row.behindDays, days_since_read: row.daysSinceRead
    });
    expect(shown).toMatchObject({ status_label: "落後 3天", round: 1, progress: 38, chapters: 8, care_reasons: ["4 天沒打卡"] });
    expect(shown.plan).toMatchObject({ id: PLAN_ID, name: "約翰福音 21 天", state: "running", total_days: 21, expected_days: 11 });
  });

  it("沒報名、帳號停用（App 進不去，名單不會列）分開標示", () => {
    const notEnrolled = buildPersonReport(summary({}, { app_plans: [appPlan(null)] }), LATEST).app_plans[0];
    expect(notEnrolled).toMatchObject({ shown: true, enrolled: false, status_label: "未報名" });
    const inactive = buildPersonReport(summary({}, {
      account: { id: USER_ID, is_active: false, role_code: "member" },
      app_plans: [{ plan: PLAN_ROW, people: { today: TODAY, people: [], meta: { inScope: 0, enrolled: 0 } } }]
    }), LATEST).app_plans[0];
    expect(inactive).toMatchObject({ shown: false, account_active: false, enrolled: false });
  });
});

// ── admin-api 流程 ─────────────────────────────────────────────────────────
function setup({ data = summary(), appVersion } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: "admin", is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_user_summary") return { data, error: null };
      return { data: null, error: { message: `unexpected ${fn}` } };
    }),
    appVersion,
    log: () => {}
  };
  return { deps, calls };
}
const post = (body) => new Request("https://example.supabase.co/functions/v1/admin-api", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://bible-speed-reading-admin.vercel.app", Authorization: "Bearer t", "x-request-id": "req-from-client-1" },
  body: JSON.stringify(body)
});
const json = async (response) => ({ status: response.status, body: await response.json() });

describe("admin-api user_summary", () => {
  it("一次 SQL（記 view_user），回判斷好的檢查與 App 應顯示", async () => {
    const appVersion = vi.fn(async () => LATEST);
    const { deps, calls } = setup({ appVersion });
    const res = await json(await handleAdminRequest(post({ action: "user_summary", params: { user_id: USER_ID, reason: "因回報 #9" } }), deps));
    expect(res.status).toBe(200);
    expect(calls.filter((call) => call.fn === "admin_api_user_summary")).toEqual([{ fn: "admin_api_user_summary", args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_user_id: USER_ID, p_reason: "因回報 #9", p_request_id: "req-from-client-1"
    } }]);
    expect(res.body.data.checks.find((check) => check.id === "app_version").status).toBe("ok");
    expect(res.body.data.app_plans).toHaveLength(1);
    expect(appVersion).toHaveBeenCalledTimes(1);
  });

  it("找不到人 404；版本讀不到不影響其他檢查", async () => {
    const missing = setup({ data: null });
    expect((await json(await handleAdminRequest(post({ action: "user_summary", params: { user_id: USER_ID } }), missing.deps)))).toMatchObject({ status: 404, body: { error: "user_not_found" } });
    const broken = setup({ appVersion: async () => { throw new Error("timeout"); } });
    const res = await json(await handleAdminRequest(post({ action: "user_summary", params: { user_id: USER_ID } }), broken.deps));
    expect(res.status).toBe(200);
    expect(res.body.data.checks.find((check) => check.id === "app_version").status).toBe("unknown");
  });

  it("新的稽核動作有中文名稱", () => {
    expect(AUDIT_ACTION_LABEL.view_user_section).toBeTruthy();
    expect(ADMIN_ACTIONS.user_summary.run).toBeTypeOf("function");
  });
});

// ── SQL ───────────────────────────────────────────────────────────────────
describe("migration（#567）", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_people.sql"));
  const sql = readMigration(file);
  const body = (fn) => latestFunctionDefinition(fn).text;

  it("每支函式都只給 service_role", () => {
    const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)].map((match) => match[1]);
    expect(fns).toEqual([
      "public._admin_api_section_items", "public.admin_api_user_section", "public.admin_api_user_timeline",
      "public.admin_api_user_summary", "public.admin_api_directory_rows", "public.admin_api_directory_list"
    ]);
    for (const fn of fns) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) TO service_role;`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*authenticated/);
  });

  it("點開某區的第一頁和時間軸在同一個交易記 view_user_section；載入更多不記", () => {
    for (const fn of ["admin_api_user_section", "admin_api_user_timeline"]) {
      expect(body(fn)).toMatch(/IF p_cursor_at IS NULL THEN\s+PERFORM audit\.record\('admin-api', 'view_user_section'/);
    }
    expect(body("admin_api_user_summary")).toContain("PERFORM audit.record('admin-api', 'view_user', 'ok'");
  });

  it("經文筆記只給筆數與最後更新時間，不給內容", () => {
    const summarySql = body("admin_api_user_summary");
    expect(summarySql).toContain("'verse_notes', (SELECT count(*) FROM public.verse_notes WHERE user_id = p_user_id)");
    expect(summarySql).not.toMatch(/verse_notes[^;]*content|devotional_notes[^;]*content/);
    expect(body("_admin_api_section_items")).not.toMatch(/verse_notes|devotional_notes/);
  });

  it("「App 應該顯示」只查這一個人的 plan_progress_people（範圍不是全教會）", () => {
    expect(body("admin_api_user_summary")).toContain("public.plan_progress_people(global_plan.id, picked.preset_key, FALSE, ARRAY[p_user_id], p_actor_id)");
  });

  it("名單用排序鍵游標，不用 OFFSET", () => {
    const list = body("admin_api_directory_list");
    expect(list).not.toMatch(/\bOFFSET\b/);
    expect(list).toContain("'sort_key', jsonb_build_array(numbered.sort_region, numbered.great_region, numbered.sort_zone, numbered.pastoral_zone, numbered.name, numbered.id)");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER);");
  });
});
