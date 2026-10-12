// @vitest-environment jsdom
// 後台帳號與權限（#550 第二組）：admin-api 的 directory_* / scope_* / org_export。
// SQL 的實際行為（篩選結果與直接計數一致、分頁不重複、管理範圍沿用 set_profile_managed_scopes 的檢查、
// 稽核同交易、授權只給 service_role）已在 staging 以回滾交易驗過；這裡守住參數、能力與 CSV。
import { describe, expect, it, vi } from "vitest";
import { readMigration, migrationFiles } from "./migration-sql.mjs";
import { ADMIN_ACTIONS } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { directoryCsv, formatTeams, orgCsv, withExportTime } from "../supabase/functions/admin-api/exports.ts";
import { directoryFilters } from "../supabase/functions/admin-api/accounts.ts";
import { convertUserDirectoryToCSV } from "../js/modules/admin.js";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "00000000-0000-0000-c126-000000202610";
const ADMIN_CLIENT = "admin-spa-client";
const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-12345678" };

function setup({ results = {}, role = "admin" } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: role, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event") return { data: 1, error: null };
      if (fn in results) return typeof results[fn] === "function" ? results[fn](args) : results[fn];
      return { data: { ok: fn }, error: null };
    }),
    log: () => {},
    randomId: () => "generated-request-id"
  };
  return { deps, calls };
}

function post(body) {
  return new Request("https://example.supabase.co/functions/v1/admin-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://bible-speed-reading-admin.vercel.app",
      Authorization: "Bearer token-abc",
      "x-request-id": "req-from-client-1"
    },
    body: JSON.stringify(body)
  });
}
const json = async (response) => ({ status: response.status, body: await response.json() });
const sqlCalls = (calls) => calls.filter((call) => !["admin_api_actor", "admin_api_take_rate_limit", "admin_api_record_event"].includes(call.fn));
const build = (action, params) => ADMIN_ACTIONS[action].buildArgs(params, ctx);

describe("capabilities", () => {
  it("reads need accounts.read, scope edits need accounts.write, the directory export needs full-PII rights", () => {
    expect(ADMIN_ACTIONS.directory_list.capabilities).toEqual(["accounts.read"]);
    expect(ADMIN_ACTIONS.scope_overview.capabilities).toEqual(["accounts.read"]);
    expect(ADMIN_ACTIONS.scope_set.capabilities).toEqual(["accounts.write"]);
    expect(ADMIN_ACTIONS.directory_export.capabilities).toEqual(["accounts.read", "export", "support.pii"]);
    expect(ADMIN_ACTIONS.org_export.capabilities).toEqual(["accounts.read", "export"]);
    expect(ADMIN_ACTIONS.scope_set.rateLimit.bucket).toBe("write");
    expect(ADMIN_ACTIONS.directory_export.rateLimit.bucket).toBe("export");
  });

  it("a non-admin role gets 403 and the SQL never runs", async () => {
    const { deps, calls } = setup({ role: "zone_leader" });
    const res = await json(await handleAdminRequest(post({ action: "directory_list", params: {} }), deps));
    expect(res.status).toBe(403);
    expect(sqlCalls(calls)).toEqual([]);
  });
});

