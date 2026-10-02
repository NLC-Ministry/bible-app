// #369：成員名單和它的打卡紀錄必須來自同一個計畫。以前紀錄放在只有一份的
// state.allLogsCache，快取命中時不會更新：管理員看 A 計畫 → 切到 B 計畫的
// 統計 → 回到 A 的組員總覽，就會拿 B 的紀錄算 A 名單的連續天數與補讀天數。
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_A = "00000000-0000-0000-c126-000000202610";
const PLAN_B = "00000000-0000-0000-c126-000000202609";

const TABLES = {
  profiles: [
    { id: "u1", name: "甲", pastoral_zone: "牧區一" },
    { id: "u2", name: "乙", pastoral_zone: "牧區二" }
  ],
  reading_plans: [
    { id: "pA1", user_id: "u1", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 1 },
    { id: "pA2", user_id: "u2", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 1 },
    { id: "pB1", user_id: "u1", global_plan_id: PLAN_B, preset_key: null, name: "B", target_books: [], current_round: 1 }
  ],
  reading_logs: [
    { id: 1, user_id: "u1", plan_id: "pA1", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T01:00:00Z" },
    { id: 2, user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T02:00:00Z" },
    { id: 3, user_id: "u1", plan_id: "pB1", book: "出埃及記", chapter: 1, round: 1, read_at: "2026-09-01T01:00:00Z" },
    { id: 4, user_id: "u1", plan_id: "pB1", book: "出埃及記", chapter: 2, round: 1, read_at: "2026-09-02T01:00:00Z" }
  ],
  devotional_notes: []
};

// 只實作 fetchAllRows / fetchReadingLogsByPlanIds 用到的 PostgREST 子集。
function createFakeSupabase(calls) {
  return {
    from(table) {
      const filters = [];
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq(column, value) { filters.push(row => String(row[column]) === String(value)); calls.push({ table, eq: [column, value] }); return builder; },
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
          const rows = (TABLES[table] || []).filter(row => filters.every(test => test(row)));
          return { data: rows.slice(from, to + 1), error: null };
        }
      };
      return builder;
    }
  };
}

describe("merged users cache keeps users and logs of the same plan (#369)", () => {
  let dom, db, calls;

  beforeEach(async () => {
    vi.resetModules();
    calls = [];
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
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
      supabase: createFakeSupabase(calls),
      currentUser: { id: "admin", name: "管理員" },
      activePlan: null,
      readingLogs: [],
      globalPlans: []
    });
    await import("../js/db.js?merged-users-cache-scope");
    db = dom.window.db || globalThis.db;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  const logIds = (result, userId) => (result.logsByUserId.get(userId) || []).map(log => log.id);

  it("A → B → A returns A's own logs, even when A comes from the cache", async () => {
    const firstA = await db.fetchMergedUsersWithLogs(PLAN_A, { maxAgeMs: Infinity });
    expect(logIds(firstA, "u1")).toEqual([1]);

    const b = await db.fetchMergedUsersWithLogs(PLAN_B, { maxAgeMs: Infinity });
    expect(logIds(b, "u1")).toEqual([3, 4]);

    const secondA = await db.fetchMergedUsersWithLogs(PLAN_A, { maxAgeMs: Infinity });
    expect(secondA).toBe(firstA);
    expect(logIds(secondA, "u1")).toEqual([1]);
    expect(logIds(secondA, "u2")).toEqual([2]);
  });

  it("does not keep a shared logs global any more", async () => {
    await db.fetchMergedUsersWithLogs(PLAN_A);
    expect(globalThis.state.allLogsCache).toBeUndefined();
  });

  it("invalidateMergedUsersCache forces a real refetch inside the TTL", async () => {
    const first = await db.fetchMergedUsersWithLogs(PLAN_A);
    expect(await db.fetchMergedUsersWithLogs(PLAN_A)).toBe(first);
    db.invalidateMergedUsersCache();
    expect(await db.fetchMergedUsersWithLogs(PLAN_A)).not.toBe(first);
  });

  it("fetchMergedUsersList still returns just the user rows", async () => {
    const users = await db.fetchMergedUsersList(PLAN_A);
    expect(users.map(user => user.id).sort()).toEqual(["u1", "u2"]);
    expect(users.find(user => user.id === "u1").chapters_read).toBe(1);
  });

  it("pastoralZone filters profiles in the query and only fetches that zone's logs", async () => {
    const result = await db.fetchMergedUsersWithLogs(PLAN_A, { pastoralZone: "牧區二" });
    expect(calls).toContainEqual({ table: "profiles", eq: ["pastoral_zone", "牧區二"] });
    expect(result.users.map(user => user.id)).toEqual(["u2"]);
    expect([...result.logsByUserId.keys()]).toEqual(["u2"]);

    // 限定牧區的結果跟整份名單分開快取。
    const whole = await db.fetchMergedUsersWithLogs(PLAN_A);
    expect(whole.users).toHaveLength(2);
  });
});

describe("participants overview follows the selected management plan (#369)", () => {
  it("reads the plan from getOrgStatsContextPlan and users+logs from one cache entry", async () => {
    const { readFileSync } = await import("node:fs");
    const plan = readFileSync(new URL("../js/modules/plan.js", import.meta.url), "utf8");
    const start = plan.indexOf("async function renderGroupParticipantsRankingTable()");
    const fn = plan.slice(start, plan.indexOf("window.displayParticipantsList = function", start));
    expect(fn).toContain("const statsPlan = getOrgStatsContextPlan();");
    expect(fn).toContain("db.fetchMergedUsersWithLogs(statsKey, { maxAgeMs: Infinity })");
    expect(fn).not.toContain("allLogsCache");
    expect(fn).not.toContain("_cachedAllUsersList");
  });
});
