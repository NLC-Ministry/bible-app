// #674：nlc-session 登入同步的依序往返。實際跑 handler（假的資料庫與外部 API），
// 斷言發出的查詢與寫入內容。#665 的保留邏輯由 nlc-session-merged-login.test.mjs 守住，這裡加一條確認組織不會被搞混。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__nlcSessionFakeDb.client()
}));
vi.mock("https://esm.sh/jose@5.9.6", () => ({}));

const MEMBER_ROLE_ID = "10000000-0000-4000-8000-000000000001";

function makeDb({ profile = null, identity = null } = {}) {
  const db = {
    profile: profile ? { ...profile } : null,
    identity: identity ? { ...identity } : null,
    calls: [],
    rpcs: [],
    orgUpserts: [],
    beforeIdentityLookup: null,
    client() {
      return {
        from: (table) => new Query(db, table),
        rpc: async (fn) => {
          db.rpcs.push(fn);
          return { data: { smallGroups: 0, pastoralZones: 0, greatRegions: 0 }, error: null };
        }
      };
    },
    count(table, op = null) {
      return db.calls.filter((row) => row.table === table && (!op || row.op === op)).length;
    }
  };
  return db;
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.filters = {};
  }
  select() { return this; }
  eq(column, value) { this.filters[column] = value; return this; }
  ilike() { return this; }
  order() { return this; }
  limit() { return this; }
  update(values) { this.op = "update"; this.values = values; return this; }
  upsert(values) { this.op = "upsert"; this.values = values; return this; }
  maybeSingle() { return this; }
  single() { return this; }
  then(resolve, reject) { return this.exec().then(resolve, reject); }

  async exec() {
    const db = this.db;
    db.calls.push({ table: this.table, op: this.op });
    if (this.table === "user_identities" && this.op === "select" && db.beforeIdentityLookup) await db.beforeIdentityLookup();
    if (this.table === "role_definitions") {
      return { data: [{ id: MEMBER_ROLE_ID, code: "member", label: "會友", sort_order: 9, hub_permission_keys: [], hub_permission_labels: [] }], error: null };
    }
    if (["great_regions", "pastoral_zones", "small_groups"].includes(this.table)) {
      db.orgUpserts.push({ table: this.table, values: this.values });
      return { data: { id: `new:${this.table}:${this.values.name}` }, error: null };
    }
    if (this.table === "profiles") {
      if (this.op === "upsert") {
        db.profile = { ...(db.profile || {}), ...this.values };
        return { data: { ...db.profile }, error: null };
      }
      const hit = db.profile && Object.entries(this.filters).every(([key, value]) => db.profile[key] === value);
      return { data: hit ? { ...db.profile } : null, error: null };
    }
    if (this.table === "user_identities") {
      if (this.op === "upsert") {
        db.identity = { ...this.values };
        return { data: null, error: null };
      }
      if (this.op === "update") return { data: null, error: null };
      const hit = db.identity && db.identity.provider_user_id === this.filters.provider_user_id;
      return { data: hit ? { ...db.identity } : null, error: null };
    }
    throw new Error(`unexpected table ${this.table}`);
  }
}

const ORG = { great_region: "東大區", pastoral_zone: "一牧區", small_group: "二小組" };
const account = (overrides = {}) => ({
  id: "profile-1",
  name: "王小明",
  email: "a@example.test",
  nlc_member_id: "member-1",
  role_id: MEMBER_ROLE_ID,
  ...ORG,
  great_region_id: "region-id",
  pastoral_zone_id: "zone-id",
  small_group_id: "group-id",
  ...overrides
});
const IDENTITY = { profile_id: "profile-1", provider: "logto", provider_user_id: "sub-1" };

const CHAIN = (org) => ({
  careChain: [
    { levelDepth: 0, name: org.great_region },
    { levelDepth: 1, name: org.pastoral_zone },
    { levelDepth: 2, name: org.small_group }
  ]
});

function stubFetch(org = ORG, hooks = {}) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return json({ userinfo_endpoint: "https://sso.test/userinfo" });
    if (url === "https://sso.test/userinfo") return json({ sub: "sub-1", email: "a@example.test" });
    if (url.endsWith("/api/me/context")) {
      if (hooks.onHub) await hooks.onHub();
      return json({
        ok: true,
        context: {
          identity: { memberId: "member-1", email: "a@example.test" },
          profile: { displayName: "王小明", membershipStatus: "正式會友" },
          roles: [],
          organization: {},
          membershipState: "approved",
          memberJourney: {}
        }
      });
    }
    if (url.includes("/organization")) {
      if (hooks.onPlatform) await hooks.onPlatform();
      return json({ organization: CHAIN(org) });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

let handler;
const spies = [];

async function loadHandler() {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: (key) => ({
        SUPABASE_URL: "https://db.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        NLC_LOGTO_ISSUER: "https://sso.test/oidc",
        NLC_MEMBER_HUB_URL: "https://hub.test",
        NLC_PLATFORM_API_URL: "https://platform.test/v1"
      })[key]
    },
    serve: (fn) => { handler = fn; }
  });
  await import("../supabase/functions/nlc-session/index.ts");
}

async function login(db) {
  globalThis.__nlcSessionFakeDb = db;
  const response = await handler(new Request("https://edge.test/nlc-session", {
    method: "POST",
    body: JSON.stringify({ access_token: "opaque-token" })
  }));
  return { status: response.status, body: await response.json() };
}

function deadlockGuard(promise) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("deadlock"), 2000))]);
}

beforeEach(async () => {
  for (const method of ["warn", "info", "error"]) spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  spies.push(vi.spyOn(Math, "random").mockReturnValue(0.99));
  await loadHandler();
});

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete globalThis.__nlcSessionFakeDb;
});

