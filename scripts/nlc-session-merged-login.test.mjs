// #665：合併帳號後用另一種方式登入，這次的會員不是帳號原本的會員。
// 實際跑 nlc-session 的 handler（假的資料庫與外部 API），斷言寫進資料庫與回傳前端的值，
// 不比對原始碼字串。
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__nlcSessionFakeDb.client()
}));
vi.mock("https://esm.sh/jose@5.9.6", () => ({}));

const LEADER_ROLE_ID = "role-leader";
const MEMBER_ROLE_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "profile-1";
const OLD_SYNC = "2026-10-01T00:00:00.000Z";

function makeFakeDb({ profile, identities }) {
  const db = {
    profile: profile ? { ...profile } : null,
    identities: identities.map((row) => ({ ...row })),
    orgUpserts: [],
    client() {
      return { from: (table) => new Query(db, table), rpc: async () => ({ data: null, error: null }) };
    }
  };
  return db;
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = {};
    this.selectColumns = "";
    this.op = "select";
  }
  select(columns = "") { this.selectColumns = columns; return this; }
  eq(column, value) { this.filters[column] = value; return this; }
  ilike(column, value) { this.filters[`ilike:${column}`] = value; return this; }
  order() { return this; }
  limit() { return this; }
  update(values) { this.op = "update"; this.values = values; return this; }
  upsert(values) { this.op = "upsert"; this.values = values; return this; }
  maybeSingle() { return Promise.resolve(this.run(true)); }
  single() { return Promise.resolve(this.run(true)); }
  then(resolve, reject) { return Promise.resolve(this.run(false)).then(resolve, reject); }

  matches(row) {
    return Object.entries(this.filters).every(([key, value]) => {
      if (key.startsWith("ilike:")) {
        return String(row[key.slice(6)] || "").toLowerCase() === String(value).toLowerCase();
      }
      return row[key] === value;
    });
  }
  run(one) {
    const finish = (rows) => ({ data: one ? (rows[0] ?? null) : rows, error: null });
    if (this.table === "role_definitions") {
      return finish([
        { id: LEADER_ROLE_ID, code: "leader", label: "小組長", sort_order: 1, hub_permission_keys: ["leader"], hub_permission_labels: [] },
        { id: MEMBER_ROLE_ID, code: "member", label: "會友", sort_order: 9, hub_permission_keys: [], hub_permission_labels: [] }
      ]);
    }
    if (["great_regions", "pastoral_zones", "small_groups"].includes(this.table)) {
      this.db.orgUpserts.push({ table: this.table, values: this.values });
      return finish([{ id: `${this.table}:${this.values.name}` }]);
    }
    if (this.table === "profiles") return this.runProfiles(finish);
    if (this.table === "user_identities") return this.runIdentities(finish);
    throw new Error(`unexpected table ${this.table}`);
  }
  runProfiles(finish) {
    if (this.op === "upsert") {
      this.db.profile = { ...(this.db.profile || {}), ...this.values };
      return finish([{ ...this.db.profile }]);
    }
    const rows = this.db.profile && this.matches(this.db.profile) ? [{ ...this.db.profile }] : [];
    return finish(rows);
  }
  runIdentities(finish) {
    if (this.op === "update") {
      this.db.identities.filter((row) => this.matches(row)).forEach((row) => Object.assign(row, this.values));
      return finish([]);
    }
    if (this.op === "upsert") {
      const existing = this.db.identities.find((row) => row.provider_user_id === this.values.provider_user_id);
      if (existing) Object.assign(existing, this.values);
      else this.db.identities.push({ ...this.values });
      return finish([]);
    }
    const rows = this.db.identities.filter((row) => this.matches(row)).map((row) => ({
      ...row,
      // PostgREST 的 metadata->>membership_status 別名
      membership_status: row.metadata?.membership_status ?? null
    }));
    return finish(rows);
  }
}

function hubContext({ memberId, membershipStatus = "訪客", placement = null, roles = [], displayName = "王小明", email = "someone@example.test" }) {
  return {
    identity: { memberId, email },
    profile: { displayName, membershipStatus },
    roles,
    organization: placement
      ? { placementNodeName: placement.name, placementLevelName: placement.level, placementNodeId: "node-1" }
      : {},
    membershipState: "approved",
    hasRequiredPlacement: Boolean(placement),
    memberJourney: { contractVersion: `journey-of-${memberId}` }
  };
}

