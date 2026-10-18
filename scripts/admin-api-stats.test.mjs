// 後台「報表」區（#568）的 admin-api：使用率整理規則和舊頁相同、參數檢查、匯出先記稽核、同步試算表的內容與稽核、
// migration 只授權 service_role。SQL 的實際數字由舊頁同一支函式產生（見 migration 檔頭），staging 對照舊頁驗收。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { latestFunctionDefinition, migrationFiles, readMigration } from "./migration-sql.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import {
  REGISTRATION_SUMMARY_ITEMS,
  buildHourProfile,
  buildL7,
  buildUsage,
  registrationCsv,
  runReadingUsage,
  runRegistrationExport,
  runRegistrationSheetSync,
  runRegistrationStats,
  sheetPayload,
  normalizeRegistrationStats,
  usageRange
} from "../supabase/functions/admin-api/stats.ts";
import {
  buildActivitySeries,
  buildHourProfile as legacyHourProfile,
  buildL7View,
  summarizeActivity
} from "../js/modules/admin-reading-activity.mjs";
import { REGISTRATION_SUMMARY_ITEMS as CONSOLE_SUMMARY_ITEMS } from "../admin/src/stats.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAN = "33333333-3333-4333-8333-333333333333";
const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-1" };

const RAW_DAYS = [
  { date: "2026-10-01", dau: 40, wau: 120, mau: 300, chapters: 95 },
  { date: "2026-10-02", dau: 0, wau: 110, mau: 0, chapters: 0 },
  { date: "2026-10-03", dau: 55, wau: 130, mau: 310, chapters: 160 }
];
const RAW_L7 = {
  current: { weekStart: "2026-09-28", weekEnd: "2026-10-04", coveredEnd: "2026-10-03", dayCount: 6, total: 10,
    buckets: [{ days: 1, users: 4 }, { days: 3, users: 5 }, { days: 6, users: 1 }] },
  previous: { weekStart: "2026-09-21", weekEnd: "2026-09-27", coveredEnd: "2026-09-27", dayCount: 7, total: 0, buckets: [] }
};
const RAW_HOURS = {
  cells: [
    { dow: 1, hour: 6, sumUsers: 30, sumChapters: 70 },
    { dow: 6, hour: 6, sumUsers: 8, sumChapters: 9 },
    { dow: 7, hour: 22, sumUsers: 5, sumChapters: 12 },
    { dow: 3, hour: 21, sumUsers: 7, sumChapters: 7 }
  ],
  dayCounts: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1 }
};

const STATS_ROW = {
  planId: PLAN,
  planName: "第一階段/秋季",
  summary: { withoutPastoralZoneNotJoined: 3, withoutPastoralZoneJoined: 1, withPastoralZoneNotJoined: 20, withPastoralZoneJoined: 30, totalJoined: 31, totalRegistered: 54 },
  greatRegions: [{ label: "北區", signupCount: 20, registeredCount: 30, team3Count: 6, team6Count: 12 }, { label: "未設定", signupCount: 1, registeredCount: 4, team3Count: 0, team6Count: 0 }],
  pastoralZones: [
    { label: "=北一", signupCount: 12, registeredCount: 18, team3Count: 3, team6Count: 6, leaderName: "王、李" },
    { label: "未設定牧區", signupCount: 1, registeredCount: 4, team3Count: 0, team6Count: 0, leaderName: "" }
  ]
};

function fakeRpc(results = {}) {
  const calls = [];
  const rpc = vi.fn(async (fn, args) => {
    calls.push({ fn, args });
    if (fn in results) return typeof results[fn] === "function" ? results[fn](args) : results[fn];
    if (fn === "admin_api_record_event") return { data: 7, error: null };
    return { data: null, error: null };
  });
  return { rpc, calls };
}

