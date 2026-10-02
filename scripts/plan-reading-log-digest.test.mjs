// #394：計畫統計／組員總覽的打卡紀錄改用 get_plan_reading_log_digest 一次回傳。
// 規則仍然在前端，所以新路徑（RPC）和舊路徑（分頁 reading_logs）還原出來的
// logsByUserId 必須逐筆相同（除了下游沒用到的 log id）。
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandReadingLogDigest, fetchPlanReadingLogs } from "../js/data/reading-log-batches.mjs";

const PLAN_A = "00000000-0000-0000-c126-000000202610";
const PLAN_B = "00000000-0000-0000-c126-000000202609";

const TABLES = {
  profiles: [
    { id: "u1", name: "甲", pastoral_zone: "牧區一" },
    { id: "u2", name: "乙", pastoral_zone: "牧區二" },
    { id: "u3", name: "丙", pastoral_zone: "牧區二" }
  ],
  reading_plans: [
    { id: "pA1", user_id: "u1", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 1 },
    { id: "pA2", user_id: "u2", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 2, upgrade_prompt_handled: true },
    { id: "pA3", user_id: "u3", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 1 },
    { id: "pB1", user_id: "u1", global_plan_id: PLAN_B, preset_key: null, name: "B", target_books: [], current_round: 1 }
  ],
  // id 故意跟 read_at、插入順序都不同，確認兩條路徑都照 id 排。
  reading_logs: [
    { id: "c", user_id: "u1", plan_id: "pA1", book: "利未記", chapter: 2, round: 1, read_at: "2026-10-02T01:00:00+00:00" },
    { id: "a", user_id: "u1", plan_id: "pA1", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T16:30:00+00:00" },
    { id: "f", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T02:00:00+00:00" },
    { id: "b", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 1, round: 2, read_at: "2026-10-01T03:00:00.123456+00:00" },
    { id: "e", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 3, round: 1, read_at: "2026-09-30T23:59:59+00:00" },
    { id: "d", user_id: "u1", plan_id: "pB1", book: "出埃及記", chapter: 1, round: 1, read_at: "2026-09-01T01:00:00+00:00" }
  ],
  devotional_notes: []
};

// 跟 SQL 相同的語意：plan_id = ANY、可見範圍、依 (user, plan) 分組、組內照 id 排。
function digestRpc(args) {
  const planIds = new Set(args.p_plan_ids || []);
  const visible = args.p_visible_ids ? new Set(args.p_visible_ids) : null;
  const groups = new Map();
  [...TABLES.reading_logs]
    .filter(log => planIds.has(log.plan_id) && (!visible || visible.has(log.user_id)))
    .sort((left, right) => (left.id < right.id ? -1 : 1))
    .forEach(log => {
      const key = `${log.user_id}|${log.plan_id}`;
      if (!groups.has(key)) groups.set(key, { u: log.user_id, p: log.plan_id, l: [] });
      groups.get(key).l.push([log.book, log.chapter, log.round, log.read_at]);
    });
  return [...groups.values()].sort((left, right) => `${left.u}|${left.p}` < `${right.u}|${right.p}` ? -1 : 1);
}

function createFakeSupabase(calls, { rpc = "digest" } = {}) {
  const client = {
    from(table) {
      const filters = [];
      let orderColumn = null;
      const builder = {
        select() { return builder; },
        order(column) { orderColumn = orderColumn || column; return builder; },
        eq(column, value) { filters.push(row => String(row[column]) === String(value)); return builder; },
        in(column, values) { filters.push(row => values.map(String).includes(String(row[column]))); return builder; },
        or(expression) {
          const conditions = expression.split(",").map(part => {
            const [column, , ...rest] = part.split(".");
            return [column, rest.join(".").replace(/^"|"$/g, "")];
          });
          filters.push(row => conditions.some(([column, value]) => String(row[column]) === value));
          return builder;
        },
        async range(from, to) {
          calls.push({ table, range: [from, to] });
          let rows = (TABLES[table] || []).filter(row => filters.every(test => test(row)));
          if (orderColumn) rows = [...rows].sort((left, right) => (String(left[orderColumn]) < String(right[orderColumn]) ? -1 : 1));
          return { data: rows.slice(from, to + 1), error: null };
        }
      };
      return builder;
    }
  };
  if (rpc === "digest") {
    client.rpc = async (name, args) => {
      calls.push({ rpc: name, args });
      return { data: digestRpc(args), error: null };
    };
  } else if (rpc === "error") {
    client.rpc = async name => {
      calls.push({ rpc: name });
      return { data: null, error: { message: "forbidden_rpc" } };
    };
  } else if (rpc === "throw") {
    client.rpc = async name => {
      calls.push({ rpc: name });
      throw new Error("network down");
    };
  }
  return client;
}

async function loadDb(client) {
  vi.resetModules();
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
  vi.stubGlobal("getPresetKeyByName", () => null);
  vi.stubGlobal("getUserRoleCode", () => "admin");
  vi.stubGlobal("state", {
    isSupabaseMode: true,
    supabase: client,
    currentUser: { id: "admin", name: "管理員" },
    activePlan: null,
    readingLogs: [],
    globalPlans: []
  });
  await import("../js/db.js?plan-reading-log-digest");
  return { dom, db: dom.window.db || globalThis.db };
}

const withoutIds = logsByUserId => Object.fromEntries(
  [...logsByUserId.entries()].map(([userId, logs]) => [userId, logs.map(({ id, ...rest }) => rest)])
);

describe("reading log digest gives the same logsByUserId as the paged path (#394)", () => {
  let dom;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (dom) dom.window.close();
    dom = null;
  });

  for (const filter of [PLAN_A, PLAN_B, null]) {
    it(`plan filter ${filter || "(all)"}`, async () => {
      const pagedCalls = [];
      const paged = await loadDb(createFakeSupabase(pagedCalls, { rpc: "none" }));
      dom = paged.dom;
      const oldResult = await paged.db.fetchMergedUsersWithLogs(filter, { ignorePlanFilter: !filter });
      vi.unstubAllGlobals();
      dom.window.close();

      const digestCalls = [];
      const digest = await loadDb(createFakeSupabase(digestCalls));
      dom = digest.dom;
      const newResult = await digest.db.fetchMergedUsersWithLogs(filter, { ignorePlanFilter: !filter });

      expect(digestCalls.filter(call => call.rpc)).toHaveLength(1);
      expect(digestCalls.some(call => call.table === "reading_logs")).toBe(false);
      expect(pagedCalls.some(call => call.table === "reading_logs")).toBe(true);
      expect(withoutIds(newResult.logsByUserId)).toEqual(withoutIds(oldResult.logsByUserId));
      expect(newResult.users).toEqual(oldResult.users);
    });
  }
});

