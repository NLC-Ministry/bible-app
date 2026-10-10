// #395：使用者基本資料、權限管理改用 get_admin_user_directory 一次回傳＋共用快取。
// 新路徑（RPC）和舊路徑（分頁查詢）轉出來的結果必須逐筆相同。
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const PLAN_A = "00000000-0000-0000-c126-000000202610";
const PLAN_B = "00000000-0000-0000-c126-000000202609";
const ROLE_ADMIN = { id: "r-admin", code: "admin", label: "系統管理員", scope_type: "church" };
const ROLE_ZONE = { id: "r-zone", code: "zone_leader", label: "牧區長", scope_type: "zone" };

const TABLES = {
  role_definitions: [ROLE_ADMIN, ROLE_ZONE],
  profiles: [
    { id: "u3", name: "乙", email: "b@x", great_region: "一", pastoral_zone: "牧區二", small_group: "小組2", is_active: true, member_context_synced_at: "2026-09-01T00:00:00.5+00:00", member_context_sync_status: "synced", role_id: "r-zone", managed_regions: "", managed_zones: "牧區二", managed_groups: "" },
    { id: "u1", name: "甲", email: "a@x", great_region: "一", pastoral_zone: "牧區一", small_group: "小組1", is_active: true, member_context_synced_at: null, member_context_sync_status: null, role_id: "r-admin", managed_regions: null, managed_zones: null, managed_groups: null },
    { id: "u2", name: "乙", email: null, great_region: null, pastoral_zone: null, small_group: null, is_active: false, member_context_synced_at: null, member_context_sync_status: "failed", role_id: null, managed_regions: null, managed_zones: null, managed_groups: null },
    { id: "u4", name: "丁", email: "d@x", great_region: "二", pastoral_zone: "牧區三", small_group: "小組3", is_active: true, member_context_synced_at: null, member_context_sync_status: null, role_id: "r-missing", managed_regions: "", managed_zones: "", managed_groups: "" }
  ],
  reading_plans: [
    { id: "p3", user_id: "u1", global_plan_id: null, preset_key: "legacy-a" },
    { id: "p1", user_id: "u1", global_plan_id: PLAN_A, preset_key: null },
    { id: "p2", user_id: "u3", global_plan_id: PLAN_B, preset_key: "x" },
    { id: "p4", user_id: "u3", global_plan_id: null, preset_key: "unknown-key" }
  ],
  reading_team_members: [
    { team_id: "t2", user_id: "u1", global_plan_id: PLAN_A, member_role: "member" },
    { team_id: "t1", user_id: "u1", global_plan_id: PLAN_A, member_role: "captain" },
    { team_id: "t9", user_id: "u3", global_plan_id: PLAN_B, member_role: null },
    { team_id: "t3", user_id: "u3", global_plan_id: null, member_role: "member" }
  ],
  reading_teams: [
    { id: "t1", name: "火焰隊" },
    { id: "t2", name: "活水隊" },
    { id: "t3", name: "無計畫隊" }
  ]
};

const compare = (left, right) => (left == null ? 1 : right == null ? -1 : left < right ? -1 : left > right ? 1 : 0);

// 跟 SQL 相同的語意（排序 name、id；報名照 reading_plans.id；隊伍照 team_id）。
function directoryRpc(args) {
  const includeDetails = args.p_include_plan_details === true;
  const roleById = new Map(TABLES.role_definitions.map(role => [role.id, role]));
  const profiles = [...TABLES.profiles].sort((left, right) => compare(left.name, right.name) || compare(left.id, right.id));
  return {
    e: includeDetails,
    p: profiles.map(profile => {
      const role = roleById.get(profile.role_id);
      const plans = TABLES.reading_plans.filter(plan => plan.user_id === profile.id).sort((l, r) => compare(l.id, r.id));
      const members = TABLES.reading_team_members
        .filter(member => member.user_id === profile.id && member.global_plan_id)
        .sort((l, r) => compare(l.team_id, r.team_id));
      return {
        i: profile.id, n: profile.name, m: profile.email, r: profile.great_region, z: profile.pastoral_zone, g: profile.small_group,
        a: profile.is_active, s: profile.member_context_synced_at, ss: profile.member_context_sync_status, ri: profile.role_id,
        rd: role ? [role.id, role.code, role.label, role.scope_type] : null,
        mr: profile.managed_regions, mz: profile.managed_zones, mg: profile.managed_groups,
        j: includeDetails && plans.length ? plans.map(plan => [plan.global_plan_id, plan.preset_key]) : null,
        t: includeDetails && members.length
          ? members.map(member => [member.global_plan_id, TABLES.reading_teams.find(team => team.id === member.team_id)?.name ?? null, member.member_role])
          : null
      };
    })
  };
}

