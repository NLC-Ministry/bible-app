import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("Member Hub-managed permissions with small-group filters disabled", () => {
  const component = read("components/issue-report/AdminUsersAccordion.tsx");
  const admin = read("js/modules/admin.js");
  const db = read("js/db.js");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const migration = read("supabase/migrations/0048_member_hub_role_uuid_authority.sql");
  const html = read("index.html");

  it("removes the small-group filter from permission management", () => {
    expect(component).toContain('id="chip-filter-region"');
    expect(component).toContain('id="chip-filter-zone"');
    expect(component).not.toContain('id="chip-filter-group"');
    expect(admin).toContain('["region", "zone"].forEach');
    expect(admin).not.toContain("state.adminFilters.group");
  });

  it("does not offer a local role editor", () => {
    expect(admin).not.toContain("export function openMemberEditBottomSheet");
    expect(admin).toContain("權限由教會系統統一管理");
    expect(db).not.toContain("async updateUserRole");
  });

  it("rejects every local role assignment and permits Hub synchronization", () => {
    expect(edge).toContain('Object.prototype.hasOwnProperty.call(body.payload || {}, "role_id")');
    expect(edge).toContain("role_assignment_managed_by_member_hub");
    expect(migration).toContain("role assignment is managed by Member Hub");
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_prevent_group_leader_assignment");
    expect(migration).toContain("ALTER TABLE public.profiles DROP COLUMN role");
  });

  it("bumps the application cache key", () => {
    expect(html).toContain("js/app.js?v=20260730_hub_role_uuid_authority_v3");
  });
});