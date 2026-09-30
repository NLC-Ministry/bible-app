// #355 打卡規則集中到伺服器 RPC：record_chapter_read / unrecord_chapter_read
// migration 內容、nlc-data allowlist + 強制 user id、前端 db.js 接線與退回路徑。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECK_IN_REASONS,
  checkInReasonMessage,
  isCheckInRpcUnavailable,
  normalizeCheckInResult
} from "../js/data/check-in-reasons.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const migrationFile = readdirSync(join(root, "supabase/migrations"))
  .find(name => name.endsWith("_record_chapter_read.sql"));
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";
const nlcData = read("supabase/functions/nlc-data/index.ts");
const copy = read("js/copy/zh-Hant.js");

const functionBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = migration.indexOf(`$${name}$;`, start);
  return start >= 0 && end > start ? migration.slice(start, end) : "";
};

describe("migration: record_chapter_read / unrecord_chapter_read", () => {
  it("uses a timestamped file name", () => {
    expect(migrationFile).toMatch(/^\d{14}_record_chapter_read\.sql$/);
  });

  it("adds global_plans.grace_days (default 3, non-negative)", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS grace_days INTEGER NOT NULL DEFAULT 3");
    expect(migration).toContain("CHECK (grace_days >= 0)");
  });

  it("creates check_in_events with RLS on, no policies, no client grants", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.check_in_events");
    expect(migration).toContain("action TEXT NOT NULL CHECK (action IN ('record', 'unrecord'))");
    expect(migration).toContain("ON public.check_in_events (created_at)");
    expect(migration).toContain("ALTER TABLE public.check_in_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.check_in_events FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/CREATE POLICY[^;]*check_in_events/);
    expect(migration).not.toMatch(/GRANT[^;]*check_in_events[^;]*(anon|authenticated)/);
  });

  it("both functions are SECURITY DEFINER, empty search_path, service_role only", () => {
    for (const [name, sig] of [
      ["record_chapter_read", "(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TEXT)"],
      ["unrecord_chapter_read", "(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)"]
    ]) {
      const body = functionBody(name);
      expect(body, name).toContain("SECURITY DEFINER");
      expect(body, name).toContain("SET search_path = ''");
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}${sig}\n  FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${name}${sig}\n  TO service_role;`);
      expect(migration).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[^;]*authenticated`));
    }
    // 檔尾自我檢查：anon / authenticated 都不能執行
    expect(migration).toMatch(/has_function_privilege\('anon', fn::regprocedure, 'EXECUTE'\)/);
    expect(migration).toMatch(/has_function_privilege\('authenticated', fn::regprocedure, 'EXECUTE'\)/);
  });

  it("record enforces owner / stage / grace period / current round and is idempotent", () => {
    const body = functionBody("record_chapter_read");
    expect(body).toContain("'not_owner'");
    expect(body).toContain("'stage_not_open'");
    expect(body).toContain("public.is_campaign_stage_kind(v_global.plan_kind)");
    expect(body).toContain("'plan_closed'");
    expect(body).toContain("v_global.grace_days");
    expect(body).toContain("AT TIME ZONE 'Asia/Taipei'");
    expect(body).toContain("p_read_at > v_now + INTERVAL '5 minutes' THEN v_now");
    expect(body).toContain("'old_round'");
    expect(body).toContain("ON CONFLICT (user_id, plan_id, book, chapter, round) DO NOTHING");
    expect(body).toContain("'already_read'");
    expect(body).toContain("VALUES (p_user_id, p_plan_id, p_book, p_chapter, p_round, v_read_at)");
    expect(body).toContain("INSERT INTO public.check_in_events");
  });

  it("judges plan_closed by server time, never by the client-supplied p_read_at", () => {
    for (const name of ["record_chapter_read", "unrecord_chapter_read"]) {
      const body = functionBody(name);
      expect(body, name).toMatch(/AND \(v_now AT TIME ZONE 'Asia\/Taipei'\)::DATE\s+> v_end_date \+ COALESCE/);
      expect(body, name).not.toMatch(/\(v_read_at AT TIME ZONE/);
      expect(body, name).not.toMatch(/\(p_read_at AT TIME ZONE/);
    }
    expect(migration).toContain("伺服器時間（台北日期）晚於 max(個人計畫迄日, 全教會計畫迄日) + grace_days");
  });

  it("clamps the stored read_at to [max(now-7d, plan start), now] and keeps the raw client value in events", () => {
    const body = functionBody("record_chapter_read");
    expect(body).toContain("ELSE LEAST(v_now, GREATEST(");
    expect(body).toContain("v_now - INTERVAL '7 days'");
    expect(body).toContain("v_enrollment.start_date::TIMESTAMP AT TIME ZONE 'Asia/Taipei'");
    expect(body).toContain("'record', v_ok, v_reason, p_client_id, p_read_at)");
  });

  it("does NOT check reading order (decision 5B)", () => {
    for (const name of ["record_chapter_read", "unrecord_chapter_read"]) {
      const body = functionBody(name).toLowerCase();
      expect(body, name).not.toContain("sequential");
      expect(body, name).not.toContain("previous chapter");
      expect(body, name).not.toMatch(/log\.chapter\s*[<>]/);
    }
  });

  it("unrecord applies owner / grace / round rules, deletes one row and logs the event", () => {
    const body = functionBody("unrecord_chapter_read");
    expect(body).toContain("'not_owner'");
    expect(body).toContain("'plan_closed'");
    expect(body).toContain("'old_round'");
    expect(body).toContain("DELETE FROM public.reading_logs log");
    expect(body).toContain("'already_unread'");
    expect(body).toContain("'unrecord', v_ok, v_reason");
  });
});

