// #359 打卡模型 階段 6：計畫內 reading_logs 只能經 record/unrecord_chapter_read 寫入。
// migration（trigger＋旗標＋放行路徑＋權限）、nlc-data 擋直接寫、db.js 沒有直接寫表的退路、
// release-policy 強制舊版更新。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyReadingLogWrite,
  READING_LOG_PLAN_WRITE_ERROR
} from "../supabase/functions/nlc-data/reading-log-writes.ts";
import { readReleasePolicy, resolveMinVersion } from "./bundle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const migrations = readdirSync(join(root, "supabase/migrations"));
const migrationFile = migrations.find(name => name.endsWith("_plan_reading_logs_rpc_only.sql"));
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";
const baseFile = migrations.find(name => name.endsWith("_record_chapter_read.sql"));
const baseMigration = read(`supabase/migrations/${baseFile}`);
const nlcData = read("supabase/functions/nlc-data/index.ts");
const dbSource = read("js/db.js");
const pwaCoordinator = read("js/pwa/PwaCoordinator.js");

const FLAG_LINE = "  PERFORM set_config('app.check_in_rpc', 'on', true);\n\n";
const functionSource = (text, name) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const endMarker = `$${name}$;`;
  const end = text.indexOf(endMarker, start);
  return start >= 0 && end > start ? text.slice(start, end + endMarker.length) : "";
};