describe("fetchPlanReadingLogs falls back to the paged query (#394)", () => {
  for (const mode of ["error", "throw", "none"]) {
    it(`when the RPC ${mode === "none" ? "is missing" : mode === "error" ? "returns an error" : "throws"}`, async () => {
      const calls = [];
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { data, error } = await fetchPlanReadingLogs(createFakeSupabase(calls, { rpc: mode }), ["pA1", "pA2"]);
      warn.mockRestore();
      expect(error).toBeNull();
      expect(data.map(log => log.id)).toEqual(["a", "b", "c", "e", "f"]);
      expect(calls.some(call => call.table === "reading_logs")).toBe(true);
    });
  }

  it("sends each plan id once and skips the call when there are none", async () => {
    const calls = [];
    await fetchPlanReadingLogs(createFakeSupabase(calls), ["pA1", "pA1", "", null, "pA2"]);
    expect(calls).toEqual([{ rpc: "get_plan_reading_log_digest", args: { p_plan_ids: ["pA1", "pA2"] } }]);
    expect(await fetchPlanReadingLogs(createFakeSupabase(calls), [])).toEqual({ data: [], error: null });
    expect(calls).toHaveLength(1);
  });

  it("expandReadingLogDigest keeps read_at untouched and ignores malformed groups", () => {
    expect(expandReadingLogDigest([
      { u: "u1", p: "pA1", l: [["利未記", 1, 1, "2026-10-01T16:30:00.5+00:00"], "bad"] },
      { p: "pA1", l: [["利未記", 2, 1, "x"]] },
      null
    ])).toEqual([
      { user_id: "u1", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T16:30:00.5+00:00", plan_id: "pA1" }
    ]);
  });
});

describe("get_plan_reading_log_digest is service_role-only and scoped by nlc-data (#394)", () => {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
  const migrationFile = readdirSync(migrationsDir).find(name => name.endsWith("_plan_reading_log_digest.sql"));
  const migration = migrationFile ? readFileSync(new URL(migrationFile, migrationsDir), "utf8") : "";
  const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");

  it("migration keeps every row, orders by id and only grants service_role", () => {
    expect(migration).toContain("json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id)");
    expect(migration).toContain("p_actor_id IS NOT NULL");
    expect(migration).toContain("(p_visible_ids IS NULL OR log.user_id = ANY (p_visible_ids))");
    expect(migration).not.toMatch(/DISTINCT|AT TIME ZONE/);
    expect(migration).toContain("SET search_path TO ''");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_plan_reading_log_digest(uuid[], uuid[], uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_plan_reading_log_digest(uuid[], uuid[], uuid) TO service_role;");
    expect(migration).not.toMatch(/GRANT[^;]*get_plan_reading_log_digest[^;]*\b(anon|authenticated)\b/);
  });

  it("nlc-data overrides p_visible_ids and p_actor_id with the caller's scope", () => {
    const start = nlcData.indexOf("} else if (functionName === PLAN_READING_LOG_DIGEST_RPC) {");
    expect(start).toBeGreaterThan(0);
    const branch = nlcData.slice(start, nlcData.indexOf("} else if", start + 10));
    expect(branch).toContain("await getVisibleProfileIds(supabaseAdmin, profile)");
    expect(branch).toContain("p_visible_ids: visibleIds === null ? null : (visibleIds.length ? visibleIds : [profile.id])");
    expect(branch).toContain("p_actor_id: profile.id");
    expect(branch).not.toContain("...(body.args");
    expect(nlcData).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*PLAN_READING_LOG_DIGEST_RPC,[\s\S]*\]\);/);
  });
});
