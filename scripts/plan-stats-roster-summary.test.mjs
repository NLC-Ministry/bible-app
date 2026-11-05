// #673：計畫統計名冊的彙總路徑。數字和舊算法一致的比對在 scripts/db-behavior.test.mjs（實際跑 SQL）；
// 這裡鎖住部署順序不拘：新 RPC 不能用的時候一定退回舊 RPC 與舊計算，畫面不會壞，還有 nlc-data 怎麼組參數。
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_STATS_ROSTER_SUMMARY_RPC,
  buildPlanStatsRosterSummaryArgs
} from "../supabase/functions/nlc-data/plan-stats-scope.ts";
import {
  buildMergedUserFromRosterSummary,
  buildPlanStatsRosterSchedule,
  parsePlanStatsRosterSummary
} from "../js/data/plan-stats-roster-summary.mjs";

const PLAN = "00000000-0000-0000-c126-000000202610";
const TIMEZONE = "Asia/Taipei";
const schedule = { startDate: "2026-10-01", timezone: TIMEZONE, entries: [[0, "利未記", 1]] };
const ROLE = { id: "r-zone", code: "zone_leader", label: "區長" };

const oldRoster = () => ({
  profiles: [
    { id: "u1", name: "甲", great_region: "大區一", pastoral_zone: "牧區一", small_group: "小組一", role_id: "r-zone", role_definition: ROLE }
  ],
  plans: [{ id: "p1", user_id: "u1", name: "A", preset_key: null, global_plan_id: PLAN, target_books: ["利未記"], current_round: 1, upgrade_prompt_handled: false }],
  logs: [{ u: "u1", p: "p1", l: [["利未記", 1, 1, "2026-10-01T01:00:00+00:00"], ["利未記", 2, 1, "2026-10-02T01:00:00+00:00"]] }],
  notes: []
});

const summaryPayload = (overrides = {}) => ({
  tz: TIMEZONE,
  roles: [["r-zone", "zone_leader", "區長"]],
  plans: [[null, PLAN, ["利未記"]]],
  people: [{
    i: "u1", n: "甲", r: "大區一", z: "牧區一", g: "小組一", ri: "r-zone", p: "p1", t: 0, c: 1, h: false,
    b: { 1: 2 }, a: "2026-10-02T01:00:00+00:00", s: 2, m: 0, l: null, ...overrides
  }]
});

// summary：ok＝新 RPC 可用；其餘模擬部署還沒到位或壞掉的各種樣子
function fakeClient(calls, summary = "ok", payload = summaryPayload()) {
  return {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === PLAN_STATS_ROSTER_SUMMARY_RPC) {
        if (summary === "ok") return { data: payload, error: null };
        if (summary === "not_whitelisted") return { data: null, error: { error: "forbidden_rpc" } };
        if (summary === "not_migrated") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
        if (summary === "bad_timezone") return { data: null, error: { code: "22023", message: 'time zone "x" not recognized' } };
        if (summary === "throws") throw new Error("network down");
        if (summary === "null") return { data: null, error: null };
        return { data: payload, error: null };
      }
      if (name === "get_plan_stats_roster") return { data: oldRoster(), error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    }
  };
}

let dom;

async function loadDb(client) {
  vi.resetModules();
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
  vi.stubGlobal("BIBLE_BOOKS", [{ name: "利未記", chapters: 27 }]);
  vi.stubGlobal("state", {
    isSupabaseMode: true,
    supabase: client,
    currentUser: { id: "viewer", name: "看統計的人" },
    activePlan: null,
    readingLogs: [],
    globalPlans: []
  });
  await import("../js/db.js?plan-stats-roster-summary");
  return dom.window.db || globalThis.db;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dom) dom.window.close();
  dom = null;
});

