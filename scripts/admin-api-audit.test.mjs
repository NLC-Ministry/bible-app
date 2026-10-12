// 後台稽核紀錄（#550 第四組）：admin-api 的 audit_list／audit_event／audit_export。
// 守住：能力、參數、動作的中文名稱涵蓋所有會寫進稽核的名稱、CSV、migration 的授權與「看不記、匯出記」。
// SQL 的實際行為（篩選與直接計數一致、分頁不重不漏、名字與角色、匯出稽核）在 staging 以回滾交易驗。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readMigration, migrationFiles } from "./migration-sql.mjs";
import { ADMIN_ACTIONS, CAPABILITIES, LEGACY_EXPORT_SECTIONS, capabilitiesForRole } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_LEGACY_SECTION_LABEL,
  AUDIT_TABLE_LABEL,
  auditActionLabel,
  auditCsv,
  auditEventLabel,
  auditFilters,
  runAuditEvent,
  runAuditExport,
  runAuditList
} from "../supabase/functions/admin-api/audit.ts";
import { AUDITED_ADMIN_RPCS, AUDITED_ADMIN_TABLES } from "../supabase/functions/nlc-data/admin-audit.ts";
import { LEGACY_SECTIONS } from "../admin/src/legacy.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CLIENT = "admin-spa-client";
const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-12345678" };
const build = (action, params) => ADMIN_ACTIONS[action].buildArgs(params, ctx);

describe("capabilities", () => {
  it("reading needs audit.read, exporting also needs export; only the admin has them", () => {
    expect(CAPABILITIES).toContain("audit.read");
    expect(CAPABILITIES).toContain("settings.manage");
    expect(ADMIN_ACTIONS.audit_list.capabilities).toEqual(["audit.read"]);
    expect(ADMIN_ACTIONS.audit_event.capabilities).toEqual(["audit.read"]);
    expect(ADMIN_ACTIONS.audit_export.capabilities).toEqual(["audit.read", "export"]);
    expect(ADMIN_ACTIONS.audit_export.rateLimit.bucket).toBe("export");
    for (const role of ["pastor", "great_zone_leader", "zone_leader", "group_leader", "member"]) {
      expect(capabilitiesForRole(role)).not.toContain("audit.read");
      expect(capabilitiesForRole(role)).not.toContain("settings.manage");
    }
  });

  it("asks for settings.manage to export from the copied settings page", () => {
    expect(LEGACY_EXPORT_SECTIONS.settings).toBe("settings.manage");
    expect(ADMIN_ACTIONS.legacy_export_audit.paramCapabilities({ section: "settings" })).toEqual(["settings.manage"]);
  });
});

describe("parameters", () => {
  it("defaults to the last 7 days with no other filter", () => {
    expect(build("audit_list", {})).toEqual({ ok: true, args: {
      p_days: 7, p_action: null, p_result: null, p_source: null, p_target_user_id: null, p_actor_id: null, p_cursor_id: null, p_limit: 50
    } });
  });

  it("maps every filter, lower-cases ids and turns the 'legacy' source into the database value", () => {
    expect(build("audit_list", {
      days: 30, action: "profiles.update", result: "denied", source: "legacy",
      actor_id: ADMIN_ID.toUpperCase(), target_user_id: USER_ID, cursor: 12345, limit: 20
    })).toEqual({ ok: true, args: {
      p_days: 30, p_action: "profiles.update", p_result: "denied", p_source: "nlc-data", p_target_user_id: USER_ID,
      p_actor_id: ADMIN_ID, p_cursor_id: 12345, p_limit: 20
    } });
    expect(build("audit_list", { source: "admin-api", action: "" }).args).toMatchObject({ p_source: "admin-api", p_action: null });
  });

  it("rejects anything outside the allowed values", () => {
    for (const [params, error] of [
      [{ days: 3 }, "invalid_days"],
      [{ days: "7" }, "invalid_days"],
      [{ days: 0 }, "invalid_days"],
      [{ result: "maybe" }, "invalid_result"],
      [{ source: "nlc-data" }, "invalid_source"],
      [{ source: "toString" }, "invalid_source"],
      [{ action: "drop table; --" }, "invalid_action_filter"],
      [{ action: "x".repeat(101) }, "invalid_action_filter"],
      [{ action: 5 }, "invalid_action_filter"],
      [{ actor_id: "not-a-uuid" }, "invalid_user_id"],
      [{ target_user_id: "x" }, "invalid_user_id"],
      [{ cursor: 0 }, "invalid_cursor"],
      [{ cursor: 1.5 }, "invalid_cursor"],
      [{ cursor: "12" }, "invalid_cursor"],
      [{ limit: 51 }, "invalid_limit"]
    ]) {
      expect(build("audit_list", params), JSON.stringify(params)).toEqual({ ok: false, error });
    }
    expect(build("audit_event", { id: 9 })).toEqual({ ok: true, args: { p_id: 9 } });
    expect(build("audit_event", {})).toEqual({ ok: false, error: "invalid_event_id" });
    expect(build("audit_event", { id: -1 })).toEqual({ ok: false, error: "invalid_event_id" });
    expect(build("audit_event", { id: Number.MAX_SAFE_INTEGER + 1 })).toEqual({ ok: false, error: "invalid_event_id" });
  });

  it("exports with the exporting admin as the actor and the actor filter under its own name", () => {
    expect(build("audit_export", { days: 90, actor_id: USER_ID, result: "error" })).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin",
      p_days: 90, p_action: null, p_result: "error", p_source: null, p_target_user_id: null,
      p_filter_actor_id: USER_ID, p_request_id: "req-12345678"
    } });
    expect(auditFilters({ days: 365 })).toMatchObject({ ok: true });
  });
});

