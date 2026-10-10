// #394：計畫統計／組員總覽的打卡紀錄改用 get_plan_reading_log_digest 一次回傳。
// #397：名單（profiles＋報名＋打卡＋今天的靈修）再改成 get_plan_stats_roster 一次回傳。
// 規則仍然在前端，所以新路徑（RPC）和舊路徑（分頁查詢）還原出來的
// users、logsByUserId、userPlanIdCache 必須逐筆相同（除了下游沒用到的 log id）。
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";
import {
  expandPlanStatsRoster,
  expandReadingLogDigest,
  fetchPlanReadingLogs,
  fetchPlanStatsRoster
} from "../js/data/reading-log-batches.mjs";
import {
  buildPlanReadingLogDigestArgs,
  buildPlanStatsRosterArgs,
  resolvePlanStatsScope
} from "../supabase/functions/nlc-data/plan-stats-scope.ts";

const PLAN_A = "00000000-0000-0000-c126-000000202610";
const PLAN_B = "00000000-0000-0000-c126-000000202609";
const TODAY = new Date()
  .toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
  .replace(/\//g, "-");
const ROLE_LEADER = { id: "r-zone", code: "zone_leader", label: "區長" };

// profiles 照 PostgREST 的樣子：每個欄位都有（沒有值就是 null）；舊路徑的假資料還多帶
// 下游沒用到的欄位。插入順序故意跟 id 不同，確認兩條路徑都照 id 排。
const TABLES = {
  profiles: [
    { id: "u3", name: "丙", email: "c@example.test", great_region: "大區一", pastoral_zone: "牧區二", small_group: "小組三", role_id: null, role_definition: null, managed_zones: "" },
    { id: "u1", name: "甲", email: "a@example.test", great_region: "大區一", pastoral_zone: "牧區一", small_group: "小組一", role_id: "r-zone", role_definition: ROLE_LEADER, managed_zones: "牧區一" },
    { id: "u2", name: "乙", email: null, great_region: "大區一", pastoral_zone: "牧區二", small_group: null, role_id: null, role_definition: null, managed_zones: "" },
    { id: "u4", name: "丁", email: null, great_region: null, pastoral_zone: null, small_group: null, role_id: null, role_definition: null, managed_zones: "" }
  ],
  reading_plans: [
    { id: "pA1", user_id: "u1", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 1, upgrade_prompt_handled: false },
    { id: "pA2", user_id: "u2", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: [], current_round: 2, upgrade_prompt_handled: true },
    { id: "pA3", user_id: "u3", global_plan_id: PLAN_A, preset_key: null, name: "A", target_books: ["利未記"], current_round: 1, upgrade_prompt_handled: false },
    { id: "pB1", user_id: "u1", global_plan_id: PLAN_B, preset_key: null, name: "B", target_books: [], current_round: 1, upgrade_prompt_handled: false },
    // 文字別名：用 preset_key／name 比對，沒有 global_plan_id。
    { id: "pK4", user_id: "u4", global_plan_id: null, preset_key: "2026-Q4", name: "第四季", target_books: [], current_round: 1, upgrade_prompt_handled: null },
    { id: "pK2", user_id: "u2", global_plan_id: null, preset_key: null, name: "2026-Q4", target_books: [], current_round: 1, upgrade_prompt_handled: false }
  ],
  // id 故意跟 read_at、插入順序都不同，確認兩條路徑都照 id 排。
  reading_logs: [
    { id: "c", user_id: "u1", plan_id: "pA1", book: "利未記", chapter: 2, round: 1, read_at: "2026-10-02T01:00:00+00:00" },
    { id: "a", user_id: "u1", plan_id: "pA1", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T16:30:00+00:00" },
    { id: "f", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 1, round: 1, read_at: "2026-10-01T02:00:00+00:00" },
    { id: "b", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 1, round: 2, read_at: "2026-10-01T03:00:00.123456+00:00" },
    { id: "e", user_id: "u2", plan_id: "pA2", book: "利未記", chapter: 3, round: 1, read_at: "2026-09-30T23:59:59+00:00" },
    { id: "d", user_id: "u1", plan_id: "pB1", book: "出埃及記", chapter: 1, round: 1, read_at: "2026-09-01T01:00:00+00:00" },
    { id: "g", user_id: "u3", plan_id: "pA3", book: "利未記", chapter: 4, round: 1, read_at: "2026-10-01T05:00:00+00:00" },
    { id: "h", user_id: "u4", plan_id: "pK4", book: "創世記", chapter: 1, round: 1, read_at: "2026-10-01T06:00:00+00:00" }
  ],
  // 同一個人同一天兩筆：照 id 排、後面覆蓋前面。
  devotional_notes: [
    { id: "n2", user_id: "u1", content: "後寫的", note_date: TODAY },
    { id: "n1", user_id: "u1", content: "先寫的", note_date: TODAY },
    { id: "n3", user_id: "u2", content: "乙的靈修", note_date: TODAY },
    { id: "n4", user_id: "u3", content: "昨天的", note_date: "2000-01-01" }
  ]
};

const UUID_LIKE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const byId = (left, right) => (left.id < right.id ? -1 : 1);

// 跟 SQL 相同的語意：plan_id = ANY、可見範圍、依 (user, plan) 分組、組內照 id 排。
function digestRpc(args) {
  const planIds = new Set(args.p_plan_ids || []);
  const visible = args.p_visible_ids ? new Set(args.p_visible_ids) : null;
  const groups = new Map();
  [...TABLES.reading_logs]
    .filter(log => planIds.has(log.plan_id) && (!visible || visible.has(log.user_id)))
    .sort(byId)
    .forEach(log => {
      const key = `${log.user_id}|${log.plan_id}`;
      if (!groups.has(key)) groups.set(key, { u: log.user_id, p: log.plan_id, l: [] });
      groups.get(key).l.push([log.book, log.chapter, log.round, log.read_at]);
    });
  return [...groups.values()].sort((left, right) => `${left.u}|${left.p}` < `${right.u}|${right.p}` ? -1 : 1);
}

// 跟 get_plan_stats_roster（全教會範圍）相同的語意：profiles／plans／notes 照 id 排；
// 計畫篩選比對 preset_key／name（文字）和 global_plan_id／id（像 uuid 的別名）；
// 有牧區時只留那些人的報名；notes 只留名單裡的人、當天的。
function rosterRpc(args) {
  const aliases = Array.isArray(args.p_plan_aliases) ? args.p_plan_aliases : null;
  const uuidAliases = new Set((aliases || []).filter(alias => UUID_LIKE.test(alias)).map(alias => alias.toLowerCase()));
  const zone = args.p_pastoral_zone || null;
  const profiles = TABLES.profiles
    .filter(profile => !zone || profile.pastoral_zone === zone)
    .sort(byId)
    .map(({ id, name, great_region, pastoral_zone, small_group, role_id, role_definition }) => (
      { id, name, great_region, pastoral_zone, small_group, role_id, role_definition }
    ));
  const rosterIds = new Set(profiles.map(profile => profile.id));
  const plans = TABLES.reading_plans
    .filter(plan => !zone || rosterIds.has(plan.user_id))
    .filter(plan => !aliases
      || aliases.includes(plan.preset_key)
      || aliases.includes(plan.name)
      || uuidAliases.has(String(plan.global_plan_id).toLowerCase())
      || uuidAliases.has(String(plan.id).toLowerCase()))
    .sort(byId);
  const notes = args.p_note_date
    ? TABLES.devotional_notes
      .filter(note => note.note_date === args.p_note_date && rosterIds.has(note.user_id))
      .sort(byId)
      .map(note => [note.user_id, note.content])
    : [];
  return { profiles, plans, logs: digestRpc({ p_plan_ids: plans.map(plan => plan.id) }), notes };
}

// rpc 模式：roster＝兩支 RPC 都有；digest＝get_plan_stats_roster 還沒部署（回錯誤），
// 只有 #394 那支；none＝沒有 rpc（舊分頁路徑）；malformed＝roster 回傳格式不對。
function createFakeSupabase(calls, { rpc = "roster" } = {}) {
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
          // 讓出一次，同時送出的查詢才會真的重疊（#397：profiles 和 reading_plans 同時抓）。
          await Promise.resolve();
          calls.push({ table, done: true });
          let rows = (TABLES[table] || []).filter(row => filters.every(test => test(row)));
          if (orderColumn) rows = [...rows].sort((left, right) => (String(left[orderColumn]) < String(right[orderColumn]) ? -1 : 1));
          return { data: rows.slice(from, to + 1), error: null };
        }
      };
      return builder;
    }
  };
  if (rpc === "roster" || rpc === "digest" || rpc === "malformed") {
    client.rpc = async (name, args) => {
      calls.push({ rpc: name, args });
      if (name === "get_plan_stats_roster") {
        if (rpc === "roster") return { data: rosterRpc(args), error: null };
        if (rpc === "malformed") return { data: { profiles: [] }, error: null };
        return { data: null, error: { message: "Could not find the function public.get_plan_stats_roster", code: "PGRST202" } };
      }
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
  vi.stubGlobal("BIBLE_BOOKS", [{ name: "創世記", chapters: 50 }, { name: "出埃及記", chapters: 40 }, { name: "利未記", chapters: 27 }]);
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

async function runMerged(rpc, filter, options = {}) {
  const calls = [];
  const loaded = await loadDb(createFakeSupabase(calls, { rpc }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await loaded.db.fetchMergedUsersWithLogs(filter, { ignorePlanFilter: !filter, ...options });
    return { calls, result, userPlanIdCache: { ...loaded.dom.window.userPlanIdCache } };
  } finally {
    warn.mockRestore();
    vi.unstubAllGlobals();
    loaded.dom.window.close();
  }
}

const withoutIds = logsByUserId => Object.fromEntries(
  [...logsByUserId.entries()].map(([userId, logs]) => [userId, logs.map(({ id, ...rest }) => rest)])
);

const COMPARE_CASES = [
  { label: `plan filter ${PLAN_A}`, filter: PLAN_A },
  { label: `plan filter ${PLAN_B}`, filter: PLAN_B },
  { label: "text alias filter 2026-Q4", filter: "2026-Q4" },
  { label: "no plan filter", filter: null },
  { label: "plan filter + pastoralZone", filter: PLAN_A, options: { pastoralZone: "牧區二" } },
  { label: "no plan filter + pastoralZone", filter: null, options: { pastoralZone: "牧區一" } }
];

describe("roster RPC, digest RPC and the paged path produce identical results (#394, #397)", () => {
  for (const { label, filter, options } of COMPARE_CASES) {
    it(label, async () => {
      const paged = await runMerged("none", filter, options);
      const digest = await runMerged("digest", filter, options);
      const roster = await runMerged("roster", filter, options);

      expect(paged.calls.some(call => call.table === "reading_logs")).toBe(true);
      // #394 路徑：roster 失敗後退回分頁 profiles／reading_plans，打卡走 digest。
      expect(digest.calls.filter(call => call.rpc).map(call => call.rpc))
        .toEqual(["get_plan_stats_roster", "get_plan_reading_log_digest"]);
      expect(digest.calls.some(call => call.table === "reading_logs")).toBe(false);
      // #397 路徑：只有一個請求，可見範圍參數不由前端帶。
      expect(roster.calls).toEqual([{
        rpc: "get_plan_stats_roster",
        args: {
          p_plan_aliases: filter ? [filter] : null,
          p_pastoral_zone: options?.pastoralZone || null,
          p_note_date: TODAY
        }
      }]);

      // 失敗時會退回只有自己（沒有 id）的 mockUser，那樣三條路徑也會「相同」，要先排除。
      expect(paged.result.users.length).toBeGreaterThan(0);
      expect(paged.result.users.every(user => user.id)).toBe(true);
      for (const other of [digest, roster]) {
        expect(other.result.users).toEqual(paged.result.users);
        expect(withoutIds(other.result.logsByUserId)).toEqual(withoutIds(paged.result.logsByUserId));
        expect(other.userPlanIdCache).toEqual(paged.userPlanIdCache);
      }
    });
  }

  it("keeps the last devotional note of the day per user and drops other days", async () => {
    const { result } = await runMerged("roster", null);
    expect(result.users.map(user => user.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(Object.fromEntries(result.users.map(user => [user.id, user.today_devotional])))
      .toEqual({ u1: "後寫的", u2: "乙的靈修", u3: null, u4: null });
  });

  it("falls back to the paged path when the roster payload is malformed", async () => {
    const paged = await runMerged("none", PLAN_A);
    const malformed = await runMerged("malformed", PLAN_A);
    expect(malformed.calls.some(call => call.table === "profiles")).toBe(true);
    expect(malformed.result.users).toEqual(paged.result.users);
  });

  it("the paged fallback sends profiles and reading_plans at the same time", async () => {
    const { calls } = await runMerged("none", PLAN_A);
    const plansStarted = calls.findIndex(call => call.table === "reading_plans" && call.range);
    const profilesDone = calls.findIndex(call => call.table === "profiles" && call.done);
    expect(plansStarted).toBeGreaterThanOrEqual(0);
    expect(plansStarted).toBeLessThan(profilesDone);
  });
});

describe("fetchPlanStatsRoster (#397)", () => {
  it("returns null so the caller falls back when the RPC is missing, errors, throws or is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["none", "error", "throw", "malformed", "digest"]) {
      expect(await fetchPlanStatsRoster(createFakeSupabase([], { rpc: mode }), { planAliases: [PLAN_A] })).toBeNull();
    }
    warn.mockRestore();
  });

  it("expandPlanStatsRoster rebuilds the four paged datasets", () => {
    expect(expandPlanStatsRoster(null)).toBeNull();
    expect(expandPlanStatsRoster({ profiles: [], plans: [], logs: [] })).toBeNull();
    expect(expandPlanStatsRoster({
      profiles: [{ id: "u1", name: "甲" }, null],
      plans: [{ id: "p1", user_id: "u1" }],
      logs: [{ u: "u1", p: "p1", l: [["創世記", 1, 1, "2026-10-01T00:00:00+00:00"]] }],
      notes: [["u1", "內容"], ["", "x"], "bad"]
    })).toEqual({
      usersProfiles: [{ id: "u1", name: "甲" }],
      allPlans: [{ id: "p1", user_id: "u1" }],
      allLogs: [{ user_id: "u1", book: "創世記", chapter: 1, round: 1, read_at: "2026-10-01T00:00:00+00:00", plan_id: "p1" }],
      todayNotes: [{ user_id: "u1", content: "內容" }]
    });
  });
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

describe("nlc-data injects the plan stats scope and overrides client values (#394, #397)", () => {
  const ACTOR = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";
  const forged = { p_whole_church: true, p_visible_ids: null, p_actor_id: OTHER };

  it("whole-church scope sends p_whole_church = true and no id list", () => {
    expect(resolvePlanStatsScope(null, ACTOR)).toEqual({ p_whole_church: true, p_visible_ids: null });
    expect(buildPlanStatsRosterArgs({ p_plan_aliases: [PLAN_A], ...forged }, null, ACTOR)).toEqual({
      p_plan_aliases: [PLAN_A],
      p_pastoral_zone: null,
      p_note_date: null,
      p_whole_church: true,
      p_visible_ids: null,
      p_actor_id: ACTOR
    });
  });

  it("other roles get getVisibleProfileIds' result, an empty scope becomes [self], and forged values are overwritten", () => {
    const scoped = buildPlanStatsRosterArgs(
      { p_plan_aliases: ["2026-Q4", 3, "", PLAN_A], p_pastoral_zone: "牧區一", p_note_date: TODAY, ...forged },
      [ACTOR, "u-1"],
      ACTOR
    );
    expect(scoped).toEqual({
      p_plan_aliases: ["2026-Q4", PLAN_A],
      p_pastoral_zone: "牧區一",
      p_note_date: TODAY,
      p_whole_church: false,
      p_visible_ids: [ACTOR, "u-1"],
      p_actor_id: ACTOR
    });
    expect(buildPlanStatsRosterArgs(forged, [], ACTOR)).toMatchObject({
      p_plan_aliases: null,
      p_whole_church: false,
      p_visible_ids: [ACTOR],
      p_actor_id: ACTOR
    });
    expect(buildPlanStatsRosterArgs({ p_note_date: "2026/10/02", p_pastoral_zone: 5 }, [ACTOR], ACTOR))
      .toMatchObject({ p_note_date: null, p_pastoral_zone: null });
  });

  it("the digest RPC gets the same explicit flag and only valid plan uuids", () => {
    expect(buildPlanReadingLogDigestArgs({ p_plan_ids: [PLAN_A, PLAN_A, "x", 1], ...forged }, [ACTOR], ACTOR)).toEqual({
      p_plan_ids: [PLAN_A],
      p_whole_church: false,
      p_visible_ids: [ACTOR],
      p_actor_id: ACTOR
    });
    expect(buildPlanReadingLogDigestArgs({}, null, ACTOR)).toEqual({
      p_plan_ids: [],
      p_whole_church: true,
      p_visible_ids: null,
      p_actor_id: ACTOR
    });
  });

  it("index.ts computes getVisibleProfileIds once per call and never spreads client args into these RPCs", () => {
    const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");
    for (const [marker, builder] of [
      ["} else if (functionName === PLAN_READING_LOG_DIGEST_RPC) {", "buildPlanReadingLogDigestArgs(body.args, visibleIds, profile.id)"],
      ["} else if (functionName === PLAN_STATS_ROSTER_RPC) {", "buildPlanStatsRosterArgs(body.args, visibleIds, profile.id)"]
    ]) {
      const start = nlcData.indexOf(marker);
      expect(start).toBeGreaterThan(0);
      const branch = nlcData.slice(start, nlcData.indexOf("} else if", start + 10));
      expect(branch.match(/await getVisibleProfileIds\(supabaseAdmin, profile\)/g)).toHaveLength(1);
      expect(branch).toContain(builder);
      expect(branch).not.toContain("...(body.args");
    }
    expect(nlcData).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*PLAN_READING_LOG_DIGEST_RPC,[\s\S]*PLAN_STATS_ROSTER_RPC,[\s\S]*\]\);/);
  });
});

describe("plan stats RPCs are service_role-only and fail closed (#394, #397)", () => {
  // get_plan_stats_roster 後來被 #473（排除個人計畫）改寫過：驗現在的定義（#458）。
  const roster = currentMigrationSql("20261002052232_plan_stats_roster.sql");
  const ROSTER_SIGNATURE = "public.get_plan_stats_roster(text[], text, date, boolean, uuid[], uuid)";
  const DIGEST_SIGNATURE = "public.get_plan_reading_log_digest(uuid[], boolean, uuid[], uuid)";

  // #394 的原版在 20261002022500；#397（_plan_stats_roster）改寫成 4 參數版，這裡驗現在的版本
  it("the digest keeps every row and orders by id", () => {
    const digest = latestFunctionDefinition("get_plan_reading_log_digest").text;
    expect(digest).toContain("json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id)");
    expect(digest).not.toMatch(/DISTINCT|AT TIME ZONE/);
  });

  it("get_plan_stats_roster is SECURITY DEFINER, search_path '' and only granted to service_role", () => {
    expect(roster).toMatch(/FUNCTION public\.get_plan_stats_roster\([\s\S]*?SECURITY DEFINER\s+SET search_path TO ''/);
    expect(roster).toContain(`REVOKE ALL ON FUNCTION ${ROSTER_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(roster).toContain(`GRANT EXECUTE ON FUNCTION ${ROSTER_SIGNATURE} TO service_role;`);
    expect(roster).not.toMatch(/GRANT[^;]*get_plan_stats_roster[^;]*\b(anon|authenticated)\b/);
  });

  it("get_plan_stats_roster fails closed without a whole-church flag or ids and keeps the digest log format", () => {
    expect(roster).toContain("p_actor_id IS NOT NULL\n      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)");
    expect(roster).toContain("(p_whole_church IS TRUE OR prof.id = ANY (p_visible_ids))");
    expect(roster).toContain("(p_whole_church IS TRUE OR plan.user_id = ANY (p_visible_ids))");
    expect(roster).toContain("(p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))");
    expect(roster).not.toMatch(/p_visible_ids IS NULL OR/);
    expect(roster).toContain("json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id)");
    expect(roster).toContain("ORDER BY roster.id");
    expect(roster).toContain("ORDER BY plans.id");
    expect(roster).toContain("ORDER BY notes.id");
    expect(roster).not.toMatch(/DISTINCT|AT TIME ZONE|email|managed_/);
  });

  it("get_plan_reading_log_digest is replaced by the explicit-flag version without defaults", () => {
    expect(roster).toContain("DROP FUNCTION IF EXISTS public.get_plan_reading_log_digest(uuid[], uuid[], uuid);");
    const digestStart = roster.indexOf("CREATE OR REPLACE FUNCTION public.get_plan_reading_log_digest(");
    expect(digestStart).toBeGreaterThan(0);
    const digest = roster.slice(digestStart);
    // 沒有預設值：還沒重新部署的 nlc-data（只帶三個參數）會找不到函式，前端退回分頁，而不是拿到空的紀錄。
    expect(digest.slice(0, digest.indexOf("RETURNS"))).not.toMatch(/DEFAULT/);
    expect(digest).toContain("AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)");
    expect(digest).toContain("AND (p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))");
    expect(digest).not.toMatch(/p_visible_ids IS NULL OR/);
    expect(digest).toContain("SET search_path TO ''");
    expect(digest).toContain(`REVOKE ALL ON FUNCTION ${DIGEST_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(digest).toContain(`GRANT EXECUTE ON FUNCTION ${DIGEST_SIGNATURE} TO service_role;`);
  });
});
