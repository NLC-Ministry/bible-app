// #674：nlc-data 每個請求的固定開銷。實際跑 handler（假的資料庫、假的 jose），
// 斷言真正發出去的查詢次數與套上的範圍，不比對原始碼字串。
// nlc-data 繞過 RLS，所以這裡同時守住：快取不能讓 A 的範圍、身分、開關判斷用到 B 身上。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__nlcDataFakeDb.client()
}));
vi.mock("https://esm.sh/jose@5.9.6", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token) => {
    const [, payload, signature] = token.split(".");
    if (signature === "expired") throw Object.assign(new Error("expired"), { code: "ERR_JWT_EXPIRED" });
    if (signature !== "good") throw Object.assign(new Error("bad"), { code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" });
    return { payload: JSON.parse(atob(payload)) };
  }
}));

const ISSUER = "https://sso.test/oidc";
const REGION_LEADER = "10000000-0000-4000-8000-000000000004";
const MEMBER_ROLE = "10000000-0000-4000-8000-000000000001";
const ADMIN_ROLE = "10000000-0000-4000-8000-000000000006";

function token(sub, signature = "good", extra = "") {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode({ sub, iss: ISSUER, jti: extra })}.${signature}`;
}

function person(id, overrides = {}) {
  return {
    id,
    name: id,
    email: `${id}@example.test`,
    great_region: "",
    pastoral_zone: "",
    small_group: "",
    role_id: MEMBER_ROLE,
    is_active: true,
    managed_regions: null,
    managed_zones: null,
    managed_groups: null,
    ...overrides
  };
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.columns = "";
    this.filters = [];
    this.orExpr = null;
    this.one = false;
  }
  select(columns = "*") { if (this.op === "select") this.columns = columns; return this; }
  update(values) { this.op = "update"; this.values = values; return this; }
  insert(values) { this.op = "insert"; this.values = values; return this; }
  upsert(values) { this.op = "upsert"; this.values = values; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column, value) { this.filters.push(["eq", column, value]); return this; }
  in(column, value) { this.filters.push(["in", column, value]); return this; }
  is(column, value) { this.filters.push(["eq", column, value]); return this; }
  or(expr) { this.orExpr = expr; return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  then(resolve, reject) { return this.db.exec(this).then(resolve, reject); }

  filterValue(column) {
    return this.filters.find(([, name]) => name === column)?.[2];
  }
  matches(row) {
    const plain = this.filters.every(([type, column, value]) =>
      type === "in" ? value.includes(row[column]) : row[column] === value
    );
    if (!plain) return false;
    if (this.orExpr && this.table === "profiles") {
      const id = /id\.eq\.([^,]+)/.exec(this.orExpr)?.[1];
      return row.id === id;
    }
    return true;
  }
}

function makeDb({ profiles = [], identities = [], flags = {}, memberships = [] } = {}) {
  const db = {
    tables: {
      profiles: profiles.map((row) => ({ ...row })),
      user_identities: identities.map(([sub, profileId]) => ({ provider: "logto", provider_user_id: sub, profile_id: profileId })),
      app_feature_settings: Object.entries(flags).map(([key, enabled]) => ({ key, enabled })),
      reading_team_members: memberships.map(([teamId, userId]) => ({ team_id: teamId, user_id: userId }))
    },
    calls: [],
    rpcs: [],
    flagError: false,
    embedError: false,
    beforeExec: null,
    client() {
      return {
        from: (table) => new Query(db, table),
        rpc: async (fn, args) => {
          db.calls.push({ table: `rpc:${fn}`, op: "rpc" });
          db.rpcs.push({ fn, args });
          return { data: { ok: true }, error: null };
        },
        auth: { getUser: async () => ({ data: { user: null }, error: new Error("not a supabase token") }) }
      };
    },
    async exec(query) {
      db.calls.push({
        table: query.table,
        op: query.op,
        columns: query.columns,
        filters: query.filters.map((filter) => [...filter])
      });
      if (db.beforeExec) await db.beforeExec(query);
      else await new Promise((resolve) => setTimeout(resolve, 0));
      return db.run(query);
    },
    run(query) {
      const rows = db.tables[query.table] || [];
      const finish = (list) => ({ data: query.one ? (list[0] ?? null) : list, error: null });
      if (query.table === "app_feature_settings" && query.op === "select" && db.flagError) {
        return { data: null, error: { message: "boom" } };
      }
      if (query.table === "user_identities" && query.columns.includes("profiles")) {
        if (db.embedError) return { data: null, error: { message: "embed failed", code: "PGRST200" } };
        const identity = rows.find((row) => query.matches(row));
        if (!identity) return { data: null, error: null };
        const profile = db.tables.profiles.find((row) => row.id === identity.profile_id) || null;
        return { data: { profile_id: identity.profile_id, profile: profile ? { ...profile } : null }, error: null };
      }
      if (query.op === "update") {
        const hit = rows.filter((row) => query.matches(row));
        hit.forEach((row) => Object.assign(row, query.values));
        return finish(hit.map((row) => ({ ...row })));
      }
      return finish(rows.filter((row) => query.matches(row)).map((row) => ({ ...row })));
    },
    count(table, predicate = () => true) {
      return db.calls.filter((call) => call.table === table && predicate(call)).length;
    }
  };
  return db;
}

// 組長算 visibleIds 那一支：只選 id、限 is_active
const isScopeQuery = (call) => call.columns === "id" && call.filters.some(([, column]) => column === "is_active");
const logsScope = (db) => db.calls
  .filter((call) => call.table === "reading_logs")
  .map((call) => call.filters.find(([type, column]) => type === "in" && column === "user_id")?.[2]);

let handler;
let env;
const spies = [];

async function loadHandler(extraEnv = {}) {
  vi.resetModules();
  env = {
    SUPABASE_URL: "https://db.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    NLC_LOGTO_ISSUER: ISSUER,
    ...extraEnv
  };
  vi.stubGlobal("Deno", {
    env: { get: (key) => env[key] },
    serve: (fn) => { handler = fn; }
  });
  await import("../supabase/functions/nlc-data/index.ts");
}

async function call(db, accessToken, body) {
  globalThis.__nlcDataFakeDb = db;
  const response = await handler(new Request("https://edge.test/nlc-data", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
}

const leaderA = () => person("leader-a", { role_id: REGION_LEADER, role_definition: { code: "great_zone_leader" }, great_region: "東區", managed_regions: "東區" });
const leaderB = () => person("leader-b", { role_id: REGION_LEADER, role_definition: { code: "great_zone_leader" }, great_region: "西區", managed_regions: "西區" });
const CHURCH = [
  leaderA(),
  leaderB(),
  person("east-1", { great_region: "東區" }),
  person("east-2", { great_region: "東區" }),
  person("west-1", { great_region: "西區" })
];
const IDENTITIES = [["sub-a", "leader-a"], ["sub-b", "leader-b"], ["sub-east-1", "east-1"]];

const logsBatch = (count = 5) => ({
  action: "batch",
  queries: Array.from({ length: count }, () => ({ table: "reading_logs", select: "id" }))
});

beforeEach(async () => {
  spies.push(vi.spyOn(console, "log").mockImplementation(() => {}));
  spies.push(vi.spyOn(console, "warn").mockImplementation(() => {}));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
  await loadHandler();
});

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete globalThis.__nlcDataFakeDb;
});

describe("同一批請求只查一次範圍和功能開關", () => {
  it("首頁 batch 的 4 支測驗 RPC，app_feature_settings 最多讀 1 次", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { daily_quiz: true, speed_reading_exam: true } });
    const { status, body } = await call(db, token("sub-east-1"), {
      action: "batch",
      queries: ["exam_home_banner", "exam_home_exams", "get_quiz_notifications", "get_exam_notifications"]
        .map((fn) => ({ action: "rpc", function: fn, args: {} }))
    });
    expect(status).toBe(200);
    expect(body.data.every((slot) => slot.data && !slot.error)).toBe(true);
    expect(db.count("app_feature_settings")).toBe(1);
    expect(db.rpcs.map((row) => row.fn).sort()).toEqual(["exam_home_banner", "exam_home_exams", "get_exam_notifications", "get_quiz_notifications"]);
  });

  it("組長的 batch，visibleIds 只算 1 次，每一格都套到同一份範圍", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(5));
    expect(db.count("profiles", isScopeQuery)).toBe(1);
    const scopes = logsScope(db);
    expect(scopes).toHaveLength(5);
    for (const scope of scopes) expect([...scope].sort()).toEqual(["east-1", "east-2", "leader-a"]);
  });

  it("一般會友讀隊伍表，一批只查一次自己的隊伍，兩張表都被限制在自己的隊", async () => {
    const db = makeDb({
      profiles: CHURCH,
      identities: IDENTITIES,
      memberships: [["team-1", "east-1"], ["team-2", "west-1"]]
    });
    await call(db, token("sub-east-1"), {
      action: "batch",
      queries: [
        { table: "reading_teams", select: "id" },
        { table: "reading_team_members", select: "team_id, user_id" },
        { table: "reading_teams", select: "name" }
      ]
    });
    expect(db.count("reading_team_members", (row) => row.columns === "team_id")).toBe(1);
    const teams = db.calls.filter((row) => row.table === "reading_teams");
    expect(teams).toHaveLength(2);
    for (const row of teams) expect(row.filters).toContainEqual(["in", "id", ["team-1"]]);
    const members = db.calls.find((row) => row.table === "reading_team_members" && row.columns !== "team_id");
    expect(members.filters).toContainEqual(["in", "team_id", ["team-1"]]);
  });

  it("沒有隊伍的會友 fail closed：查不到任何隊伍", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-east-1"), { action: "batch", queries: [{ table: "reading_teams", select: "id" }] });
    const row = db.calls.find((entry) => entry.table === "reading_teams");
    expect(row.filters).toContainEqual(["in", "id", ["00000000-0000-0000-0000-000000000000"]]);
  });
});

describe("快取不跨使用者", () => {
  it("兩位組長交錯：A 的範圍查詢卡住時 B 先做完，兩邊都只看到自己的範圍", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    let releaseA;
    const aHeld = new Promise((resolve) => { releaseA = resolve; });
    db.beforeExec = async (query) => {
      if (query.table === "profiles" && query.columns === "id" && query.filterValue("great_region")?.includes("東區")) await aHeld;
    };
    const first = call(db, token("sub-a"), logsBatch(3));
    await vi.waitFor(() => expect(db.count("profiles", isScopeQuery)).toBeGreaterThan(0));
    await call(db, token("sub-b"), logsBatch(3));
    const westScopes = logsScope(db);
    expect(westScopes).toHaveLength(3);
    for (const scope of westScopes) expect([...scope].sort()).toEqual(["leader-b", "west-1"]);

    releaseA();
    await first;
    const all = logsScope(db);
    expect(all).toHaveLength(6);
    for (const scope of all.slice(3)) expect([...scope].sort()).toEqual(["east-1", "east-2", "leader-a"]);
  });

  it("請求快取只活在單一請求：同一人下一個請求重算 visibleIds", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(2));
    await call(db, token("sub-a"), logsBatch(2));
    expect(db.count("profiles", isScopeQuery)).toBe(2);
  });

  it("組織異動（組員被停用）下一個請求就反映，不等任何 TTL", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(1));
    db.tables.profiles.find((row) => row.id === "east-2").is_active = false;
    db.calls.length = 0;
    await call(db, token("sub-a"), logsBatch(1));
    expect([...logsScope(db)[0]].sort()).toEqual(["east-1", "leader-a"]);
  });

  it("空的管理範圍 fail closed：只看得到自己，不會去查別人", async () => {
    const db = makeDb({
      profiles: [person("empty-leader", { role_definition: { code: "great_zone_leader" }, role_id: REGION_LEADER }), person("x", { great_region: "東區" })],
      identities: [["sub-empty", "empty-leader"]]
    });
    await call(db, token("sub-empty"), {
      action: "batch",
      queries: [{ table: "reading_logs", select: "id" }, { table: "profiles", select: "id, name" }]
    });
    expect(db.count("profiles", isScopeQuery)).toBe(0);
    expect(logsScope(db)[0]).toEqual(["empty-leader"]);
    const profileRead = db.calls.find((row) => row.table === "profiles" && row.columns === "id, name");
    expect(profileRead.filters).toContainEqual(["in", "id", ["empty-leader"]]);
  });
});

describe("認證快取", () => {
  it("沒命中時，正式查詢前只有 1 趟往返", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-east-1"), { action: "select", table: "great_regions", select: "id" });
    const firstBusiness = db.calls.findIndex((row) => row.table === "great_regions");
    expect(firstBusiness).toBe(1);
    expect(db.calls[0].table).toBe("user_identities");
  });

  it("單支查詢失敗（嵌入欄位不存在）時退回舊的兩步流程，不會擋掉登入", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    db.embedError = true;
    const { status } = await call(db, token("sub-east-1"), { action: "select", table: "great_regions", select: "id" });
    expect(status).toBe(200);
    expect(db.count("profiles")).toBe(1);
  });

  it("身分不存在回 404，也不會留在快取裡（新帳號同步完馬上能用）", async () => {
    const db = makeDb({ profiles: [person("new-person")], identities: [] });
    const body = { action: "select", table: "great_regions", select: "id" };
    expect((await call(db, token("sub-new"), body)).status).toBe(404);
    db.tables.user_identities.push({ provider: "logto", provider_user_id: "sub-new", profile_id: "new-person" });
    expect((await call(db, token("sub-new"), body)).status).toBe(200);
  });

  it("換新 token（同一個 sub）沿用快取；不同的 sub 不會互相命中", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const body = { action: "select", table: "great_regions", select: "id" };
    await call(db, token("sub-a", "good", "first"), body);
    await call(db, token("sub-a", "good", "refreshed"), body);
    expect(db.count("user_identities")).toBe(1);
    await call(db, token("sub-b"), logsBatch(1));
    expect(db.count("user_identities")).toBe(2);
    expect([...logsScope(db)[0]].sort()).toEqual(["leader-b", "west-1"]);
  });

  it("偽造的 token 就算帶已快取的 sub 也拿不到快取（enforce）", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(1));
    const forged = await call(db, token("sub-a", "forged"), logsBatch(1));
    expect(forged.status).toBe(401);
  });

  it("過期的 token 就算 sub 已在快取裡也被拒絕", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(1));
    expect((await call(db, token("sub-a", "expired"), logsBatch(1))).status).toBe(401);
  });

  it.each(["report", "off"])("%s 模式：沒驗過的 sub 不讀也不寫快取", async (mode) => {
    await loadHandler({ NLC_JWT_VERIFY_MODE: mode });
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const body = { action: "select", table: "great_regions", select: "id" };
    await call(db, token("sub-a", "forged"), body);
    await call(db, token("sub-a", "forged"), body);
    expect(db.count("user_identities")).toBe(2);
    if (mode === "report") {
      // 上面的假 token 不會種進快取；真的 token 驗過才進，下一次才命中
      await call(db, token("sub-a"), body);
      expect(db.count("user_identities")).toBe(3);
      await call(db, token("sub-a"), body);
      expect(db.count("user_identities")).toBe(3);
      // 反過來：快取裡已經有驗過的 sub，假 token 也不能讀
      await call(db, token("sub-a", "forged"), body);
      expect(db.count("user_identities")).toBe(4);
    }
  });

  it("角色降級：30 秒內的舊判斷會持續，過了就失效（延遲上限）", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    await call(db, token("sub-a"), logsBatch(1));
    const row = db.tables.profiles.find((entry) => entry.id === "leader-a");
    row.role_definition = { code: "member" };
    row.role_id = MEMBER_ROLE;

    vi.setSystemTime(Date.now() + 29_000);
    db.calls.length = 0;
    await call(db, token("sub-a"), logsBatch(1));
    expect(logsScope(db)[0].length).toBeGreaterThan(1);

    vi.setSystemTime(Date.now() + 2_000);
    db.calls.length = 0;
    await call(db, token("sub-a"), logsBatch(1));
    expect(logsScope(db)[0]).toEqual(["leader-a"]);
  });

  it("帳號被停用：過了 TTL 之後，請求拿到的 profile 就是停用後的資料", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const body = { action: "save_profile", payload: {} };
    expect((await call(db, token("sub-east-1"), body)).body.profile.is_active).toBe(true);
    db.tables.profiles.find((row) => row.id === "east-1").is_active = false;
    vi.setSystemTime(Date.now() + 31_000);
    expect((await call(db, token("sub-east-1"), body)).body.profile.is_active).toBe(false);
  });

  it("透過 nlc-data 改 profiles 或管理範圍後，同一個 isolate 立刻不用舊資料", async () => {
    const admin = person("admin-1", { role_id: ADMIN_ROLE, role_definition: { code: "admin" } });
    const db = makeDb({ profiles: [...CHURCH, admin], identities: [...IDENTITIES, ["sub-admin", "admin-1"]] });
    const read = { action: "select", table: "great_regions", select: "id" };
    await call(db, token("sub-a"), read);
    await call(db, token("sub-admin"), read);
    expect(db.count("user_identities")).toBe(2);
    await call(db, token("sub-admin"), {
      action: "rpc",
      function: "set_profile_managed_scopes",
      args: { p_profile_id: "leader-a", p_managed_regions: "" }
    });
    db.calls.length = 0;
    await call(db, token("sub-a"), read);
    expect(db.count("user_identities")).toBe(1);
  });
});

describe("功能開關的模組快取", () => {
  const banner = { action: "rpc", function: "exam_home_banner", args: {} };

  it("30 秒內不重讀，不同使用者共用同一份（開關不分人）", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { speed_reading_exam: true } });
    await call(db, token("sub-a"), banner);
    await call(db, token("sub-b"), banner);
    expect(db.count("app_feature_settings")).toBe(1);
  });

  it("後台關掉開關後，過 30 秒一定生效（其他 isolate 的延遲上限）", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { speed_reading_exam: true } });
    expect((await call(db, token("sub-a"), banner)).status).toBe(200);
    db.tables.app_feature_settings[0].enabled = false;
    vi.setSystemTime(Date.now() + 29_000);
    expect((await call(db, token("sub-a"), banner)).status).toBe(200);
    vi.setSystemTime(Date.now() + 2_000);
    const closed = await call(db, token("sub-a"), banner);
    expect(closed.status).toBe(403);
    expect(closed.body.error).toBe("speed_reading_exam_feature_disabled");
  });

  it("透過 nlc-data 關開關：同一個 isolate 立刻生效", async () => {
    const admin = person("admin-1", { role_id: ADMIN_ROLE, role_definition: { code: "admin" } });
    const db = makeDb({ profiles: [...CHURCH, admin], identities: [...IDENTITIES, ["sub-admin", "admin-1"]], flags: { speed_reading_exam: true } });
    expect((await call(db, token("sub-admin"), banner)).status).toBe(200);
    await call(db, token("sub-admin"), {
      action: "update",
      table: "app_feature_settings",
      payload: { enabled: false },
      filters: [{ type: "eq", column: "key", value: "speed_reading_exam" }]
    });
    expect((await call(db, token("sub-admin"), banner)).status).toBe(403);
  });

  it("讀取失敗當作關閉（fail closed），但不快取，下一個請求重讀", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { speed_reading_exam: true } });
    db.flagError = true;
    expect((await call(db, token("sub-a"), banner)).status).toBe(403);
    db.flagError = false;
    expect((await call(db, token("sub-a"), banner)).status).toBe(200);
  });

  it("沒有這個開關＝關閉", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { daily_quiz: true } });
    expect((await call(db, token("sub-a"), banner)).status).toBe(403);
  });

  it("牧養分享牆關閉時，讀取回空陣列、寫入被拒（語意不變）", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES, flags: { pastoral_sharing_wall: false } });
    expect((await call(db, token("sub-a"), { action: "select", table: "devotional_notes", select: "id" })).body).toEqual({ data: [] });
    expect((await call(db, token("sub-a"), { action: "insert", table: "devotional_notes", payload: { body: "x" } })).status).toBe(403);
    expect(db.count("devotional_notes")).toBe(0);
  });
});

describe("plan_report", () => {
  it("visibleIds 和計畫列同時開始查，不是依序", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const planId = "11111111-1111-4111-8111-111111111111";
    db.tables.global_plans = [{ id: planId, name: "計畫", plan_kind: "other", start_date: "2026-01-01", end_date: "2026-12-31", target_books: [], rules: {} }];
    // 身分解析之後才開始計：計畫列要等 visibleIds 開始查才放行，依序跑的話會卡死
    let scopeStarted;
    const scopeStartedPromise = new Promise((resolve) => { scopeStarted = resolve; });
    let planStarted;
    const planStartedPromise = new Promise((resolve) => { planStarted = resolve; });
    db.beforeExec = async (query) => {
      if (query.table === "global_plans") { planStarted(); await scopeStartedPromise; }
      if (query.table === "profiles" && query.columns === "id") { scopeStarted(); await planStartedPromise; }
    };
    const timeout = new Promise((resolve) => setTimeout(() => resolve("deadlock"), 2000));
    const result = await Promise.race([
      call(db, token("sub-a"), { action: "plan_summary", args: { p_global_plan_id: planId } }),
      timeout
    ]);
    expect(result).not.toBe("deadlock");
    expect(db.count("profiles", isScopeQuery)).toBe(1);
    const overview = db.rpcs.find((row) => row.fn === "get_pastoral_overview");
    expect([...overview.args.p_visible_ids].sort()).toEqual(["east-1", "east-2", "leader-a"]);
    expect(overview.args.p_whole_church).toBe(false);
  });

  it("計畫 id 不合法：不查範圍也不查計畫", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const { status } = await call(db, token("sub-a"), { action: "plan_summary", args: { p_global_plan_id: "nope" } });
    expect(status).toBe(400);
    expect(db.count("profiles", isScopeQuery)).toBe(0);
    expect(db.count("global_plans")).toBe(0);
  });

  it("會友不能用 plan_report", async () => {
    const db = makeDb({ profiles: CHURCH, identities: IDENTITIES });
    const { status } = await call(db, token("sub-east-1"), { action: "plan_summary", args: {} });
    expect(status).toBe(403);
    expect(db.count("profiles", isScopeQuery)).toBe(0);
  });
});