describe("action names in Chinese", () => {
  const migrationSql = migrationFiles().map(readMigration).join("\n");

  it("covers every name that can end up in audit.admin_events", () => {
    const names = new Set([
      ...AUDITED_ADMIN_RPCS,
      // admin-api 的 SQL 函式
      ...[...migrationSql.matchAll(/audit\.record\('admin-api', '([a-z_.]+)'/g)].map((m) => m[1]),
      ...[...migrationSql.matchAll(/'(report\.[a-z_]+)'/g)].map((m) => m[1]),
      // admin-api 擋下的請求用 action 名稱
      ...Object.keys(ADMIN_ACTIONS),
      "unknown",
      // nlc-data 自己記的
      ...[...readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8").matchAll(/p_action: "([a-z_.]+)"/g)].map((m) => m[1])
    ]);
    expect(names.size).toBeGreaterThan(60);
    for (const name of names) expect(Object.keys(AUDIT_ACTION_LABEL), name).toContain(name);
    for (const table of AUDITED_ADMIN_TABLES) {
      expect(AUDIT_TABLE_LABEL[table], table).toBeTruthy();
      for (const verb of ["insert", "update", "upsert", "delete"]) expect(auditActionLabel(`${table}.${verb}`), `${table}.${verb}`).not.toContain(".");
    }
  });

  it("names table writes, export kinds and copied sections; unknown names stay visible as they are", () => {
    expect(auditActionLabel("profiles.update")).toBe("修改會友資料");
    expect(auditActionLabel("church_announcements.delete")).toBe("刪除公告");
    expect(auditActionLabel("some_new_rpc")).toBe("some_new_rpc");
    expect(auditActionLabel("__proto__")).toBe("__proto__");
    expect(auditActionLabel("toString.update")).toBe("toString.update");
    expect(auditActionLabel(null)).toBe("—");
    expect(auditEventLabel({ action: "export", detail: { kind: "user_directory" } })).toBe("匯出使用者名單");
    expect(auditEventLabel({ action: "export", detail: { kind: "legacy", section: "exam" } })).toBe("匯出大測驗");
    expect(auditEventLabel({ action: "export", detail: { kind: "audit" } })).toBe("匯出稽核紀錄");
    expect(auditEventLabel({ action: "export", detail: null })).toBe("匯出");
    // 照搬區塊名稱和外殼同一份
    expect(Object.keys(AUDIT_LEGACY_SECTION_LABEL).sort()).toEqual(Object.keys(LEGACY_EXPORT_SECTIONS).sort());
    for (const section of LEGACY_SECTIONS) expect(AUDIT_LEGACY_SECTION_LABEL[section.id], section.id).toBe(section.label);
  });
});

describe("runners", () => {
  const rpcReturning = (data, error = null) => vi.fn(async () => ({ data, error }));

  it("adds the Chinese label and source name to every row and to the action options", async () => {
    const rpc = rpcReturning({
      items: [{ id: 3, action: "exam_publish", source: "nlc-data", detail: null }, { id: 2, action: "export", source: "admin-api", detail: { kind: "org_structure" } }],
      next_cursor: null, total: 2,
      facets: { actions: [{ action: "exam_publish", count: 1 }], actors: [] }
    });
    const out = await runAuditList({ args: { p_days: 7 }, params: {}, ctx, rpc, storage: null });
    expect(rpc).toHaveBeenCalledWith("admin_api_audit_list", { p_days: 7 });
    expect(out.data.items.map((row) => [row.label, row.source_label])).toEqual([["發布大測驗", "舊管理畫面"], ["匯出組織架構", "後台"]]);
    expect(out.data.facets.actions).toEqual([{ action: "exam_publish", count: 1, label: "發布大測驗" }]);
    // 第二頁沒有 facets
    const next = await runAuditList({ args: {}, params: {}, ctx, rpc: rpcReturning({ items: [], facets: null }), storage: null });
    expect(next.data.facets).toBeNull();
  });

  it("returns 404 for an event that no longer exists, and 400 for SQL parameter errors", async () => {
    expect(await runAuditEvent({ args: { p_id: 1 }, params: {}, ctx, rpc: rpcReturning(null), storage: null }))
      .toEqual({ ok: false, status: 404, error: "audit_event_not_found" });
    expect(await runAuditList({ args: {}, params: {}, ctx, rpc: rpcReturning(null, { code: "22023", message: "invalid_days" }), storage: null }))
      .toEqual({ ok: false, status: 400, error: "invalid_days" });
  });

  it("builds a CSV with Taipei times, names, neutralised formulas and a note for omitted content", async () => {
    const csv = auditCsv([
      {
        id: 7, occurred_at: "2026-10-12T02:05:00Z", source: "admin-api", action: "set_profile_managed_scopes",
        actor: { id: ADMIN_ID, name: "王管理" }, actor_role: "admin", actor_role_label: "系統管理員",
        target_user: { id: USER_ID, name: "=HYPERLINK(\"http://x\")" }, target_id: USER_ID, result: "ok",
        reason: "+因回報調整", changes: { managed_zones: { before: [], after: ["一牧區"] } }, detail: null, request_id: "adm-1",
        changes_omitted: false, detail_omitted: false
      },
      { id: 6, occurred_at: "2026-10-11T16:00:00Z", source: "nlc-data", action: "profiles.update", actor: null, result: "denied", changes: null, changes_omitted: true, detail: null, detail_omitted: false }
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("\"時間\",\"來源\",\"操作者\",\"操作者角色\",\"動作\",\"動作代碼\",\"對象\",\"對象編號\",\"結果\",\"理由\",\"變更內容\",\"補充資訊\",\"請求編號\",\"紀錄編號\"");
    expect(lines[1]).toContain("\"2026-10-12 10:05\",\"後台\",\"王管理\",\"系統管理員\",\"設定管理範圍\"");
    expect(lines[1]).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(lines[1]).toContain("\"'+因回報調整\"");
    expect(lines[1]).toContain("\"{\"\"managed_zones\"\":{\"\"before\"\":[],\"\"after\"\":[\"\"一牧區\"\"]}}\"");
    expect(lines[2]).toContain("\"2026-10-12 00:00\",\"舊管理畫面\",\"\",\"\",\"修改會友資料\"");
    expect(lines[2]).toContain("\"被拒絕\",\"\",\"（內容過長，請到後台看第 6 筆）\",\"\"");

    const out = await runAuditExport({ args: {}, params: {}, ctx, rpc: rpcReturning({ rows: [], total: 0, truncated: false }), storage: null });
    expect(out.data).toMatchObject({ rows: 0, total: 0, truncated: false });
    expect(out.data.filename).toMatch(/^稽核紀錄_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(out.data.csv.split("\r\n")[0]).toContain("匯出時間（台灣時間）");
  });

  it("goes through the handler: the admin gets labelled rows", async () => {
    const calls = [];
    const deps = {
      env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
      verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
      rpc: vi.fn(async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: "admin", is_active: true }, error: null };
        if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
        if (fn === "admin_api_audit_list") return { data: { items: [{ id: 1, action: "view_user", source: "admin-api" }], facets: null }, error: null };
        return { data: null, error: null };
      }),
      log: () => {},
      randomId: () => "generated-request-id"
    };
    const response = await handleAdminRequest(new Request("https://example.supabase.co/functions/v1/admin-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://bible-speed-reading-admin.vercel.app", Authorization: "Bearer token-abc" },
      body: JSON.stringify({ action: "audit_list", params: { days: 1 } })
    }), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).data.items[0]).toMatchObject({ label: "查看使用者", source_label: "後台" });
    expect(calls.find((call) => call.fn === "admin_api_audit_list").args).toMatchObject({ p_days: 1 });
    // 看清單不記稽核
    expect(calls.map((call) => call.fn)).not.toContain("admin_api_record_event");
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_audit.sql"));
  const sql = readMigration(file);
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  const body = (fn) => sql.slice(sql.indexOf(`FUNCTION public.${fn}(`), sql.indexOf(`$${fn}$;`));

  it("grants every function to service_role only", () => {
    expect(fns).toEqual(["_admin_api_audit_json", "admin_api_audit_list", "admin_api_audit_event", "admin_api_audit_export"]);
    for (const fn of fns) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*(authenticated|anon)\s*;/);
  });

  it("does not record reading the list, records the export, and never writes to the audit table directly", () => {
    expect(body("admin_api_audit_list")).toContain("STABLE");
    expect(body("admin_api_audit_list")).not.toContain("audit.record(");
    expect(body("admin_api_audit_event")).not.toContain("audit.record(");
    expect(body("admin_api_audit_export")).toContain("PERFORM audit.record('admin-api', 'export', 'ok'");
    expect(body("admin_api_audit_export")).toContain("'kind', 'audit'");
    expect(sql).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+audit\.admin_events/);
    // 篩選值在 SQL 端再擋一次
    for (const fn of ["admin_api_audit_list", "admin_api_audit_export"]) {
      expect(body(fn), fn).toContain("RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023'");
      expect(body(fn), fn).toContain("p_source NOT IN ('admin-api', 'nlc-data')");
    }
  });
});