describe("讀經使用率：整理規則和舊頁相同", () => {
  it("days, the summary, L7 and the hour profile match js/modules/admin-reading-activity.mjs", () => {
    const usage = buildUsage({ from: "2026-10-01", to: "2026-10-03", today: "2026-10-03", days: RAW_DAYS, l7: RAW_L7, hours: RAW_HOURS });
    const legacySeries = buildActivitySeries(RAW_DAYS);
    expect(usage.days.map(({ chapters, ...rest }) => rest)).toEqual(legacySeries.map(({ label, ...rest }) => rest));
    expect(usage.days.map((day) => day.chapters)).toEqual([95, 0, 160]);
    const legacySummary = summarizeActivity(legacySeries);
    expect(usage.summary).toMatchObject({
      avgDau: legacySummary.avgDau, wau: legacySummary.latest.wau, mau: legacySummary.latest.mau,
      avgStickiness: legacySummary.avgStickiness, latestDate: "2026-10-03", totalChapters: 255, avgChapters: 85
    });
    const legacyL7 = buildL7View(RAW_L7);
    for (const which of ["current", "previous"]) {
      const { label, ...rest } = legacyL7[which];
      expect(usage.l7[which]).toEqual(rest);
    }
    for (const days of ["all", "weekday", "weekend"]) {
      const users = legacyHourProfile(RAW_HOURS, { metric: "users", days });
      const chapters = legacyHourProfile(RAW_HOURS, { metric: "chapters", days });
      expect(usage.hours[days]).toEqual({ dayCount: users.dayCount, users: users.hours.map((h) => h.value), chapters: chapters.hours.map((h) => h.value) });
    }
    expect(buildHourProfile(RAW_HOURS, "weekend").users[6]).toBe(4); // 8 人 ÷ 2 個週末天
  });

  it("survives empty or malformed data from SQL", () => {
    const usage = buildUsage(null);
    expect(usage.days).toEqual([]);
    expect(usage.summary).toMatchObject({ avgDau: null, wau: null, totalChapters: 0 });
    expect(usage.l7.current.rows).toHaveLength(7);
    expect(usage.hours.all).toEqual({ dayCount: 0, users: new Array(24).fill(0), chapters: new Array(24).fill(0) });
    expect(buildL7({ current: { total: 0, buckets: "nope" } }).current.rows.every((row) => row.pct === null)).toBe(true);
  });
});

describe("參數", () => {
  it("accepts real dates up to 180 days, from no later than to", () => {
    expect(usageRange({ from: "2026-04-19", to: "2026-10-15" })).toEqual({ ok: true, from: "2026-04-19", to: "2026-10-15" });
    expect(usageRange({ from: "2026-04-18", to: "2026-10-15" })).toEqual({ ok: false, error: "range_too_long" });
    expect(usageRange({ from: "2026-10-16", to: "2026-10-15" })).toEqual({ ok: false, error: "invalid_range" });
    expect(usageRange({ from: "2026-02-30", to: "2026-03-02" })).toEqual({ ok: false, error: "invalid_range" });
    expect(usageRange({ from: "2026-10-01" })).toEqual({ ok: false, error: "invalid_range" });
    expect(usageRange({ from: 20261001, to: "2026-10-02" })).toEqual({ ok: false, error: "invalid_range" });
  });

  it("declares capabilities, rate limits and SQL arguments", () => {
    expect(ADMIN_ACTIONS.reading_usage.capabilities).toEqual(["stats.read"]);
    expect(ADMIN_ACTIONS.registration_stats.capabilities).toEqual(["stats.read"]);
    expect(ADMIN_ACTIONS.registration_export.capabilities).toEqual(["stats.read", "export"]);
    expect(ADMIN_ACTIONS.registration_sheet_sync.capabilities).toEqual(["stats.read", "export"]);
    expect(ADMIN_ACTIONS.registration_export.rateLimit.bucket).toBe("export");
    expect(ADMIN_ACTIONS.registration_sheet_sync.rateLimit).toEqual({ bucket: "sheet", limit: 10, windowSeconds: 3600 });
    expect(ADMIN_ACTIONS.reading_usage.buildArgs({ from: "2026-10-01", to: "2026-10-03" }, ctx))
      .toEqual({ ok: true, args: { p_actor_id: ADMIN_ID, p_from: "2026-10-01", p_to: "2026-10-03" } });
    expect(ADMIN_ACTIONS.registration_stats.buildArgs({}, ctx)).toEqual({ ok: true, args: { p_actor_id: ADMIN_ID, p_global_plan_id: null } });
    expect(ADMIN_ACTIONS.registration_stats.buildArgs({ global_plan_id: "x" }, ctx)).toEqual({ ok: false, error: "invalid_plan_id" });
    // 匯出與同步一定要指定計畫（看到哪一個就匯出哪一個）
    expect(ADMIN_ACTIONS.registration_export.buildArgs({}, ctx)).toEqual({ ok: false, error: "invalid_plan_id" });
    expect(ADMIN_ACTIONS.registration_sheet_sync.buildArgs({ global_plan_id: PLAN }, ctx))
      .toEqual({ ok: true, args: { p_actor_id: ADMIN_ID, p_actor_role: "admin", p_global_plan_id: PLAN, p_request_id: "req-1" } });
  });

  it("uses the same summary items in the console", () => {
    expect(CONSOLE_SUMMARY_ITEMS).toEqual(REGISTRATION_SUMMARY_ITEMS);
  });
});