describe("directory filters", () => {
  it("defaults and normalizes", () => {
    expect(build("directory_list", {})).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_q: null, p_regions: [], p_zones: [], p_groups: [], p_plan_id: null,
      p_participation: "all", p_team: "all", p_incomplete: false, p_offset: 0, p_limit: 50
    } });
    const args = build("directory_list", {
      q: "  王 ", regions: [" 大區 A ", "大區 A", "__unassigned__", ""], plan_id: PLAN_ID,
      participation: "not_joined", team: "joined", incomplete: true, offset: 50, limit: 20
    });
    expect(args).toMatchObject({ ok: true, args: {
      p_q: "王", p_regions: ["大區 A", "__unassigned__"], p_plan_id: PLAN_ID,
      p_participation: "not_joined", p_team: "joined", p_incomplete: true, p_offset: 50, p_limit: 20
    } });
  });

  it("rejects malformed filters", () => {
    expect(directoryFilters({ q: 1 })).toEqual({ ok: false, error: "invalid_query" });
    expect(directoryFilters({ q: "a".repeat(101) })).toEqual({ ok: false, error: "query_too_long" });
    expect(directoryFilters({ regions: "大區 A" })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(directoryFilters({ zones: [1] })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(directoryFilters({ groups: Array.from({ length: 201 }, (_, i) => `g${i}`) })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(directoryFilters({ plan_id: "plan-1" })).toEqual({ ok: false, error: "invalid_plan_id" });
    expect(directoryFilters({ participation: "maybe" })).toEqual({ ok: false, error: "invalid_plan_filter" });
    expect(directoryFilters({ incomplete: "yes" })).toEqual({ ok: false, error: "invalid_incomplete" });
    expect(build("directory_list", { offset: -1 })).toEqual({ ok: false, error: "invalid_offset" });
    expect(build("directory_list", { limit: 500 })).toEqual({ ok: false, error: "invalid_limit" });
  });

  it("sends the export the same filters plus the actor, never a page", () => {
    const args = build("directory_export", { regions: ["大區 A"], plan_id: PLAN_ID, offset: 100 });
    expect(args.ok && args.args).toEqual({
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_q: null, p_regions: ["大區 A"], p_zones: [], p_groups: [],
      p_plan_id: PLAN_ID, p_participation: "all", p_team: "all", p_incomplete: false, p_request_id: "req-12345678"
    });
  });
});

describe("scope_set", () => {
  it("validates the person and scope lists", () => {
    expect(build("scope_set", { profile_id: "x" })).toEqual({ ok: false, error: "invalid_user_id" });
    expect(build("scope_set", { profile_id: PROFILE_ID, zones: "一牧區" })).toEqual({ ok: false, error: "invalid_org_filter" });
    expect(build("scope_set", { profile_id: PROFILE_ID, zones: [" 一牧區 "], reason: "改派" })).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_profile_id: PROFILE_ID, p_regions: [], p_zones: ["一牧區"], p_groups: [],
      p_reason: "改派", p_request_id: "req-12345678"
    } });
  });

  it("maps SQL errors: unknown unit → 400, missing person → 404", async () => {
    const unknown = setup({ results: { admin_api_scope_set: { data: null, error: { code: "22023", message: "managed_scope_unknown_zone" } } } });
    expect(await json(await handleAdminRequest(post({ action: "scope_set", params: { profile_id: PROFILE_ID, zones: ["X"] } }), unknown.deps)))
      .toMatchObject({ status: 400, body: { error: "managed_scope_unknown_zone" } });
    const missing = setup({ results: { admin_api_scope_set: { data: null, error: null } } });
    expect(await json(await handleAdminRequest(post({ action: "scope_set", params: { profile_id: PROFILE_ID } }), missing.deps)))
      .toMatchObject({ status: 404, body: { error: "user_not_found" } });
  });
});

