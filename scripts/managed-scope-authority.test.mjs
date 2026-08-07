import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/0054_managed_scope_authority.sql");
const nullWriteFix = read("supabase/migrations/0068_fix_managed_scope_null_write.sql");
const sessionEdge = read("supabase/functions/nlc-session/index.ts");
const dataEdge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const admin = read("js/modules/admin.js");
const html = read("index.html");

describe("managed scope authority", () => {
  it("keeps role identity separate from delegated multi-value scope", () => {
    expect(migration).toContain("Personal placement remains in great_region");
    expect(migration).toContain("delegated scope remains in managed_*");
    expect(migration).toContain("COALESCE(NULLIF(profile.managed_regions, ''), profile.great_region)");
    expect(migration).toContain("COALESCE(NULLIF(profile.managed_zones, ''), profile.pastoral_zone)");
    expect(migration).toContain("COALESCE(NULLIF(profile.managed_groups, ''), profile.small_group)");
  });

  it("allows only administrators to save known organization scope names", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_profile_managed_scopes");
    expect(migration).toContain("actor_role IS DISTINCT FROM 'admin'");
    expect(migration).toContain("managed_scope_unknown_region");
    expect(migration).toContain("managed_scope_unknown_zone");
    expect(migration).toContain("managed_scope_unknown_group");
    expect(migration).toContain("FROM public.great_regions");
    expect(migration).toContain("FROM public.pastoral_zones");
    expect(migration).toContain("FROM public.small_groups");
  });

  it("keeps only the scope column matching the Member Hub role", () => {
    expect(migration).toContain("target_role = 'great_zone_leader'");
    expect(migration).toContain("target_role = 'zone_leader'");
    expect(migration).toContain("target_role = 'group_leader'");
    expect(migration).toContain("normalized_zones := ARRAY[]::TEXT[]");
    expect(migration).toContain("normalized_groups := ARRAY[]::TEXT[]");
    expect(migration).toContain("normalized_regions := ARRAY[]::TEXT[]");
  });

  it("prevents members from changing their own delegated scopes", () => {
    expect(migration).toContain("NEW.managed_regions IS DISTINCT FROM OLD.managed_regions");
    expect(migration).toContain("NEW.managed_zones IS DISTINCT FROM OLD.managed_zones");
    expect(migration).toContain("NEW.managed_groups IS DISTINCT FROM OLD.managed_groups");
  });

  it("uses managed groups in Edge visibility and leaves members self-only", () => {
    expect(dataEdge).toContain('roleCode === "group_leader"');
    expect(dataEdge).toContain("profile.managed_groups || profile.small_group");
    expect(dataEdge).toContain('query = query.in("small_group", groups)');
    expect(dataEdge).toContain("return [profile.id]");
  });

  it("does not let Member Hub placement synchronization overwrite local scopes", () => {
    const payloadStart = sessionEdge.indexOf("const profilePayload");
    const payloadEnd = sessionEdge.indexOf("if (memberId)", payloadStart);
    const profilePayload = sessionEdge.slice(payloadStart, payloadEnd);
    expect(profilePayload).not.toContain("managed_regions");
    expect(profilePayload).not.toContain("managed_zones");
    expect(profilePayload).not.toContain("managed_groups");
  });

  it("provides an admin multi-select editor without restoring local role assignment", () => {
    expect(html).toContain('id="admin-managed-scopes-col"');
    expect(html).toContain("角色由會員中心同步");
    expect(html).toContain("不包含一般會友");
    expect(admin).toContain('(result.data || []).filter(profile => getUserRoleCode(profile) !== "member")');
    expect(admin).toContain("renderAdminManagedScopes");
    expect(admin).toContain("getManagedScopeConfig");
    expect(html).toContain("全選");
    expect(db).toContain('rpc("set_profile_managed_scopes"');
    expect(db).not.toContain("async updateUserRole");
  });

  it("cache-busts the changed application and scope-editor stylesheet", () => {
    expect(html).toMatch(/js\/app\.js\?v=2026\d{4}_/);
    expect(html).toMatch(/index\.css\?v=2026\d{4}_/);
  });

  it("never writes NULL into the NOT NULL managed_* columns", () => {
    // Regression guard: a partial scope backfill (e.g. only managedRegions
    // supplied) used to fall back to `|| null` for the other two columns,
    // which violates their `NOT NULL DEFAULT ''` constraint (migration 0011)
    // and made every backfill call fail with a 400 from nlc-data.
    expect(db).not.toContain('managed_regions: normRegions.join(",") || null');
    expect(db).not.toContain('managed_zones: normZones.join(",") || null');
    expect(db).not.toContain('managed_groups: normGroups.join(",") || null');
    expect(db).toContain("managed_regions: normRegions.join(\",\")");
    expect(db).toContain("managed_zones: normZones.join(\",\")");
    expect(db).toContain("managed_groups: normGroups.join(\",\")");

    // The RPC fallback must use the same '' sentinel, not NULLIF(...).
    expect(nullWriteFix).not.toContain("NULLIF(ARRAY_TO_STRING(normalized_regions");
    expect(nullWriteFix).not.toContain("NULLIF(ARRAY_TO_STRING(normalized_zones");
    expect(nullWriteFix).not.toContain("NULLIF(ARRAY_TO_STRING(normalized_groups");
    expect(nullWriteFix).toContain("managed_regions = ARRAY_TO_STRING(normalized_regions, ',')");
    expect(nullWriteFix).toContain("managed_zones = ARRAY_TO_STRING(normalized_zones, ',')");
    expect(nullWriteFix).toContain("managed_groups = ARRAY_TO_STRING(normalized_groups, ',')");
  });
});
