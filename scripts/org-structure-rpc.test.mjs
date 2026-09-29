import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = readFileSync(join(root, "supabase", "migrations", "0166_get_org_structure_tree.sql"), "utf8");
const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
const db = readFileSync(join(root, "js", "db.js"), "utf8");

describe("migration 0166: get_org_structure_tree", () => {
  it("returns distinct region/zone/group + the sort-order maps in one JSONB", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_org_structure_tree(");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("jsonb_agg(DISTINCT jsonb_build_object(");
    expect(migration).toContain("'great_region',  profile.great_region");
    expect(migration).toContain("jsonb_build_object('rows', v_rows, 'regionSort', v_region_sort, 'zoneSort', v_zone_sort)");
  });

  it("filters by the role + scope PASSED IN (never re-derives role) so it matches applyForcedScope", () => {
    expect(migration).toMatch(/p_role_code\s+TEXT\s+DEFAULT 'member'/);
    expect(migration).toMatch(/p_scope_regions TEXT\[\]/);
    expect(migration).toContain("v_whole_church BOOLEAN := p_role_code IN ('admin', 'pastor')");
    expect(migration).toContain("profile.id = p_actor_id"); // a plain member always sees at least their own row
    expect(migration).toContain("p_role_code = 'great_zone_leader' AND profile.great_region  = ANY(p_scope_regions)");
    expect(migration).toContain("p_role_code = 'zone_leader'        AND profile.pastoral_zone = ANY(p_scope_zones)");
    expect(migration).toContain("p_role_code = 'group_leader'       AND profile.small_group   = ANY(p_scope_groups)");
  });

  it("latest definition (#263): leader rows only count active members", () => {
    const latest = readFileSync(join(root, "supabase", "migrations", "20260929093001_drop_profiles_is_demo.sql"), "utf8");
    const start = latest.indexOf("CREATE OR REPLACE FUNCTION public.get_org_structure_tree(");
    const block = latest.slice(start, latest.indexOf("-- ──", start + 1));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("profile.is_active = TRUE AND (");
    expect(block).toContain("OR profile.id = resolved_actor_id");
    expect(block).not.toContain(["is", "demo"].join("_"));
  });

  it("tolerates the sort-order tables not existing yet (older DBs)", () => {
    expect(migration).toContain("EXCEPTION WHEN undefined_table THEN v_region_sort := '{}'::JSONB");
  });
});

describe("nlc-data: get_org_structure_tree wiring", () => {
  it("is allowlisted and injects the caller's resolved role + managed scope", () => {
    expect(edge).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*"get_org_structure_tree"/);
    const inject = edge.slice(edge.indexOf('if (functionName === "get_org_structure_tree")'), edge.indexOf('} else if (functionName === "publish_global_plan_rules"'));
    expect(inject).toContain("p_actor_id: profile.id");
    expect(inject).toContain("p_role_code: getProfileRoleCode(profile)");
    expect(inject).toContain("p_scope_regions: splitScope(profile.managed_regions || profile.great_region)");
    expect(inject).toContain("p_scope_zones: splitScope(profile.managed_zones || profile.pastoral_zone)");
    expect(inject).toContain("p_scope_groups: splitScope(profile.managed_groups || profile.small_group)");
  });

  it("splitScope is the SAME helper getVisibleProfileIds uses (module-level, one definition)", () => {
    expect(edge).toContain("function splitScope(value: unknown): string[] {");
    expect((edge.match(/const splitScope = /g) || []).length).toBe(0);
  });
});

describe("db.loadOrgStructure: RPC-first, old path as fallback", () => {
  const fn = db.slice(db.indexOf("async loadOrgStructure()"), db.indexOf("async loadOrgStructure()") + 4000);

  it("prefers get_org_structure_tree and only scans profiles when it is unavailable", () => {
    expect(fn).toContain('state.supabase.rpc("get_org_structure_tree", {})');
    expect(fn).toContain("Array.isArray(tree.rows)");
    expect(fn).toContain("regionSortOrder = tree.regionSort || {}");
    expect(fn).toMatch(/if \(!usedRpc\) \{[\s\S]*fetchAllRows\(\(\) => state\.supabase[\s\S]*from\("profiles"\)/);
    expect(fn).toMatch(/if \(!usedRpc\) \{[\s\S]*this\.batchSelect\(\[/);
  });
});