describe("exports", () => {
  const rows = [
    { name: "=HYPERLINK(\"x\")", email: "a@example.com", great_region: "大區 A", pastoral_zone: "一牧區", small_group: null,
      role_code: "group_leader", role_label: "小組長", is_active: true, teams: [{ name: "火箭隊", role: "captain" }, { name: "六人隊", role: "member" }] },
    { name: null, email: null, great_region: null, pastoral_zone: null, small_group: null, role_code: "member", role_label: null, is_active: false, teams: [] }
  ];

  it("builds the directory CSV like the App does (same columns, defaults, formula protection)", () => {
    const csv = directoryCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"大區","牧區","小組","姓名","電子信箱","角色","組隊狀態","帳號狀態"');
    expect(lines[1]).toBe('"大區 A","一牧區","未設定","\'=HYPERLINK(""x"")","a@example.com","小組長","[隊長] 火箭隊、六人隊","啟用中"');
    expect(lines[2]).toBe('"未設定","未設定牧區","未設定","未設定","","一般會友","未加入團隊 (個人速讀中)","已停用"');
    expect(formatTeams([{ name: "", role: "leader" }])).toBe("[隊長] 未命名隊伍");

    // 和 App 的 convertUserDirectoryToCSV 同一份資料比對（去掉匯出時間那列與換行差異）
    const app = convertUserDirectoryToCSV(rows.map((row) => ({
      ...row, role_definition: row.role_label ? { label: row.role_label, code: row.role_code } : null,
      team_name: formatTeams(row.teams) || null, member_role: null
    }))).split("\n").slice(1);
    const appSorted = [...app.slice(1)].sort();
    expect(lines[0].replace(/"/g, "")).toBe(app[0]); // App 的標題列沒加引號，解析結果相同
    expect([...lines.slice(1)].sort()).toEqual(appSorted);
  });

  it("prefixes the export time the way the App does", () => {
    const out = withExportTime("x", new Date("2026-10-12T01:05:00Z"));
    expect(out.split("\r\n")[0]).toBe('"匯出時間（台灣時間）","​2026-10-12 09:05"');
  });

  it("builds the org CSV", () => {
    expect(orgCsv([["北區", "一牧區", "喜樂小組"], ["南區", "無下屬牧區", "無下屬小組"]]).split("\r\n"))
      .toEqual(['"大區","牧區","小組"', '"北區","一牧區","喜樂小組"', '"南區","無下屬牧區","無下屬小組"']);
  });

  it("returns a named CSV file with counts", async () => {
    const { deps, calls } = setup({ results: { admin_api_directory_export: { data: { rows, total: 2, truncated: false, plan_name: "第四季" }, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "directory_export", params: { plan_id: PLAN_ID } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rows: 2, total: 2, truncated: false, plan_name: "第四季" });
    expect(res.body.data.filename).toMatch(/^使用者名單_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(res.body.data.csv).toContain('"大區","牧區","小組","姓名"');
    expect(sqlCalls(calls).map((call) => call.fn)).toEqual(["admin_api_directory_export"]);

    const org = setup({ results: { admin_api_org_export: { data: { rows: [["北區", "一牧區", "喜樂小組"]] }, error: null } } });
    const orgRes = await json(await handleAdminRequest(post({ action: "org_export", params: {} }), org.deps));
    expect(orgRes.body.data).toMatchObject({ rows: 1 });
    expect(orgRes.body.data.filename).toMatch(/^組織架構_/);
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_accounts.sql"));
  const sql = readMigration(file);
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);

  it("grants every function to service_role only", () => {
    expect(fns).toEqual(["admin_api_enrollment_plan_id", "admin_api_directory_rows", "admin_api_directory_list",
      "admin_api_directory_export", "admin_api_scope_overview", "admin_api_scope_set", "admin_api_org_export"]);
    for (const fn of fns) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
  });

  it("audits changes and exports inside the same function", () => {
    const body = (fn) => sql.slice(sql.indexOf(`FUNCTION public.${fn}(`), sql.indexOf(`$${fn}$;`));
    expect(body("admin_api_scope_set")).toContain("audit.record('admin-api', 'set_profile_managed_scopes'");
    expect(body("admin_api_scope_set")).toContain("public.set_profile_managed_scopes(");
    expect(body("admin_api_directory_export")).toContain("audit.record('admin-api', 'export'");
    expect(body("admin_api_org_export")).toContain("audit.record('admin-api', 'export'");
    // 讀的時候不回寫（App 的舊路徑會）
    expect(body("admin_api_scope_overview")).not.toMatch(/UPDATE|INSERT|set_profile_managed_scopes/);
  });
});