describe("nlc-data allowlist", () => {
  it("allowlists both RPCs", () => {
    expect(nlcData).toMatch(/const CHECK_IN_RPC_FUNCTIONS = new Set\(\[\s*"record_chapter_read",\s*"unrecord_chapter_read"\s*\]\)/);
    expect(nlcData).toContain("...CHECK_IN_RPC_FUNCTIONS,");
  });

  it("forces p_user_id from the verified profile and drops unknown client args", () => {
    const start = nlcData.indexOf("if (CHECK_IN_RPC_FUNCTIONS.has(functionName)) {");
    const end = nlcData.indexOf("} else if (functionName === \"get_org_structure_tree\")", start);
    expect(start).toBeGreaterThan(0);
    const branch = nlcData.slice(start, end);
    expect(branch).toContain("p_user_id: profile.id,");
    // p_user_id 在物件最後才設定，而且不是展開 body.args（client 帶的 p_user_id 不會留下）
    expect(branch).not.toContain("...(body.args");
    expect(branch).not.toMatch(/p_user_id:\s*clientArgs/);
    expect(branch.lastIndexOf("p_user_id")).toBeGreaterThan(branch.indexOf("p_client_id"));
  });
});

describe("check-in reason codes", () => {
  it("every reason has a zh-Hant string in APP_COPY", () => {
    for (const reason of Object.values(CHECK_IN_REASONS)) {
      expect(copy, reason).toMatch(new RegExp(`\\b${reason}: "`));
      expect(migration, reason).toContain(`'${reason}'`);
    }
  });

  it("messages prefer APP_COPY and fall back to built-in strings", () => {
    expect(checkInReasonMessage("plan_closed", { plan: { checkInReasons: { plan_closed: "X" } } })).toBe("X");
    expect(checkInReasonMessage("old_round", {})).toBe("這是已完成的舊一遍，不能再修改");
    expect(checkInReasonMessage("mystery", {})).toBe("進度沒同步成功，等一下再試試");
  });

  it("normalizes RPC payloads and detects an unavailable RPC", () => {
    expect(normalizeCheckInResult({ ok: true, reason: null })).toEqual({ ok: true, reason: null });
    expect(normalizeCheckInResult([{ ok: false, reason: "old_round" }])).toEqual({ ok: false, reason: "old_round" });
    expect(normalizeCheckInResult({})).toBeNull();
    expect(isCheckInRpcUnavailable({ error: "forbidden_rpc" })).toBe(true);
    expect(isCheckInRpcUnavailable({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isCheckInRpcUnavailable({ code: "42501", message: "permission denied for function record_chapter_read" })).toBe(true);
    expect(isCheckInRpcUnavailable({ message: "Failed to fetch" })).toBe(false);
  });
});

describe("db.js wiring", () => {
  const U = "33333333-3333-4333-8333-333333333333";
  const P = "44444444-4444-4444-8444-444444444444";
  let dom, db, rpc, from, fakeState;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    rpc = vi.fn(async () => ({ data: { ok: true, reason: null }, error: null }));
    from = vi.fn(() => { throw new Error("direct table write should not happen"); });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    fakeState = {
      isSupabaseMode: true,
      supabase: { rpc, from },
      supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
      currentUser: { id: U },
      readingLogs: [],
      activePlan: null
    };
    vi.stubGlobal("state", fakeState);
    await import("../js/db.js?record-chapter-read");
    db = dom.window.db || globalThis.db;
    db.getCurrentDbUser = async () => ({ id: U });
    db.calculateStreak = () => {};
    db.saveLocalUserStats = () => {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it("recordChapterRead calls the RPC without a client-side user id", async () => {
    const result = await db.recordChapterRead({
      planId: P, book: "創世記", chapter: "3", round: 1, readAt: "2026-09-30T01:00:00.000Z", clientId: "c1"
    });
    expect(result).toEqual({ ok: true, reason: null });
    expect(rpc).toHaveBeenCalledWith("record_chapter_read", {
      p_plan_id: P, p_book: "創世記", p_chapter: 3, p_round: 1,
      p_read_at: "2026-09-30T01:00:00.000Z", p_client_id: "c1"
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_user_id");
  });

  it("business rejections come back as { ok: false }, transport errors throw", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "plan_closed" }, error: null });
    await expect(db.unrecordChapterRead({ planId: P, book: "創世記", chapter: 3, round: 1 }))
      .resolves.toEqual({ ok: false, reason: "plan_closed" });
    rpc.mockResolvedValueOnce({ data: null, error: { error: "boom", code: "XX000" } });
    await expect(db.recordChapterRead({ planId: P, book: "創世記", chapter: 3, round: 1 })).rejects.toThrow("boom");
  });

  it("logChapterRead writes plan check-ins through the RPC only", async () => {
    const plan = { id: P, currentRound: 2 };
    await db.logChapterRead("創世記", 3, true, 2, plan);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("record_chapter_read");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_plan_id: P, p_book: "創世記", p_chapter: 3, p_round: 2 });
    expect(from).not.toHaveBeenCalled();
    expect(fakeState.readingLogs).toHaveLength(1);
  });

  it("logChapterRead turns a rejection into CHECK_IN_REJECTED with the zh-Hant reason", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "old_round" }, error: null });
    const error = await db.logChapterRead("創世記", 3, true, 1, { id: P, currentRound: 1 }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CHECK_IN_REJECTED");
    expect(error.reason).toBe("old_round");
    expect(error.message).toBe(checkInReasonMessage("old_round"));
    expect(from).not.toHaveBeenCalled();
  });

  it("#359: throws (no direct table write) when the RPC is not callable, and retries it next time", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { error: "forbidden_rpc" } });
    const error = await db.logChapterRead("創世記", 3, true, 1, { id: P, currentRound: 1 }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.checkInRpcUnavailable).toBe(true);
    expect(error.code).not.toBe("CHECK_IN_REJECTED");
    expect(from).not.toHaveBeenCalled();
    // 不記住「呼叫不到」：下一次照樣打 RPC（nlc-data 重新部署後不用重新整理）
    await db.logChapterRead("創世記", 4, true, 1, { id: P, currentRound: 1 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(from).not.toHaveBeenCalled();
  });

  it("free reading (no plan) keeps the direct table path", async () => {
    const calls = [];
    const builder = new Proxy({}, {
      get(_, key) {
        if (key === "then") return (resolve) => resolve({ data: null, error: null });
        return (...args) => { calls.push([key, ...args]); return builder; };
      }
    });
    from.mockImplementation(() => builder);
    await db.logChapterRead("詩篇", 23, true, 1, null);
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.some(([key]) => key === "insert")).toBe(true);
  });

  it("unchecking a plan chapter uses unrecord_chapter_read, then only clears the plan-less duplicate", async () => {
    const calls = [];
    const builder = new Proxy({}, {
      get(_, key) {
        if (key === "then") return (resolve) => resolve({ data: null, error: null });
        return (...args) => { calls.push([key, ...args]); return builder; };
      }
    });
    from.mockImplementation(() => builder);
    await db.logChapterRead("創世記", 3, false, 1, { id: P, currentRound: 1 });
    expect(rpc).toHaveBeenCalledWith("unrecord_chapter_read", expect.objectContaining({ p_plan_id: P, p_round: 1 }));
    expect(calls).toContainEqual(["is", "plan_id", null]);
    expect(calls.some(([key]) => key === "or")).toBe(false);
  });
});