describe("migration: plan-bound reading_logs only through the check-in RPCs", () => {
  it("uses a timestamped name that sorts after #355", () => {
    expect(migrationFile).toMatch(/^\d{14}_plan_reading_logs_rpc_only\.sql$/);
    expect(migrationFile > baseFile).toBe(true);
  });

  it("re-creates record/unrecord exactly as #355 plus only the transaction-local flag", () => {
    for (const name of ["record_chapter_read", "unrecord_chapter_read"]) {
      const original = functionSource(baseMigration, name);
      const updated = functionSource(migration, name);
      expect(original, name).not.toBe("");
      expect(updated, name).toContain(FLAG_LINE);
      expect(updated.replace(FLAG_LINE, ""), name).toBe(original);
      // 旗標在碰 reading_logs 之前就設好
      expect(updated.indexOf("set_config('app.check_in_rpc'")).toBeLessThan(updated.indexOf("public.reading_logs"));
    }
  });

  it("keeps every function service_role-only (REVOKE FROM PUBLIC, anon, authenticated + minimal GRANT)", () => {
    for (const sig of [
      "record_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TEXT)",
      "unrecord_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)",
      "reset_plan_reading_logs(UUID, UUID)",
      "enforce_reading_log_check_in_rpc_only()"
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig}\n  FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig}\n  TO service_role;`);
    }
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*(anon|authenticated)/);
    expect(migration).toMatch(/has_function_privilege\('anon', fn::regprocedure, 'EXECUTE'\)/);
    expect(migration).toMatch(/has_function_privilege\('authenticated', fn::regprocedure, 'EXECUTE'\)/);
    expect(migration).toContain("'public.enforce_reading_log_check_in_rpc_only()'");
    expect(migration).toContain("'public.reset_plan_reading_logs(uuid, uuid)'");
  });

  it("adds a row-level BEFORE INSERT/UPDATE/DELETE trigger that rejects plan-bound rows without the flag", () => {
    expect(migration).toContain("CREATE TRIGGER trg_reading_logs_check_in_rpc_only\n  BEFORE INSERT OR UPDATE OR DELETE\n  ON public.reading_logs\n  FOR EACH ROW");
    const trigger = functionSource(migration, "enforce_reading_log_check_in_rpc_only");
    expect(trigger).toContain("v_plan_bound := NEW.plan_id IS NOT NULL;");
    expect(trigger).toContain("v_plan_bound := OLD.plan_id IS NOT NULL OR NEW.plan_id IS NOT NULL;");
    expect(trigger).toContain("v_plan_bound := OLD.plan_id IS NOT NULL;");
    expect(trigger).toContain("COALESCE(current_setting('app.check_in_rpc', true), '') <> 'on'");
    expect(trigger).toContain("RAISE EXCEPTION 'check_in_via_rpc_only'");
    expect(trigger).not.toContain("SECURITY DEFINER");
    // 自我檢查也確認 trigger 真的存在且啟用
    expect(migration).toContain("tgname = 'trg_reading_logs_check_in_rpc_only'");
  });

  it("exempts FK cascades (deletes only) and routes plan reset through its own flagged RPC", () => {
    const trigger = functionSource(migration, "enforce_reading_log_check_in_rpc_only");
    expect(trigger).toContain("AND NOT (TG_OP = 'DELETE' AND pg_trigger_depth() > 1)");
    const reset = functionSource(migration, "reset_plan_reading_logs");
    expect(reset).toContain("SECURITY DEFINER");
    expect(reset).toContain("SET search_path = ''");
    expect(reset).toContain("RAISE EXCEPTION 'not_owner'");
    expect(reset.indexOf("RAISE EXCEPTION 'not_owner'")).toBeLessThan(reset.indexOf("set_config('app.check_in_rpc'"));
    expect(reset).toContain("AND log.plan_id = p_plan_id;");
    // header 列出放行清單
    for (const text of ["ON DELETE CASCADE", "reset_plan_reading_logs", "0204", "set_config('app.check_in_rpc', 'on', true); 再寫"]) {
      expect(migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION")), text).toContain(text);
    }
  });
});

describe("nlc-data: direct reading_logs writes", () => {
  const body = extra => ({ table: "reading_logs", filters: [], ...extra });
  const eq = (column, value) => ({ type: "eq", column, value });
  const isNull = column => ({ type: "is", column, value: null });

  it("allows free reading (plan_id NULL) writes", () => {
    expect(classifyReadingLogWrite(body({ action: "insert", payload: { book: "詩篇", chapter: 23, plan_id: null } })).kind).toBe("free_reading");
    expect(classifyReadingLogWrite(body({ action: "insert", payload: { book: "詩篇", chapter: 23 } })).kind).toBe("free_reading");
    expect(classifyReadingLogWrite(body({ action: "upsert", payload: [{ plan_id: null }, { plan_id: "" }] })).kind).toBe("free_reading");
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [eq("book", "詩篇"), isNull("plan_id")] })).kind).toBe("free_reading");
    expect(classifyReadingLogWrite(body({ action: "update", payload: { read_at: "x" }, filters: [eq("id", "1"), isNull("plan_id")] })).kind).toBe("free_reading");
  });

  it("rejects plan-bound inserts/upserts/updates/deletes", () => {
    const P = "44444444-4444-4444-8444-444444444444";
    expect(classifyReadingLogWrite(body({ action: "insert", payload: { plan_id: P } })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "upsert", payload: [{ plan_id: null }, { plan_id: P }] })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "insert", payload: null })).kind).toBe("reject");
    // 沒有 plan_id IS NULL 篩選的 update/delete（例如 .eq("id", …)）一律擋
    expect(classifyReadingLogWrite(body({ action: "update", payload: { read_at: "x" }, filters: [eq("id", "1")] })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "update", payload: { plan_id: P }, filters: [eq("id", "1"), isNull("plan_id")] })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [eq("user_id", "u"), eq("plan_id", P), eq("book", "創世記")] })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [eq("book", "創世記")], or: `plan_id.eq.${P},plan_id.is.null` })).kind).toBe("reject");
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [] })).kind).toBe("reject");
  });

  it("turns the whole-plan delete (reset progress) into reset_plan_reading_logs", () => {
    const P = "44444444-4444-4444-8444-444444444444";
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [eq("user_id", "u"), eq("plan_id", P)] })))
      .toEqual({ kind: "reset_plan", planId: P });
    expect(classifyReadingLogWrite(body({ action: "delete", filters: [eq("user_id", "u"), eq("plan_id", P)], or: "x" })).kind).toBe("reject");
  });

  it("leaves selects and other tables alone", () => {
    expect(classifyReadingLogWrite(body({ action: "select", filters: [eq("plan_id", "p")] })).kind).toBe("not_reading_log_write");
    expect(classifyReadingLogWrite({ table: "highlights", action: "insert", payload: { plan_id: "p" } }).kind).toBe("not_reading_log_write");
  });

  it("index.ts rejects with check_in_via_rpc_only and calls the reset RPC with the verified profile id", () => {
    expect(READING_LOG_PLAN_WRITE_ERROR).toBe("check_in_via_rpc_only");
    expect(nlcData).toContain('import { classifyReadingLogWrite, READING_LOG_PLAN_WRITE_ERROR } from "./reading-log-writes.ts";');
    const start = nlcData.indexOf("const readingLogWrite = classifyReadingLogWrite(body);");
    const end = nlcData.indexOf("let query: any;", start);
    expect(start).toBeGreaterThan(nlcData.indexOf('return jsonResponse({ error: "forbidden" }, 403);'));
    expect(end).toBeGreaterThan(start);
    const guard = nlcData.slice(start, end);
    expect(guard).toContain('readingLogWrite.kind === "reject"');
    expect(guard).toContain("error: READING_LOG_PLAN_WRITE_ERROR");
    expect(guard).toContain("}, 403);");
    expect(guard).toContain('supabaseAdmin.rpc("reset_plan_reading_logs", {');
    expect(guard).toContain("p_user_id: profile.id,");
    // reset 不在 client 可呼叫的 RPC 白名單裡
    expect(nlcData).not.toMatch(/RPC_FUNCTIONS = new Set\(\[[^\]]*"reset_plan_reading_logs"/);
  });
});

describe("frontend: no plan-bound direct-write fallback", () => {
  it("db.js always sends plan check-ins through the RPC and never remembers 'unavailable'", () => {
    expect(dbSource).not.toContain("_checkInRpcUnavailable");
    const persist = dbSource.slice(dbSource.indexOf("async _persistChapterCheckIn"), dbSource.indexOf("// ── 打卡 outbox（#356）"));
    expect(persist).not.toContain("return false");
    expect(persist).not.toContain("checkInRpcUnavailable) return");
  });

  it("the legacy offline queue replays plan-bound items through the RPC", () => {
    const sync = pwaCoordinator.slice(pwaCoordinator.indexOf("async syncReadingOperation"), pwaCoordinator.indexOf("isNetworkFailure(error) {"));
    expect(sync).toContain("if (payload.planId) {");
    expect(sync).toContain("window.db._persistChapterCheckIn(");
    expect(sync.indexOf("window.db._persistChapterCheckIn(")).toBeLessThan(sync.indexOf("persistCheckedReadingLog("));
    expect(sync).toContain('error?.code === "CHECK_IN_REJECTED") error.status = 422');
    expect(sync).toContain("error?.checkInRpcUnavailable) error.status = 503");
  });
});

describe("release policy forces old builds to update", () => {
  it("sets a past cutoff with the +08:00 timezone, no earlier than this stack", () => {
    const policy = readReleasePolicy(root);
    expect(policy.forceUpdateBuiltBefore).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    expect(Date.parse(policy.forceUpdateBuiltBefore)).toBeGreaterThanOrEqual(Date.parse("2026-09-30T14:00:00+08:00"));
    const nowBuild = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    expect(resolveMinVersion(policy, nowBuild)).toMatch(/^\d{14}$/);
  });
});
