import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("permission management with small-group permissions disabled", () => {
  const component = read("components/issue-report/AdminUsersAccordion.tsx");
  const admin = read("js/modules/admin.js");
  const db = read("js/db.js");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const migration = read("supabase/migrations/0046_disable_group_leader_assignment.sql");
  const html = read("index.html");

  it("removes the small-group filter from permission management", () => {
    expect(component).toContain('id="chip-filter-region"');
    expect(component).toContain('id="chip-filter-zone"');
    expect(component).not.toContain('id="chip-filter-group"');
    expect(admin).toContain('["region", "zone"].forEach');
    expect(admin).not.toContain("state.adminFilters.group");
  });

  it("does not offer or configure the small-group leader role", () => {
    const permissionEditor = admin.slice(
      admin.indexOf("export function openMemberEditBottomSheet"),
      admin.indexOf("function updatePastoralWallControl")
    );

    expect(permissionEditor).not.toContain('{ value: "group_leader"');
    expect(permissionEditor).not.toContain('"modal-groups-container"');
    expect(permissionEditor).not.toContain('role === "group_leader"');
    expect(permissionEditor).toContain('["great_zone_leader", "zone_leader"].includes(opt.value)');
  });

  it("rejects hidden group-leader assignments in every write path", () => {
    expect(db).toContain('const assignableRoles = new Set(["member", "zone_leader", "great_zone_leader", "admin"])');
    expect(edge).toContain('body.payload?.role === "group_leader"');
    expect(edge).toContain("group_leader_assignment_disabled");
    expect(migration).toContain("BEFORE UPDATE OF role ON public.profiles");
    expect(migration).toContain("OLD.role IS DISTINCT FROM 'group_leader'");
  });

  it("bumps the application cache key", () => {
    expect(html).toContain("js/app.js?v=20260730_disable_group_permissions");
  });
});