describe("登入同步的往返", () => {
  it("identity 查詢和會員中心呼叫同時開始", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    let hubStarted;
    const hubStartedPromise = new Promise((resolve) => { hubStarted = resolve; });
    let identityStarted;
    const identityStartedPromise = new Promise((resolve) => { identityStarted = resolve; });
    let once = true;
    db.beforeIdentityLookup = async () => {
      if (!once) return;
      once = false;
      identityStarted();
      await hubStartedPromise;
    };
    stubFetch(ORG, { onHub: async () => { hubStarted(); await identityStartedPromise; } });
    const result = await deadlockGuard(login(db));
    expect(result).not.toBe("deadlock");
    expect(result.status).toBe(200);
  });

  it("組織沒變的老會友：不寫組織表、一次登入 5 趟 DB 往返", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch();
    const first = await login(db);
    expect(first.status).toBe(200);
    expect(db.orgUpserts).toEqual([]);
    expect(db.profile.great_region_id).toBe("region-id");
    expect(db.profile.pastoral_zone_id).toBe("zone-id");
    expect(db.profile.small_group_id).toBe("group-id");
    // identity、profile、role_definitions（第一次）、profile upsert、清 primary、identity upsert
    expect(db.calls).toHaveLength(6);

    db.calls.length = 0;
    await login(db);
    expect(db.count("role_definitions")).toBe(0);
    expect(db.calls).toHaveLength(5);
  });

  it("role_definitions 60 秒內共用，過期重讀", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch();
    await login(db);
    vi.setSystemTime(Date.now() + 59_000);
    await login(db);
    expect(db.count("role_definitions")).toBe(1);
    vi.setSystemTime(Date.now() + 2_000);
    await login(db);
    expect(db.count("role_definitions")).toBe(2);
  });

  it("換牧區：大區沒變沿用，新牧區和底下的小組要寫，不會掛到舊節點", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch({ great_region: "東大區", pastoral_zone: "新牧區", small_group: "二小組" });
    await login(db);
    expect(db.orgUpserts.map((row) => row.table)).toEqual(["pastoral_zones", "small_groups"]);
    expect(db.orgUpserts[0].values).toEqual({ name: "新牧區", great_region_id: "region-id" });
    expect(db.orgUpserts[1].values).toEqual({ name: "二小組", pastoral_zone_id: "new:pastoral_zones:新牧區" });
    expect(db.profile.great_region_id).toBe("region-id");
    expect(db.profile.pastoral_zone_id).toBe("new:pastoral_zones:新牧區");
    expect(db.profile.small_group_id).toBe("new:small_groups:二小組");
  });

  it("換大區、牧區同名：上層變了，同名牧區也要重新對到新大區底下", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch({ great_region: "西大區", pastoral_zone: "一牧區", small_group: "二小組" });
    await login(db);
    expect(db.orgUpserts.map((row) => row.table)).toEqual(["great_regions", "pastoral_zones", "small_groups"]);
    expect(db.profile.pastoral_zone_id).toBe("new:pastoral_zones:一牧區");
  });

  it("帳號還沒連到組織 id：照舊寫組織表", async () => {
    const db = makeDb({
      profile: account({ great_region_id: null, pastoral_zone_id: null, small_group_id: null }),
      identity: IDENTITY
    });
    stubFetch();
    await login(db);
    expect(db.orgUpserts.map((row) => row.table)).toEqual(["great_regions", "pastoral_zones", "small_groups"]);
  });

  it("新帳號：照舊建立，不受平行查詢影響", async () => {
    const db = makeDb();
    stubFetch();
    const { status, body } = await login(db);
    expect(status).toBe(200);
    expect(body.profile.pastoral_zone).toBe("一牧區");
    expect(db.identity.profile_id).toBe(db.profile.id);
  });

  it("identity 查詢失敗回 500，不會變成建新帳號", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    db.beforeIdentityLookup = async () => { throw new Error("db down"); };
    stubFetch();
    const { status } = await login(db);
    expect(status).toBe(500);
    expect(db.count("profiles", "upsert")).toBe(0);
  });
});

describe("prune 不再每次登入都跑", () => {
  it("大多數登入不跑，稽核如實記錄", async () => {
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch();
    await login(db);
    expect(db.rpcs).toEqual([]);
    expect(db.identity.metadata.org_resolution.org_cleanup_status).toBe("throttled");
  });

  it("抽中時跑一次；同一個 isolate 一小時內不再跑；過了才會再跑", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    Math.random.mockReturnValue(0);
    const db = makeDb({ profile: account(), identity: IDENTITY });
    stubFetch();
    await login(db);
    expect(db.rpcs).toEqual(["prune_orphaned_church_org_nodes"]);
    expect(db.identity.metadata.org_resolution.org_cleanup_status).toBe("success");
    await login(db);
    expect(db.rpcs).toHaveLength(1);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
    await login(db);
    expect(db.rpcs).toHaveLength(2);
  });

  it("會員中心連不上時不動組織（只在權威資料同步後才清）", async () => {
    Math.random.mockReturnValue(0);
    const db = makeDb({ profile: account(), identity: IDENTITY });
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify({ userinfo_endpoint: "https://sso.test/userinfo" }));
      if (url === "https://sso.test/userinfo") return new Response(JSON.stringify({ sub: "sub-1", email: "a@example.test" }));
      return new Response("down", { status: 503 });
    }));
    const { status } = await login(db);
    expect(status).toBe(200);
    expect(db.rpcs).toEqual([]);
    expect(db.identity.metadata.org_resolution.org_cleanup_status).toBe("skipped");
  });
});
