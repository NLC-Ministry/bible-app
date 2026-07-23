import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/0020_unify_admin_role.sql");
const html = read("index.html");
const plan = read("js/modules/plan.js");
const profile = read("js/modules/profile.js");
const admin = read("js/modules/admin.js");
const dataEdge = read("supabase/functions/nlc-data/index.ts");
const sessionEdge = read("supabase/functions/nlc-session/index.ts");

describe("single administrator role", () => {
  it("converts existing retired-role accounts before tightening the constraint", () => {
    expect(migration.indexOf("UPDATE public.profiles")).toBeLessThan(migration.indexOf("ADD CONSTRAINT profiles_role_check"));
    expect(migration).toContain("SET role = 'admin'");
    expect(migration).toContain("WHERE role = 'senior_pastor'");
    expect(migration).toContain("'great_zone_leader', 'admin'" );
  });

  it("removes the retired role from user-facing role selectors and labels", () => {
    for (const source of [html, plan, profile, admin]) {
      expect(source).not.toContain("senior_pastor");
      expect(source).not.toContain("主任牧師");
    }
  });

  it("uses admin as the only full-system role", () => {
    expect(dataEdge).toContain('return profile?.role === "admin";');
    expect(dataEdge).not.toContain('profile?.role === "senior_pastor"');
    expect(plan).not.toContain("senior_pastor");
  });

  it("normalizes a legacy identity value during the deployment transition", () => {
    expect(sessionEdge).toContain('existing === "senior_pastor"');
    expect(sessionEdge).toContain('strong ? "admin" : "member"');
  });
});