describe("新 RPC 不能用時退回舊 RPC 與舊計算（部署順序不拘）", () => {
  const FAILURES = [
    ["nlc-data 還沒部署（白名單拒絕）", "not_whitelisted"],
    ["migration 還沒套用（函式不存在）", "not_migrated"],
    ["裝置時區伺服器不認得", "bad_timezone"],
    ["網路錯誤", "throws"],
    ["回 NULL（nlc-data 認為參數不對）", "null"]
  ];

  it.each(FAILURES)("%s", async (_label, mode) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = [];
    const db = await loadDb(fakeClient(calls, mode));
    const { users, logsByUserId } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule });
    expect(calls.map(call => call.name)).toEqual([PLAN_STATS_ROSTER_SUMMARY_RPC, "get_plan_stats_roster"]);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: "u1", chapters_read: 2, plan_progress: 7, last_read_at: "2026-10-02T01:00:00+00:00" });
    // 畫面看到沒有 roster_stats，就用逐筆打卡自己算
    expect(users[0].roster_stats).toBeUndefined();
    expect(logsByUserId.get("u1")).toHaveLength(2);
  });

  it.each([
    ["時區和要求的不一樣", summaryPayload(), { tz: "UTC" }],
    ["要了補讀天數卻沒有（nlc-data 判定日程不合格）", summaryPayload({ m: null }), {}],
    ["連續天數不是整數", summaryPayload({ s: "2" }), {}],
    ["少了 people", { tz: TIMEZONE, roles: [], plans: [] }, {}]
  ])("回傳內容不對：%s", async (_label, payload, overrides) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = [];
    const db = await loadDb(fakeClient(calls, "malformed", { ...payload, ...overrides }));
    const { users, logsByUserId } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule });
    expect(calls.map(call => call.name)).toEqual([PLAN_STATS_ROSTER_SUMMARY_RPC, "get_plan_stats_roster"]);
    expect(users[0].chapters_read).toBe(2);
    expect(logsByUserId.get("u1")).toHaveLength(2);
  });

  it("新舊 RPC 都不能用：跟以前一樣退回只有自己一列，不會丟例外", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      rpc: async () => ({ data: null, error: { message: "down" } }),
      from() { throw new Error("paged path down"); }
    };
    const db = await loadDb(client);
    const { users } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule });
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("看統計的人");
  });

  it("日程不能精確交給伺服器（rosterSchedule: false）：不呼叫新 RPC", async () => {
    const calls = [];
    const db = await loadDb(fakeClient(calls));
    const { logsByUserId } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: false });
    expect(calls.map(call => call.name)).toEqual(["get_plan_stats_roster"]);
    expect(logsByUserId.get("u1")).toHaveLength(2);
  });
});

describe("彙總路徑", () => {
  it("只發一支 RPC、不帶可見範圍、帶裝置時區和比對尺；彙總結果就是 users", async () => {
    const calls = [];
    const db = await loadDb(fakeClient(calls));
    const { users, logsByUserId } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule, pastoralZone: "牧區一" });
    expect(calls).toEqual([{
      name: PLAN_STATS_ROSTER_SUMMARY_RPC,
      args: { p_plan_aliases: [PLAN], p_pastoral_zone: "牧區一", p_timezone: TIMEZONE, p_start_date: "2026-10-01", p_schedule: schedule.entries }
    }]);
    expect(logsByUserId.size).toBe(0);
    expect(users).toEqual([{
      id: "u1", name: "甲", great_region: "大區一", pastoral_zone: "牧區一", small_group: "小組一",
      role_id: "r-zone", role_definition: ROLE,
      chapters_read: 2, plan_progress: 7, streak: 0,
      last_read: "2026-10-02", last_read_at: "2026-10-02T01:00:00+00:00",
      plan_id: "p1", presetKey: null, globalPlanId: PLAN, current_round: 1,
      today_devotional: null,
      roster_stats: { streak: 2, makeup: 0 }
    }]);
  });

  it("沒帶日程（首頁）：不帶比對尺，makeup 是 null，名單照樣能用", async () => {
    const calls = [];
    // 沒帶日程時請求用裝置時區，伺服器會原樣回傳；不能寫死台北，CI 是 UTC。
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const db = await loadDb(fakeClient(calls, "ok", { ...summaryPayload({ m: null }), tz }));
    const { users } = await db.fetchMergedUsersWithLogs(PLAN);
    expect(calls[0].args).toMatchObject({ p_start_date: null, p_schedule: null });
    expect(users[0].roster_stats).toEqual({ streak: 2, makeup: null });
    expect(users[0].chapters_read).toBe(2);
  });

  it("報名沒有書卷清單：伺服器回逐筆，前端照舊退回 state.globalPlans 的書卷範圍", async () => {
    const payload = summaryPayload({
      b: null, a: null,
      l: [["利未記", 1, 1, "2026-10-01T01:00:00+00:00"], ["民數記", 1, 1, "2026-10-05T01:00:00+00:00"]]
    });
    payload.plans = [[null, PLAN, []]];
    const db = await loadDb(fakeClient([], "ok", payload));
    globalThis.state.globalPlans = [{ id: PLAN, books: ["利未記"] }];
    const { users } = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule });
    expect(users[0]).toMatchObject({
      chapters_read: 1,
      last_read_at: "2026-10-01T01:00:00+00:00",
      plan_progress: 0,
      roster_stats: { streak: 2, makeup: 0 }
    });
  });

  it("比對尺不同不共用快取；相同的尺共用", async () => {
    const calls = [];
    const db = await loadDb(fakeClient(calls));
    const first = await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: schedule, maxAgeMs: Infinity });
    expect(await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: { ...schedule }, maxAgeMs: Infinity })).toBe(first);
    expect(calls).toHaveLength(1);
    await db.fetchMergedUsersWithLogs(PLAN, { rosterSchedule: { ...schedule, entries: [] }, maxAgeMs: Infinity });
    expect(calls).toHaveLength(2);
  });

  it("同一個人的進度用前端共用函式從各遍章數算", () => {
    const summary = parsePlanStatsRosterSummary(summaryPayload({ b: { 1: 27, 2: 7 }, c: 2, h: false }), { timezone: TIMEZONE, scheduleRequested: true });
    expect(buildMergedUserFromRosterSummary(summary.people[0], summary, { bibleBooks: [{ name: "利未記", chapters: 27 }] }))
      .toMatchObject({ chapters_read: 34, current_round: 2, plan_progress: 26 });
    const unconfirmed = parsePlanStatsRosterSummary(summaryPayload({ b: { 1: 3 }, c: 2, h: false }), { timezone: TIMEZONE, scheduleRequested: true });
    expect(buildMergedUserFromRosterSummary(unconfirmed.people[0], unconfirmed, { bibleBooks: [{ name: "利未記", chapters: 27 }] }))
      .toMatchObject({ chapters_read: 3, current_round: 1, plan_progress: 11 });
  });
});