function stubFetch({ sub, context, platformOrganization = null, platformFails = false, userinfo = {} }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return json({ userinfo_endpoint: "https://sso.test/userinfo" });
    if (url === "https://sso.test/userinfo") return json({ sub, email: "someone@example.test", ...userinfo });
    if (url.endsWith("/api/me/context")) return json({ ok: true, context });
    if (url.includes("/organization")) {
      return platformFails ? json({ error: "down" }, 503) : json({ organization: platformOrganization });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

const CARE_CHAIN = (zone) => ({
  careChain: [
    { levelDepth: 0, name: "新大區" },
    { levelDepth: 1, name: zone },
    { levelDepth: 2, name: "新小組" }
  ]
});

function accountProfile(overrides = {}) {
  return {
    id: PROFILE_ID,
    name: "王小明",
    email: "phone-account@example.test",
    nlc_member_id: "member-phone",
    role_id: LEADER_ROLE_ID,
    great_region: "原大區",
    great_region_id: "region-id",
    pastoral_zone: "原牧區",
    pastoral_zone_id: "zone-id",
    small_group: "原小組",
    small_group_id: "group-id",
    member_context_synced_at: OLD_SYNC,
    member_context_contract_version: "journey-of-member-phone",
    member_context_placement_state: "placed",
    member_context_required_action: "原本的動作",
    member_context_leadership_display_label: "小組長",
    member_context_leadership_primary_assignment_id: "assignment-1",
    member_context_leadership_assignments: [{ id: "assignment-1" }],
    last_seen_at: OLD_SYNC,
    ...overrides
  };
}

function mergedIdentities() {
  return [
    {
      profile_id: PROFILE_ID,
      provider: "logto",
      provider_user_id: "sub-phone",
      is_primary: true,
      last_seen_at: OLD_SYNC,
      metadata: { membership_status: "正式會友" }
    },
    {
      profile_id: PROFILE_ID,
      provider: "logto",
      provider_user_id: "sub-email",
      is_primary: false,
      last_seen_at: OLD_SYNC,
      metadata: { membership_status: "訪客" }
    }
  ];
}

let handler;
let warn;
let info;

async function login(db) {
  globalThis.__nlcSessionFakeDb = db;
  const response = await handler(new Request("https://edge.test/nlc-session", {
    method: "POST",
    body: JSON.stringify({ access_token: "opaque-token" })
  }));
  return { status: response.status, body: await response.json() };
}

function expectAccountKept(db) {
  const { profile } = db;
  expect(profile.nlc_member_id).toBe("member-phone");
  expect(profile.great_region).toBe("原大區");
  expect(profile.pastoral_zone).toBe("原牧區");
  expect(profile.small_group).toBe("原小組");
  expect(profile.great_region_id).toBe("region-id");
  expect(profile.pastoral_zone_id).toBe("zone-id");
  expect(profile.small_group_id).toBe("group-id");
  expect(profile.role_id).toBe(LEADER_ROLE_ID);
  expect(profile.member_context_synced_at).toBe(OLD_SYNC);
  expect(profile.member_context_contract_version).toBe("journey-of-member-phone");
  expect(profile.member_context_placement_state).toBe("placed");
  expect(profile.member_context_required_action).toBe("原本的動作");
  expect(profile.member_context_leadership_display_label).toBe("小組長");
  expect(profile.member_context_leadership_primary_assignment_id).toBe("assignment-1");
  expect(profile.member_context_leadership_assignments).toEqual([{ id: "assignment-1" }]);
}

beforeAll(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
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
});

afterAll(() => {
  warn.mockRestore();
  info.mockRestore();
  vi.unstubAllGlobals();
  delete globalThis.__nlcSessionFakeDb;
});

describe("nlc-session：這次登入的會員不是帳號原本的會員（#665）", () => {
  let db;

  beforeEach(() => {
    db = makeFakeDb({ profile: accountProfile(), identities: mergedIdentities() });
  });

  it("這次沒有牧區、帳號原本有：保留會員 ID、組織、角色與 member_context_*", async () => {
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    const { status } = await login(db);

    expect(status).toBe(200);
    expectAccountKept(db);
    expect(db.orgUpserts).toEqual([]);
  });

  it("保留時回傳前端的 membership_status 用帳號原本的，不用這次會員的", async () => {
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    const { body } = await login(db);

    expect(body.membership_status).toBe("正式會友");
    expect(body.profile.pastoral_zone).toBe("原牧區");
  });

  it("保留時照常更新 last_seen_at 和這個 identity 的紀錄，並留下稽核", async () => {
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    const { body } = await login(db);

    expect(db.profile.last_seen_at).not.toBe(OLD_SYNC);
    const emailIdentity = db.identities.find((row) => row.provider_user_id === "sub-email");
    expect(emailIdentity.last_seen_at).not.toBe(OLD_SYNC);
    expect(emailIdentity.is_primary).toBe(true);
    expect(emailIdentity.metadata.member_context.identity.memberId).toBe("member-email");
    expect(emailIdentity.metadata.org_projection_audit.kept_account_member).toBe(true);
    expect(emailIdentity.metadata.role_resolution.status).toBe("kept_account_member");
    expect(body.org_projection_debug.projected_profile.pastoral_zone).toBe("原牧區");
  });

  it("連續兩次用同一個沒有牧區的方式登入，資料與 membership_status 都不變", async () => {
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    await login(db);
    const { body } = await login(db);

    expectAccountKept(db);
    expect(body.membership_status).toBe("正式會友");
  });

  it("平台 API 這次失敗、會員中心也沒給牧區：一樣保留，不換成這次的會員", async () => {
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }), platformFails: true });

    await login(db);

    expectAccountKept(db);
  });

  it("會員中心只給這次會員的大區、沒有牧區：不把別人的大區混進帳號", async () => {
    stubFetch({
      sub: "sub-email",
      context: hubContext({ memberId: "member-email", placement: { name: "別的大區", level: "大區" } })
    });

    await login(db);

    expectAccountKept(db);
  });

  it("這次的會員有牧區：維持現狀，用這次的值", async () => {
    stubFetch({
      sub: "sub-email",
      context: hubContext({ memberId: "member-email", roles: ["leader"] }),
      platformOrganization: CARE_CHAIN("新牧區")
    });

    const { body } = await login(db);

    expect(db.profile.nlc_member_id).toBe("member-email");
    expect(db.profile.great_region).toBe("新大區");
    expect(db.profile.pastoral_zone).toBe("新牧區");
    expect(db.profile.small_group).toBe("新小組");
    expect(db.profile.member_context_synced_at).not.toBe(OLD_SYNC);
    expect(body.membership_status).toBe("訪客");
    expect(body.org_projection_debug.kept_account_member).toBeUndefined();
  });

  it("這次的會員和帳號都沒有牧區：維持現狀，用這次的值", async () => {
    db = makeFakeDb({
      profile: accountProfile({ great_region: "", great_region_id: null, pastoral_zone: "", pastoral_zone_id: null, small_group: "", small_group_id: null }),
      identities: mergedIdentities()
    });
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    const { body } = await login(db);

    expect(db.profile.nlc_member_id).toBe("member-email");
    expect(db.profile.role_id).toBe(MEMBER_ROLE_ID);
    expect(body.membership_status).toBe("訪客");
  });

  it("會員 ID 相同、會員中心清空牧區：App 跟著清空，會員中心仍是權威來源", async () => {
    stubFetch({ sub: "sub-phone", context: hubContext({ memberId: "member-phone", membershipStatus: "正式會友" }) });

    await login(db);

    expect(db.profile.nlc_member_id).toBe("member-phone");
    expect(db.profile.pastoral_zone).toBe("");
    expect(db.profile.great_region).toBe("");
    expect(db.profile.small_group).toBe("");
    expect(db.profile.role_id).toBe(MEMBER_ROLE_ID);
    expect(db.profile.member_context_synced_at).not.toBe(OLD_SYNC);
  });

  it("不是透過 identity 對應進來的帳號（Email 弱連結）不保留", async () => {
    db = makeFakeDb({
      profile: accountProfile({ email: "someone@example.test" }),
      identities: []
    });
    stubFetch({ sub: "sub-new", context: hubContext({ memberId: "member-email" }) });

    await login(db);

    expect(db.profile.nlc_member_id).toBe("member-email");
    expect(db.profile.pastoral_zone).toBe("");
  });

  it("帳號還沒有會員 ID：不算換會員，用這次的值", async () => {
    db = makeFakeDb({ profile: accountProfile({ nlc_member_id: null }), identities: mergedIdentities() });
    stubFetch({ sub: "sub-email", context: hubContext({ memberId: "member-email" }) });

    await login(db);

    expect(db.profile.nlc_member_id).toBe("member-email");
    expect(db.profile.pastoral_zone).toBe("");
  });
});