describe("runners", () => {
  it("reading_usage shapes what SQL returns and maps a non-admin to 403", async () => {
    const { rpc, calls } = fakeRpc({ admin_api_reading_usage: { data: { from: "2026-10-01", to: "2026-10-03", days: RAW_DAYS, l7: RAW_L7, hours: RAW_HOURS }, error: null } });
    const args = { p_actor_id: ADMIN_ID, p_from: "2026-10-01", p_to: "2026-10-03" };
    const outcome = await runReadingUsage({ args, params: {}, ctx, rpc, storage: null });
    expect(outcome.ok && outcome.data.days).toHaveLength(3);
    expect(calls).toEqual([{ fn: "admin_api_reading_usage", args }]);
    const denied = fakeRpc({ admin_api_reading_usage: { data: null, error: { code: "42501", message: "forbidden" } } });
    expect(await runReadingUsage({ args, params: {}, ctx, rpc: denied.rpc, storage: null })).toEqual({ ok: false, status: 403, error: "forbidden" });
    const bad = fakeRpc({ admin_api_reading_usage: { data: null, error: { code: "22023", message: "range_too_long" } } });
    expect(await runReadingUsage({ args, params: {}, ctx, rpc: bad.rpc, storage: null })).toEqual({ ok: false, status: 400, error: "range_too_long" });
  });

  it("registration_stats brings the plan list and falls back to the default plan", async () => {
    const plans = [{ id: PLAN, name: "秋季" }, { id: OTHER_PLAN, name: "夏季" }];
    const { rpc, calls } = fakeRpc({
      admin_api_plan_options: { data: { plans, default_plan_id: PLAN }, error: null },
      admin_api_registration_stats: (args) => ({ data: { ...STATS_ROW, planId: args.p_global_plan_id }, error: null })
    });
    const outcome = await runRegistrationStats({ args: { p_actor_id: ADMIN_ID, p_global_plan_id: null }, params: {}, ctx, rpc, storage: null });
    expect(outcome.ok).toBe(true);
    expect(outcome.data.plans).toEqual(plans);
    expect(outcome.data.planId).toBe(PLAN);
    expect(outcome.data.stats.planName).toBe("第一階段/秋季");
    // 牧區列帶牧區長；大區列沒有
    expect(outcome.data.stats.pastoralZones[0]).toEqual({ label: "=北一", signupCount: 12, registeredCount: 18, team3Count: 3, team6Count: 6, leaderName: "王、李" });
    expect(calls.map((call) => call.fn)).toEqual(["admin_api_plan_options", "admin_api_registration_stats"]);
    expect(calls[1].args).toEqual({ p_actor_id: ADMIN_ID, p_global_plan_id: PLAN });

    const picked = await runRegistrationStats({ args: { p_actor_id: ADMIN_ID, p_global_plan_id: OTHER_PLAN }, params: {}, ctx, rpc, storage: null });
    expect(picked.data.planId).toBe(OTHER_PLAN);

    const none = fakeRpc({ admin_api_plan_options: { data: { plans: [], default_plan_id: null }, error: null } });
    expect(await runRegistrationStats({ args: { p_actor_id: ADMIN_ID, p_global_plan_id: null }, params: {}, ctx, rpc: none.rpc, storage: null }))
      .toEqual({ ok: true, data: { plans: [], planId: null, stats: null } });
    expect(none.calls.map((call) => call.fn)).toEqual(["admin_api_plan_options"]);

    const missing = fakeRpc({ admin_api_plan_options: { data: { plans, default_plan_id: PLAN }, error: null } });
    expect(await runRegistrationStats({ args: { p_actor_id: ADMIN_ID, p_global_plan_id: OTHER_PLAN }, params: {}, ctx, rpc: missing.rpc, storage: null }))
      .toEqual({ ok: false, status: 404, error: "plan_not_found" });
  });

  it("registration_export records the export first and builds the same CSV as the old page", async () => {
    const { rpc, calls } = fakeRpc({ admin_api_registration_stats: { data: STATS_ROW, error: null } });
    const args = { p_actor_id: ADMIN_ID, p_actor_role: "admin", p_global_plan_id: PLAN, p_request_id: "req-1" };
    const outcome = await runRegistrationExport({ args, params: {}, ctx, rpc, storage: null });
    expect(outcome.ok).toBe(true);
    expect(outcome.data.filename).toMatch(/^報名與註冊統計-第一階段-秋季-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(outcome.data.rows).toBe(4);
    const csv = outcome.data.csv;
    expect(csv).toContain('"統計項目","人數"');
    expect(csv).toContain('"無牧區資料未加入計畫","3"');
    expect(csv).toContain('"總註冊人數","54"');
    expect(csv).toContain('"大區","報名人數","註冊人數","3 人團隊人數","6 人團隊人數"');
    expect(csv).toContain('"北區","20","30","6","12"');
    // 會被 Excel 當公式的名稱前面加 '
    expect(csv).toContain(`"'=北一","12","18","3","6"`);
    expect(csv).not.toContain("王、李"); // 牧區長只給試算表，不進 CSV（同舊頁）
    expect(calls.at(-1)).toEqual({ fn: "admin_api_record_event", args: {
      p_action: "export", p_result: "ok", p_actor_id: ADMIN_ID, p_actor_role: "admin", p_resource: "global_plans",
      p_target_user_id: null, p_reason: null, p_request_id: "req-1",
      p_detail: { kind: "registration_stats", global_plan_id: PLAN, plan_name: "第一階段/秋季", rows: 4 }
    } });

    const failing = fakeRpc({ admin_api_registration_stats: { data: STATS_ROW, error: null }, admin_api_record_event: { data: null, error: { message: "boom" } } });
    const refused = await runRegistrationExport({ args, params: {}, ctx, rpc: failing.rpc, storage: null });
    expect(refused).toMatchObject({ ok: false, status: 500 });
    expect(JSON.stringify(refused)).not.toContain("北區");
  });

  it("registration_sheet_sync sends the nlc-data payload shape and records the result", async () => {
    const args = { p_actor_id: ADMIN_ID, p_actor_role: "admin", p_global_plan_id: PLAN, p_request_id: "req-1" };
    const stats = normalizeRegistrationStats(STATS_ROW);
    expect(sheetPayload(stats)).toEqual({
      planName: "第一階段/秋季",
      greatRegions: [
        { label: "北區", signupCount: 20, registeredCount: 30, team3Count: 6, team6Count: 12 },
        { label: "未設定", signupCount: 1, registeredCount: 4, team3Count: 0, team6Count: 0 }
      ],
      pastoralZones: [
        { label: "=北一", signupCount: 12, registeredCount: 18, team3Count: 3, team6Count: 6, leaderName: "王、李" },
        { label: "未設定牧區", signupCount: 1, registeredCount: 4, team3Count: 0, team6Count: 0, leaderName: "" }
      ],
      summary: STATS_ROW.summary
    });

    const ok = fakeRpc({ admin_api_registration_stats: { data: STATS_ROW, error: null } });
    const sheetSync = vi.fn(async () => ({ ok: true }));
    expect(await runRegistrationSheetSync({ args, params: {}, ctx, rpc: ok.rpc, storage: null, sheetSync }))
      .toEqual({ ok: true, data: { synced: true, planName: "第一階段/秋季" } });
    expect(sheetSync).toHaveBeenCalledWith(sheetPayload(stats));
    expect(ok.calls.at(-1).args).toMatchObject({ p_action: "sync_registration_stats_sheet", p_result: "ok", p_resource: "export", p_detail: { global_plan_id: PLAN } });

    const failed = fakeRpc({ admin_api_registration_stats: { data: STATS_ROW, error: null } });
    expect(await runRegistrationSheetSync({ args, params: {}, ctx, rpc: failed.rpc, storage: null, sheetSync: async () => ({ ok: false, error: "sheet_webhook_failed" }) }))
      .toEqual({ ok: false, status: 502, error: "sheet_sync_failed" });
    expect(failed.calls.at(-1).args).toMatchObject({ p_result: "error", p_detail: { error: "sheet_webhook_failed" } });

    const unconfigured = await runRegistrationSheetSync({ args, params: {}, ctx, rpc: ok.rpc, storage: null, sheetSync: async () => ({ ok: false, error: "server_not_configured" }) });
    expect(unconfigured).toMatchObject({ ok: false, status: 500, error: "admin_api_failed" });
    expect(await runRegistrationSheetSync({ args, params: {}, ctx, rpc: ok.rpc, storage: null })).toMatchObject({ ok: false, status: 500 });
  });

  it("is wired through the handler (the sheet dependency and the 502)", async () => {
    const calls = [];
    const deps = {
      env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: "admin-spa-client" })[key],
      verifyToken: async () => ({ ok: true, payload: { sub: "sub-1", client_id: "admin-spa-client" } }),
      rpc: async (fn, args) => {
        calls.push(fn);
        if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: "admin", is_active: true }, error: null };
        if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
        if (fn === "admin_api_registration_stats") return { data: STATS_ROW, error: null };
        return { data: 1, error: null };
      },
      sheetSync: vi.fn(async () => ({ ok: false, error: "sheet_webhook_unreachable" }))
    };
    const request = new Request("https://example.supabase.co/functions/v1/admin-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://bible-speed-reading-admin.vercel.app", Authorization: "Bearer t" },
      body: JSON.stringify({ action: "registration_sheet_sync", params: { global_plan_id: PLAN } })
    });
    const response = await handleAdminRequest(request, deps);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("sheet_sync_failed");
    expect(deps.sheetSync).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["admin_api_actor", "admin_api_take_rate_limit", "admin_api_registration_stats", "admin_api_record_event"]);
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_stats.sql"));
  const sql = readMigration(file);

  it("grants both functions to service_role only and checks the admin first", () => {
    for (const [name, signature] of [["admin_api_reading_usage", "uuid, date, date"], ["admin_api_registration_stats", "uuid, uuid"]]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`);
      expect(sql).not.toMatch(new RegExp(`GRANT[^;]*${name}[^;]*authenticated`));
      const body = latestFunctionDefinition(name).text;
      expect(body.indexOf("admin_api_assert_admin(p_actor_id)"), name).toBeGreaterThan(-1);
      expect(body).toMatch(/SET search_path = ''/);
    }
  });

  it("reuses the old page's functions, so the numbers have one definition", () => {
    const usage = latestFunctionDefinition("admin_api_reading_usage").text;
    for (const fn of ["admin_get_reading_activity(", "admin_get_reading_activity_l7(", "admin_get_reading_hour_heatmap("]) expect(usage).toContain(`public.${fn}`);
    // 每天章數和舊頁三支同樣的條件：有歸屬計畫、不算個人計畫
    expect(usage).toContain("log.plan_id IS NOT NULL");
    expect(usage).toContain("plan.is_personal");
    expect(usage).toMatch(/'range_too_long' USING ERRCODE = '22023'/);
    expect(latestFunctionDefinition("admin_api_registration_stats").text).toContain("public.get_admin_registration_statistics(p_global_plan_id, p_actor_id)");
  });

  it("is newer than the migrations it depends on", () => {
    const names = migrationFiles();
    const at = (suffix) => names.findIndex((name) => name.endsWith(suffix));
    for (const dep of ["_admin_api_plan_progress.sql", "_personal_reading_plans.sql", "_drop_profiles_is_demo.sql"]) {
      expect(at(dep), dep).toBeGreaterThan(-1);
      expect(at(dep), dep).toBeLessThan(at("_admin_api_stats.sql"));
    }
  });

  it("the console never sends numbers for the sheet (the server reads them itself)", () => {
    const view = readFileSync(new URL("../admin/src/views/StatsArea.tsx", import.meta.url), "utf8");
    expect(view).toMatch(/api\.call\("registration_sheet_sync", \{ global_plan_id: planId \}\)/);
  });
});