describe("buildPlanStatsRosterSchedule", () => {
  const dayOf = (...chapters) => ({ chapters: chapters.map(([book, chapter]) => ({ book, chapter })) });

  it("保留第幾天（休息日不列，但佔一天）", () => {
    expect(buildPlanStatsRosterSchedule([dayOf(["利未記", 1], ["利未記", 2]), dayOf(), { isRestDay: true }, dayOf(["利未記", 3])], "2026-10-01", TIMEZONE))
      .toEqual({ startDate: "2026-10-01", timezone: TIMEZONE, entries: [[0, "利未記", 1], [0, "利未記", 2], [3, "利未記", 3]] });
  });

  it("空日程也是合法的尺（舊算法在這時回 0）", () => {
    expect(buildPlanStatsRosterSchedule([], "2026-10-01", TIMEZONE)).toMatchObject({ entries: [] });
    expect(buildPlanStatsRosterSchedule(undefined, "2026-10-01", TIMEZONE)).toMatchObject({ entries: [] });
  });

  it.each([
    ["起始日不是 YYYY-MM-DD", [dayOf(["利未記", 1])], "2026-1-1", TIMEZONE],
    ["沒有起始日", [dayOf(["利未記", 1])], null, TIMEZONE],
    ["沒有時區", [dayOf(["利未記", 1])], "2026-10-01", ""],
    ["章不是正整數", [dayOf(["利未記", 1.5])], "2026-10-01", TIMEZONE],
    ["沒有書卷", [dayOf(["", 1])], "2026-10-01", TIMEZONE]
  ])("%s：回 false，呼叫端走舊路徑", (_label, days, start, timezone) => {
    expect(buildPlanStatsRosterSchedule(days, start, timezone)).toBe(false);
  });
});

