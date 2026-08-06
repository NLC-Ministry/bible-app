import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const foundation = read("supabase/migrations/0047_role_definitions_and_church_pastor.sql");
const authority = read("supabase/migrations/0048_member_hub_role_uuid_authority.sql");
const state = read("js/state.js");
const profile = read("js/modules/profile.js");
const admin = read("js/modules/admin.js");
const plan = read("js/modules/plan.js");
const db = read("js/db.js");
const dataEdge = read("supabase/functions/nlc-data/index.ts");
const sessionEdge = read("supabase/functions/nlc-session/index.ts");

describe("Member Hub UUID role authority", () => {
  it("keeps mutable labels behind immutable role UUID relationships", () => {
    expect(foundation).toContain("CREATE TABLE IF NOT EXISTS public.role_definitions");
    expect(foundation).toContain("id UUID PRIMARY KEY");
    expect(foundation).toContain("ADD COLUMN IF NOT EXISTS role_id UUID");
    expect(authority).toContain("hub_permission_keys TEXT[]");
    expect(authority).toContain("hub_permission_labels TEXT[]");
    expect(authority).toContain("ALTER TABLE public.profiles DROP COLUMN role");
  });

  it("resolves Member Hub identity keys and labels to role UUIDs at login", () => {
    expect(sessionEdge).toContain("collectHubPermissionSignals");
    expect(sessionEdge).toContain('.from("role_definitions")');
    expect(sessionEdge).toContain("hub_permission_keys");
    expect(sessionEdge).toContain("hub_permission_labels");
    expect(sessionEdge).toContain("role_id: syncedRoleId");
    expect(sessionEdge).not.toContain("role: syncedRole");
  });

  it("removes local role assignment and derives authorization from the linked definition", () => {
    expect(state).toContain("function getUserRoleCode");
    expect(state).toContain("window.getUserRoleCode = getUserRoleCode");
    expect(state).toContain("window.getRoleDefinition = getRoleDefinition");
    expect(state).toContain("user.role_definition?.code");
    expect(db).not.toContain("async updateUserRole");
    expect(admin).not.toContain("renderAdminUserManagement");
    expect(dataEdge).toContain("role_assignment_managed_by_member_hub");
    expect(profile).toContain("roleDefinition?.label");
    expect(plan).not.toContain("isRealAdmin");
    expect(plan).not.toContain("isSimulatedAdmin");
  });

  it("gives church pastors whole-church plan scope but not permission management", () => {
    expect(state).toContain('role === "admin" || role === "senior_pastor"');
    expect(dataEdge).toContain('["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"]');
    expect(admin).toContain("return role === 'admin'");
    expect(authority).toContain("is_assignable = FALSE");
  });
});