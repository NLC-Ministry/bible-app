// 稽核紀錄（#549）：audit schema 的 migration、nlc-data 管理寫入的補記。
// 權限與「只能新增」的實際行為已在 staging 以回滾交易驗過；這裡守住 migration 內容與補記邏輯。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigration, migrationFiles } from "./migration-sql.mjs";
import {
  AUDITED_ADMIN_RPCS,
  buildRpcAuditEvent,
  buildTableWriteAuditEvent,
  classifyFailure,
  diffFields,
  isAuditedTableWrite,
  resolveRequestId,
  rpcTarget,
  singleRowKey
} from "../supabase/functions/nlc-data/admin-audit.ts";

const migrationFile = migrationFiles().find((file) => file.endsWith("_admin_audit_events.sql"));
const sql = readMigration(migrationFile);
const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("audit migration", () => {
  it("keeps the table in its own schema that the API never exposes", () => {
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS audit;");
    expect(sql).toContain("REVOKE ALL ON SCHEMA audit FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS audit.admin_events");
    // 連 service_role 都不能直接讀寫資料表，只能經 audit.record()
    expect(sql).toContain("REVOKE ALL ON TABLE audit.admin_events FROM PUBLIC, anon, authenticated, service_role;");
    const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
    expect(config).not.toMatch(/^\s*schemas\s*=.*audit/m);
  });

  it("records who, what, result and source with checked values", () => {
    for (const column of ["request_id", "actor_id", "actor_role", "action", "resource", "target_user_id", "target_id", "changes", "result", "reason", "source"]) {
      expect(sql).toMatch(new RegExp(`\\n\\s+${column}\\s`));
    }
    expect(sql).toContain("CHECK (result IN ('ok', 'denied', 'error'))");
    expect(sql).toContain("CHECK (source IN ('admin-api', 'nlc-data'))");
  });

  it("is append-only: update/delete/truncate are blocked except the retention purge", () => {
    expect(sql).toMatch(/CREATE TRIGGER admin_events_append_only\s+BEFORE UPDATE OR DELETE ON audit\.admin_events/);
    expect(sql).toMatch(/CREATE TRIGGER admin_events_no_truncate\s+BEFORE TRUNCATE ON audit\.admin_events/);
    expect(sql).toContain("current_setting('audit.purging', true) = 'on'");
    expect(sql).toContain("PERFORM set_config('audit.purging', 'on', true);");
  });

  it("grants every function to service_role only", () => {
    const signatures = [
      "audit.record(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB)",
      "public.record_admin_audit_event(TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB)",
      "audit.purge_expired(INTERVAL)"
    ];
    for (const signature of signatures) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO[^;]*\b(anon|authenticated)\b/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION audit.block_admin_event_changes() FROM PUBLIC, anon, authenticated, service_role;");
  });

  it("keeps one year and purges weekly", () => {
    expect(sql).toContain("p_retention INTERVAL DEFAULT INTERVAL '1 year'");
    expect(sql).toContain("'audit-admin-events-weekly-purge'");
    expect(sql).toContain("'SELECT audit.purge_expired();'");
  });
});