describe("nlc-data 注入範圍並檢查彙總的參數（#673）", () => {
  const ACTOR = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";
  const forged = { p_whole_church: true, p_visible_ids: null, p_actor_id: OTHER };
  const valid = { p_plan_aliases: [PLAN], p_pastoral_zone: "牧區一", p_timezone: TIMEZONE, p_start_date: "2026-10-01", p_schedule: [[0, "利未記", 1]] };

  it("全教會和其他角色都用 getVisibleProfileIds 的結果，前端傳的範圍一律被覆寫", () => {
    expect(buildPlanStatsRosterSummaryArgs({ ...valid, ...forged }, null, ACTOR)).toEqual({
      ...valid, p_whole_church: true, p_visible_ids: null, p_actor_id: ACTOR
    });
    expect(buildPlanStatsRosterSummaryArgs({ ...valid, ...forged }, [ACTOR, "u-1"], ACTOR)).toMatchObject({
      p_whole_church: false, p_visible_ids: [ACTOR, "u-1"], p_actor_id: ACTOR
    });
    expect(buildPlanStatsRosterSummaryArgs({ ...valid, ...forged }, [], ACTOR)).toMatchObject({
      p_whole_church: false, p_visible_ids: [ACTOR], p_actor_id: ACTOR
    });
  });

  it("別名、牧區的清理和舊 RPC 一樣", () => {
    expect(buildPlanStatsRosterSummaryArgs({ p_plan_aliases: ["2026-Q4", 3, "", PLAN], p_pastoral_zone: 5 }, [ACTOR], ACTOR))
      .toMatchObject({ p_plan_aliases: ["2026-Q4", PLAN], p_pastoral_zone: null });
    expect(buildPlanStatsRosterSummaryArgs({ p_plan_aliases: "x" }, [ACTOR], ACTOR)).toMatchObject({ p_plan_aliases: null });
  });

  it.each([
    ["不是陣列", "x"],
    ["格式不對的一筆", [[0, "利未記", 1], [0, "利未記"]]],
    ["負的天數", [[-1, "利未記", 1]]],
    ["章不是正整數", [[0, "利未記", 0]]],
    ["書卷是空字串", [[0, "", 1]]],
    ["太長", Array.from({ length: 5001 }, () => [0, "利未記", 1])]
  ])("日程不合格（%s）：整份當沒有，不部分採用", (_label, p_schedule) => {
    expect(buildPlanStatsRosterSummaryArgs({ ...valid, p_schedule }, [ACTOR], ACTOR)).toMatchObject({ p_schedule: null });
  });

  it("起始日不合格連日程一起拿掉；時區格式不合格回 null（SQL 回 NULL，前端退回舊路徑）", () => {
    expect(buildPlanStatsRosterSummaryArgs({ ...valid, p_start_date: "2026/10/01" }, [ACTOR], ACTOR))
      .toMatchObject({ p_start_date: null, p_schedule: null });
    for (const timezone of ["", "Asia/Taipei'; DROP", 5, "x".repeat(65)]) {
      expect(buildPlanStatsRosterSummaryArgs({ ...valid, p_timezone: timezone }, [ACTOR], ACTOR)).toMatchObject({ p_timezone: null });
    }
    for (const timezone of ["Asia/Taipei", "America/Argentina/Buenos_Aires", "Etc/GMT+8", "UTC"]) {
      expect(buildPlanStatsRosterSummaryArgs({ ...valid, p_timezone: timezone }, [ACTOR], ACTOR)).toMatchObject({ p_timezone: timezone });
    }
  });

  it("index.ts：在白名單裡、範圍由 builder 組，不放進批次、不展開前端參數", () => {
    const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");
    expect(nlcData).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*PLAN_STATS_ROSTER_SUMMARY_RPC,[\s\S]*\]\);/);
    const start = nlcData.indexOf("} else if (functionName === PLAN_STATS_ROSTER_SUMMARY_RPC) {");
    expect(start).toBeGreaterThan(0);
    const branch = nlcData.slice(start, nlcData.indexOf("} else if", start + 10));
    expect(branch).toContain("buildPlanStatsRosterSummaryArgs(body.args, visibleIds, profile.id)");
    expect(branch).not.toContain("...(body.args");
    const batch = nlcData.slice(nlcData.indexOf("const BATCH_RPC_FUNCTIONS = new Set(["));
    expect(batch.slice(0, batch.indexOf("]);"))).not.toContain(PLAN_STATS_ROSTER_SUMMARY_RPC);
  });
});

describe("每個用名冊的畫面都帶同一把尺（#673）", () => {
  const planStats = readFileSync(new URL("../js/modules/plan-stats.js", import.meta.url), "utf8");

  it("組員總覽、組織統計樹、牧區 CSV 共用快取項目", () => {
    expect(planStats.match(/getPlanStatsRosterOptions\(contextPlan\)/g)).toHaveLength(2);
    expect(planStats).toContain("{ maxAgeMs: Infinity, ...getPlanStatsRosterOptions(statsPlan) }");
    expect(planStats).not.toMatch(/db\.fetchMergedUsersList\(getPlanStatsCacheKey\(contextPlan\)\)/);
  });
});
