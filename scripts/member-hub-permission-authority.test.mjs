import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("Member Hub-only permission management", () => {
  const admin = read("js/modules/admin.js");
  const app = read("js/app.js");
  const state = read("js/state.js");
  const issueUi = read("js/modules/issue-report-ui.js");
  const db = read("js/db.js");
  const edge = read("supabase/functions/nlc-data/index.ts");
  const sessionEdge = read("supabase/functions/nlc-session/index.ts");
  const migration = read("supabase/migrations/0048_member_hub_role_uuid_authority.sql");
  const html = read("index.html");

  it("removes the local user-permission entry and its supporting code", () => {
    expect(html).toContain('data-admin-panel="system">系統管理</button>');
    expect(html).not.toContain("admin-users-accordion-root");
    expect(html).not.toContain("使用者權限管理");
    expect(admin).not.toContain("renderAdminUserManagement");
    expect(admin).not.toContain("adminFilters");
    expect(app).not.toContain("renderAdminUserManagement");
    expect(issueUi).not.toContain("AdminUsersAccordion");
    expect(state).not.toContain("adminFilters");
    expect(existsSync(new URL("../components/issue-report/AdminUsersAccordion.tsx", import.meta.url))).toBe(false);
  });

  it("keeps role assignment read-only and synchronized from Member Hub", () => {
    expect(db).not.toContain("async updateUserRole");
    expect(edge).toContain('Object.prototype.hasOwnProperty.call(body.payload || {}, "role_id")');
    expect(edge).toContain("role_assignment_managed_by_member_hub");
    expect(sessionEdge).toContain("resolveSyncedRoleId");
    expect(sessionEdge).toContain("role_id: syncedRoleId");
    expect(migration).toContain("role assignment is managed by Member Hub");
    expect(migration).toContain("ALTER TABLE public.profiles DROP COLUMN role");
  });

  it("bumps the application cache key", () => {
    expect(html).toContain("js/app.js?v=20260802_pwa_shell_recovery");
  });
});