describe("admin-audit helpers", () => {
  it("diffs only the fields that changed", () => {
    expect(diffFields({ name: "a", zone: "z" }, { name: "b", zone: "z", updated_at: "now" })).toEqual({ name: { before: "a", after: "b" } });
    expect(diffFields({ name: "a" }, { name: "a" })).toBeNull();
    expect(diffFields(null, { title: "公告" })).toEqual({ title: { after: "公告" } });
    expect(diffFields({ tags: ["a"] }, { tags: ["a"] })).toBeNull();
  });

  it("finds the single-row key (id, or key for feature settings)", () => {
    expect(singleRowKey("profiles", [{ type: "eq", column: "id", value: "u1" }])).toEqual({ column: "id", value: "u1" });
    expect(singleRowKey("app_feature_settings", [{ type: "eq", column: "key", value: "daily_quiz" }])).toEqual({ column: "key", value: "daily_quiz" });
    expect(singleRowKey("profiles", [{ type: "in", column: "id", value: ["a", "b"] }])).toBeNull();
    expect(singleRowKey("profiles", undefined)).toBeNull();
  });

  it("audits admin tables but not a member filing a report", () => {
    expect(isAuditedTableWrite("profiles", "update")).toBe(true);
    expect(isAuditedTableWrite("app_feature_settings", "upsert")).toBe(true);
    expect(isAuditedTableWrite("issue_reports", "update")).toBe(true);
    expect(isAuditedTableWrite("issue_reports", "insert")).toBe(false);
    expect(isAuditedTableWrite("reading_logs", "insert")).toBe(false);
    expect(isAuditedTableWrite("profiles", "select")).toBe(false);
  });

  it("picks target user and id from RPC args and drops the injected actor", () => {
    const target = rpcTarget({ p_profile_id: "11111111-1111-4111-8111-111111111111", p_actor_id: "x" });
    expect(target.targetUserId).toBe("11111111-1111-4111-8111-111111111111");
    expect(rpcTarget({ p_paper_id: "p1" }).targetId).toBe("p1");
    const event = buildRpcAuditEvent({ fn: "exam_publish", args: { p_paper_id: "p1", p_actor_id: "a" }, actor: { id: "a" }, roleCode: "admin", requestId: "req-12345678", result: "ok" });
    expect(event).toMatchObject({ p_action: "exam_publish", p_result: "ok", p_actor_id: "a", p_actor_role: "admin", p_target_id: "p1", p_request_id: "req-12345678" });
    expect(event.p_detail).toEqual({ args: { p_paper_id: "p1" } });
  });

  it("classifies SQL-side refusals as denied and everything else as error", () => {
    expect(classifyFailure({ code: "42501", message: "permission denied" })).toBe("denied");
    expect(classifyFailure({ message: "admin_required" })).toBe("denied");
    expect(classifyFailure({ message: "forbidden" })).toBe("denied");
    expect(classifyFailure({ code: "23505", message: "duplicate key" })).toBe("error");
  });

  it("keeps a well-formed request id and replaces a bad one", () => {
    expect(resolveRequestId("abc12345-def", () => "gen")).toBe("abc12345-def");
    expect(resolveRequestId("<script>", () => "gen")).toBe("gen");
    expect(resolveRequestId(null, () => "gen")).toBe("gen");
  });

  it("records a single-row update with before/after of changed fields only", () => {
    const event = buildTableWriteAuditEvent({
      table: "profiles", action: "update",
      filters: [{ type: "eq", column: "id", value: "11111111-1111-4111-8111-111111111111" }],
      payload: { managed_zones: "A,B", name: "王" },
      before: { managed_zones: "A", name: "王" },
      actor: { id: "admin-1" }, roleCode: "admin", requestId: "r-12345678", result: "ok"
    });
    expect(event.p_action).toBe("profiles.update");
    expect(event.p_target_user_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(event.p_changes).toEqual({ managed_zones: { before: "A", after: "A,B" } });
    expect(event.p_detail).toBeNull();
  });

  it("records a batch as conditions plus counts, not row by row", () => {
    const event = buildTableWriteAuditEvent({
      table: "global_plans", action: "upsert",
      filters: [], payload: [{ id: 1 }, { id: 2 }, { id: 3 }], before: null,
      actor: { id: "a" }, roleCode: "pastor", requestId: null, result: "ok", rowCount: 3
    });
    expect(event.p_changes).toBeNull();
    expect(event.p_detail).toEqual({ rows: 3, affected: 3 });

    const bulkUpdate = buildTableWriteAuditEvent({
      table: "church_announcements", action: "update",
      filters: [{ type: "eq", column: "is_published", value: true }], payload: { is_published: false }, before: null,
      actor: { id: "a" }, roleCode: "admin", requestId: null, result: "ok"
    });
    expect(bulkUpdate.p_detail).toEqual({ filters: [{ type: "eq", column: "is_published", value: true }] });
  });

  it("keeps the deleted row on a single-row delete", () => {
    const event = buildTableWriteAuditEvent({
      table: "church_announcements", action: "delete",
      filters: [{ type: "eq", column: "id", value: "n1" }], payload: undefined, before: { id: "n1", title: "舊公告" },
      actor: { id: "a" }, roleCode: "admin", requestId: null, result: "ok"
    });
    expect(event.p_changes).toEqual({ deleted: { id: "n1", title: "舊公告" } });
    expect(event.p_target_id).toBe("n1");
  });
});

describe("nlc-data wiring", () => {
  const rpcNames = new Set();
  for (const set of nlcData.matchAll(/const (\w+_RPC_FUNCTIONS) = new Set\(\[([\s\S]*?)\]\);/g)) {
    for (const name of set[2].matchAll(/"(\w+)"/g)) rpcNames.add(name[1]);
  }
  rpcNames.add("publish_global_plan_rules");

  it("only audits RPCs that nlc-data actually allows", () => {
    for (const name of AUDITED_ADMIN_RPCS) expect(rpcNames.has(name), name).toBe(true);
  });

  // 新增會改資料的管理 RPC 時，要嘛加進 AUDITED_ADMIN_RPCS，要嘛在這裡寫明為什麼不記
  const NOT_AUDITED = {
    create_reading_team: "會友自己建隊（隊伍有 0149 事件表）",
    exam_reset_my_rehearsal: "管理員重設自己的預演，不影響別人"
  };
  const MUTATOR_RE = /^(admin_(upsert|set|delete|save|import|publish|revoke|clear)_|exam_(upsert|delete|publish|set|reset|recompute|save_announcement|finalize|assign)|set_|issue_admin_set|publish_|resubmit_|create_|swap_)/;
  it("audits every admin RPC that changes data", () => {
    const missing = [...rpcNames].filter((name) => MUTATOR_RE.test(name) && !AUDITED_ADMIN_RPCS.has(name) && !NOT_AUDITED[name]);
    expect(missing).toEqual([]);
  });

  it("records denied for every role-guarded RPC refusal", () => {
    const rpcBlock = nlcData.slice(nlcData.indexOf('if (action === "rpc") {'), nlcData.indexOf("// ── batch:"));
    // 只剩「不在允許清單」那一行直接回 forbidden_rpc；權限不足的都經過 denyAdminRpc 記 denied
    expect(rpcBlock.match(/return jsonResponse\(\{ error: "forbidden_rpc" \}, 403\)/g)).toHaveLength(2);
    expect(rpcBlock).toContain('if (!RPC_FUNCTIONS.has(functionName)) return jsonResponse({ error: "forbidden_rpc" }, 403);');
    expect(rpcBlock.match(/return await denyAdminRpc\(\);/g)).toHaveLength(6);
  });

  it("records after the RPC and after admin table writes, with the request id", () => {
    expect(nlcData).toContain('const requestId = resolveRequestId(req.headers.get("x-request-id"), () => crypto.randomUUID());');
    expect(nlcData).toMatch(/const \{ data, error \} = await supabaseAdmin\.rpc\(rpcName, rpcArgs\);\n\s+if \(auditRpc\) \{/);
    expect(nlcData).toContain("const auditWrite = canAdminWrite && !canOwnWrite && isAuditedTableWrite(table, action);");
    expect(nlcData).toMatch(/const \{ data, error \} = await query;\n\s+if \(auditWrite\) \{/);
    expect(nlcData).toContain('supabaseAdmin.rpc("record_admin_audit_event", event)');
  });
});