function embedRoleDefinition(row, selectText) {
  if (!/role_definition:role_definitions/.test(selectText)) return row;
  const role = TABLES.role_definitions.find(candidate => candidate.id === row.role_id);
  const withScope = /scope_type/.test(selectText);
  return {
    ...row,
    role_definition: role ? (withScope ? { ...role } : { id: role.id, code: role.code, label: role.label }) : null
  };
}

function pick(row, selectText) {
  const columns = selectText.replace(/role_definition:role_definitions\([^)]*\)/, "").split(",").map(part => part.trim()).filter(Boolean);
  const picked = Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
  return embedRoleDefinition({ ...picked, ...(row.role_id !== undefined && columns.includes("role_id") ? { role_id: row.role_id } : {}) }, selectText);
}

function createFakeSupabase(calls, { rpc = "directory", isAdmin = true } = {}) {
  const client = {
    from(table) {
      const filters = [];
      const orders = [];
      let selectText = "*";
      let updatePayload = null;
      const run = () => {
        let rows = (TABLES[table] || []).filter(row => filters.every(test => test(row)));
        if (orders.length) {
          rows = [...rows].sort((left, right) => {
            for (const column of orders) {
              const result = compare(left[column], right[column]);
              if (result) return result;
            }
            return 0;
          });
        }
        return rows.map(row => (selectText === "*" ? row : pick(row, selectText)));
      };
      const builder = {
        select(text) { selectText = text || "*"; return builder; },
        order(column) { if (!orders.includes(column)) orders.push(column); return builder; },
        eq(column, value) { filters.push(row => row[column] === value); return builder; },
        in(column, values) { filters.push(row => values.includes(row[column])); return builder; },
        update(payload) { updatePayload = payload; calls.push({ table, update: payload }); return builder; },
        async maybeSingle() {
          const row = (TABLES[table] || []).find(candidate => filters.every(test => test(candidate)));
          return { data: row && updatePayload ? { id: row.id, ...updatePayload } : row || null, error: null };
        },
        async range(from, to) {
          calls.push({ table, range: [from, to] });
          return { data: run().slice(from, to + 1), error: null };
        },
        then(resolve, reject) {
          calls.push({ table });
          return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  if (rpc === "directory") {
    client.rpc = async (name, args) => {
      calls.push({ rpc: name, args });
      // nlc-data 注入：admin 才有報名／隊伍明細。
      return { data: directoryRpc({ ...args, p_include_plan_details: isAdmin }), error: null };
    };
  } else if (rpc === "error") {
    client.rpc = async name => {
      calls.push({ rpc: name });
      return { data: null, error: { message: "forbidden_rpc" } };
    };
  }
  return client;
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
  vi.stubGlobal("getUserRoleCode", user => (user && (user.role_definition?.code || user.role_code)) || "member");
  vi.stubGlobal("hasWholeChurchPlanScope", user => ["admin", "pastor"].includes((user && (user.role_definition?.code || user.role_code)) || "member"));
  vi.stubGlobal("state", {
    isSupabaseMode: true,
    supabase: client,
    currentUser: { id: "u1", name: "甲", role_code: "admin" },
    currentProfileId: "u1",
    globalPlans: [{ id: "gp-legacy", presetKey: "legacy-a" }]
  });
  await import("../js/db.js?admin-user-directory-rpc");
  return dom.window.db || globalThis.db;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dom) dom.window.close();
  dom = null;
});

async function runBoth(method) {
  const pagedCalls = [];
  const pagedDb = await loadDb(createFakeSupabase(pagedCalls, { rpc: "none" }));
  const paged = await pagedDb[method]();
  vi.unstubAllGlobals();
  dom.window.close();

  const rpcCalls = [];
  const rpcDb = await loadDb(createFakeSupabase(rpcCalls));
  const viaRpc = await rpcDb[method]();
  return { paged, viaRpc, pagedCalls, rpcCalls };
}

describe("admin user directory RPC gives the same profiles as the paged path (#395)", () => {
  it("fetchAdminUserProfiles: same rows, joined_plan_ids and teams_by_plan", async () => {
    const { paged, viaRpc, pagedCalls, rpcCalls } = await runBoth("fetchAdminUserProfiles");
    expect(paged.error).toBeNull();
    expect(viaRpc.error).toBeNull();
    expect(viaRpc.data).toEqual(paged.data);
    expect(viaRpc.data.map(profile => profile.id)).toEqual(["u4", "u2", "u3", "u1"].sort((l, r) => {
      const name = id => TABLES.profiles.find(profile => profile.id === id).name;
      return compare(name(l), name(r)) || compare(l, r);
    }));
    const u1 = viaRpc.data.find(profile => profile.id === "u1");
    expect(u1.joined_plan_ids).toEqual([PLAN_A, "gp-legacy"]);
    expect(u1.teams_by_plan).toEqual({ [PLAN_A]: [{ name: "火焰隊", role: "captain" }, { name: "活水隊", role: "member" }] });
    expect(viaRpc.data.find(profile => profile.id === "u3").teams_by_plan).toEqual({ [PLAN_B]: [{ name: "", role: null }] });
    expect(rpcCalls).toEqual([{ rpc: "get_admin_user_directory", args: {} }]);
    expect(pagedCalls.filter(call => call.range).length).toBeGreaterThanOrEqual(3);
  });

  it("fetchManagedScopeProfiles: same active rows", async () => {
    const { paged, viaRpc, rpcCalls } = await runBoth("fetchManagedScopeProfiles");
    expect(viaRpc.error).toBeNull();
    expect(viaRpc.data).toEqual(paged.data);
    expect(viaRpc.data.map(profile => profile.id)).not.toContain("u2");
    expect(rpcCalls.filter(call => call.rpc)).toHaveLength(1);
  });

  it("a non-admin whole-church caller (no plan details) falls back to the paged path for the user directory", async () => {
    const calls = [];
    const db = await loadDb(createFakeSupabase(calls, { isAdmin: false }));
    const result = await db.fetchAdminUserProfiles();
    expect(result.error).toBeNull();
    expect(calls.some(call => call.table === "reading_plans")).toBe(true);
  });

  it("falls back to the paged queries when the RPC errors", async () => {
    const calls = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = await loadDb(createFakeSupabase(calls, { rpc: "error" }));
    const result = await db.fetchAdminUserProfiles();
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(TABLES.profiles.length);
    expect(calls.some(call => call.table === "profiles" && call.range)).toBe(true);
  });
});

describe("admin user directory shared cache (#395)", () => {
  it("both 權限管理 blocks and the user directory share one RPC", async () => {
    const calls = [];
    const db = await loadDb(createFakeSupabase(calls));
    await Promise.all([db.fetchManagedScopeProfiles(), db.fetchManagedScopeProfiles(), db.fetchAdminUserProfiles()]);
    await db.fetchManagedScopeProfiles();
    expect(calls.filter(call => call.rpc)).toHaveLength(1);
    expect(calls.some(call => call.table)).toBe(false);
  });

  it("updateManagedScopes clears the cache so the next read refetches", async () => {
    const calls = [];
    const db = await loadDb(createFakeSupabase(calls));
    await db.fetchManagedScopeProfiles();
    const update = await db.updateManagedScopes("u3", { managedZones: ["牧區一"] });
    expect(update.error).toBeNull();
    await db.fetchManagedScopeProfiles();
    expect(calls.filter(call => call.rpc)).toHaveLength(2);
  });

  it("a request started before an invalidation does not repopulate the cache", async () => {
    const calls = [];
    const db = await loadDb(createFakeSupabase(calls));
    const inFlight = db.fetchManagedScopeProfiles();
    db.invalidateAdminUserDirectoryCache();
    await inFlight;
    await db.fetchManagedScopeProfiles();
    expect(calls.filter(call => call.rpc)).toHaveLength(2);
  });

  it("does not cache a failed RPC", async () => {
    const calls = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = await loadDb(createFakeSupabase(calls, { rpc: "error" }));
    await db.fetchManagedScopeProfiles();
    await db.fetchManagedScopeProfiles();
    expect(calls.filter(call => call.rpc)).toHaveLength(2);
  });
});

describe("get_admin_user_directory is service_role-only and gated by nlc-data (#395)", () => {
  // 函式後來被 #473（排除個人計畫）改寫過：驗現在的定義（#458）。
  const migration = currentMigrationSql("20261002023615_admin_user_directory.sql");
  const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");

  it("migration orders like the old queries and only grants service_role", () => {
    expect(migration).toContain("ORDER BY profile.name, profile.id");
    expect(migration).toContain("ORDER BY plan.id");
    expect(migration).toContain("ORDER BY member.team_id");
    expect(migration).toContain("CASE WHEN p_actor_id IS NULL THEN NULL");
    expect(migration).toContain("SET search_path TO ''");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_admin_user_directory(boolean, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_admin_user_directory(boolean, uuid) TO service_role;");
    expect(migration).not.toMatch(/GRANT[^;]*get_admin_user_directory[^;]*\b(anon|authenticated)\b/);
  });

  it("nlc-data requires whole-church scope and injects every argument", () => {
    expect(nlcData).toContain('if (functionName === ADMIN_USER_DIRECTORY_RPC && !hasWholeChurchPlanScope(profile)) {');
    expect(nlcData).toContain("rpcArgs = { p_include_plan_details: isAdmin(profile), p_actor_id: profile.id };");
    expect(nlcData).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*ADMIN_USER_DIRECTORY_RPC,[\s\S]*\]\);/);
  });
});