// #685：保留帳號原本的會員時，姓名、Email、電話也要一起保留，不然帳號會混了兩位會員的資料。
describe("nlc-session：保留帳號原本的會員時，姓名和聯絡資料也保留（#685）", () => {
  const ACCOUNT_CONTACT = { name: "王小明", email: "phone-account@example.test", phone: "+886900000001" };
  const SESSION_CONTACT = { name: "李大華", email: "email-login@example.test", phone: "+886900000002" };

  function stubOtherMemberLogin({ platformOrganization = null } = {}) {
    stubFetch({
      sub: "sub-email",
      context: hubContext({ memberId: "member-email", displayName: SESSION_CONTACT.name, email: SESSION_CONTACT.email }),
      userinfo: { email: SESSION_CONTACT.email, phone_number: SESSION_CONTACT.phone },
      platformOrganization
    });
  }

  it("這次沒有牧區、帳號原本有：姓名、Email、電話都保留帳號原本的", async () => {
    const db = makeFakeDb({ profile: accountProfile(ACCOUNT_CONTACT), identities: mergedIdentities() });
    stubOtherMemberLogin();

    const { body } = await login(db);

    expectAccountKept(db);
    expect(db.profile.name).toBe(ACCOUNT_CONTACT.name);
    expect(db.profile.email).toBe(ACCOUNT_CONTACT.email);
    expect(db.profile.phone).toBe(ACCOUNT_CONTACT.phone);
    expect(body.profile.name).toBe(ACCOUNT_CONTACT.name);
    expect(body.profile.email).toBe(ACCOUNT_CONTACT.email);
  });

  it("保留時，這個 identity 仍記自己的 Email 和姓名，查得到這個登入方式對應到誰", async () => {
    const db = makeFakeDb({ profile: accountProfile(ACCOUNT_CONTACT), identities: mergedIdentities() });
    stubOtherMemberLogin();

    await login(db);

    const emailIdentity = db.identities.find((row) => row.provider_user_id === "sub-email");
    expect(emailIdentity.email).toBe(SESSION_CONTACT.email);
    expect(emailIdentity.display_name).toBe(SESSION_CONTACT.name);
  });

  it("帳號原本沒有電話：維持空值，不混入這次會員的電話", async () => {
    const db = makeFakeDb({ profile: accountProfile({ ...ACCOUNT_CONTACT, phone: null }), identities: mergedIdentities() });
    stubOtherMemberLogin();

    await login(db);

    expect(db.profile.phone).toBeNull();
    expect(db.profile.email).toBe(ACCOUNT_CONTACT.email);
  });

  it("這次的會員有牧區：維持現狀，姓名、Email、電話用這次的值", async () => {
    const db = makeFakeDb({ profile: accountProfile(ACCOUNT_CONTACT), identities: mergedIdentities() });
    stubOtherMemberLogin({ platformOrganization: CARE_CHAIN("新牧區") });

    await login(db);

    expect(db.profile.pastoral_zone).toBe("新牧區");
    expect(db.profile.name).toBe(SESSION_CONTACT.name);
    expect(db.profile.email).toBe(SESSION_CONTACT.email);
    expect(db.profile.phone).toBe(SESSION_CONTACT.phone);
  });

  it("會員 ID 相同：維持現狀，姓名、Email、電話照會員中心與這次登入同步", async () => {
    const db = makeFakeDb({ profile: accountProfile(ACCOUNT_CONTACT), identities: mergedIdentities() });
    stubFetch({
      sub: "sub-phone",
      context: hubContext({ memberId: "member-phone", displayName: "王曉明", email: SESSION_CONTACT.email }),
      userinfo: { email: SESSION_CONTACT.email, phone_number: SESSION_CONTACT.phone }
    });

    await login(db);

    expect(db.profile.name).toBe("王曉明");
    expect(db.profile.email).toBe(SESSION_CONTACT.email);
    expect(db.profile.phone).toBe(SESSION_CONTACT.phone);
  });
});
