import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/0047_role_definitions_and_church_pastor.sql");
const state = read("js/state.js");
const profile = read("js/modules/profile.js");
const admin = read("js/modules/admin.js");
const db = read("js/db.js");
const dataEdge = read("supabase/functions/nlc-data/index.ts");
const sessionEdge = read("supabase/functions/nlc-session/index.ts");

describe("UUID-backed church pastor role", () => {
  it("stores mutable labels behind immutable role UUID relationships", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.role_definitions");
    expect(migration).toContain("id UUID PRIMARY KEY");
    expect(migration).toContain("'senior_pastor', '教會牧者'");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS role_id UUID");
    expect(migration).toContain("profiles_role_definition_fkey");
    expect(migration).toContain("FOREIGN KEY (role_id) REFERENCES public.role_definitions(id)");
    expect(migration).toContain("sync_profile_role_reference");
  });

  it("uses Supabase role labels in the permission editor", () => {
    expect(db).toContain('.from("role_definitions")');
    expect(admin).toContain("db.fetchRoleDefinitions()");
    expect(admin).toContain("role.label");
    expect(profile).toContain("roleDefinition?.label");
    expect(state).toContain("roleDefinitions: []");
  });

  it("gives church pastors whole-church plan scope but no permission management", () => {
    expect(state).toContain('role === "admin" || role === "senior_pastor"');
    expect(dataEdge).toContain('["admin", "senior_pastor", "great_zone_leader", "zone_leader"]');
    expect(admin).toContain("const MANAGEMENT_ROLES = ['admin', 'senior_pastor'");
    expect(admin).toContain("return role === 'admin'");
    expect(migration).toContain("can_manage_permissions, scope_type");
    expect(migration).toContain("'senior_pastor', '教會牧者', 20, TRUE, TRUE, FALSE, 'church'");
    expect(migration).toContain("IF actor_role = 'admin' THEN RETURN NEW");
  });

  it("preserves a strongly linked church-pastor account without weak-link escalation", () => {
    expect(sessionEdge).toContain('existing === "senior_pastor"');
    expect(sessionEdge).toContain('strong ? "senior_pastor" : "member"');
  });
});