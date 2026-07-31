import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0052_admin_registration_statistics.sql", "utf8");
const edge = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
const db = readFileSync("js/db.js", "utf8");
const admin = readFileSync("js/modules/admin.js", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("css/admin-registration-statistics.css", "utf8");

describe("admin registration statistics", () => {
  it("aggregates active real accounts and selected-plan signups by great region and pastoral zone", () => {
    expect(migration).toContain("get_admin_registration_statistics");
    expect(migration).toContain("profile.is_active = TRUE");
    expect(migration).toContain("profile.is_demo = FALSE");
    expect(migration).toContain("reading_plan.global_plan_id = p_global_plan_id");
    expect(migration).toContain("BTRIM(profile.great_region)");
    expect(migration).toContain("BTRIM(profile.pastoral_zone)");
    expect(migration).toContain("'greatRegions'");
    expect(migration).toContain("'未設定牧區'");
    expect(migration).toContain("'pastoralZones'");
  });

  it("keeps the report admin-only across direct and Member Hub auth paths", () => {
    expect(migration).toContain("actor_role IS DISTINCT FROM 'admin'");
    expect(migration).toContain("registration_statistics_admin_required");
    expect(edge).toContain('"get_admin_registration_statistics"');
    expect(edge).toContain("ADMIN_RPC_FUNCTIONS.has(functionName) && !isAdmin(profile)");
    expect(edge).toContain("ADMIN_RPC_FUNCTIONS.has(functionName)");
  });

  it("renders both summaries in system permission management", () => {
    expect(html).toContain('id="admin-registration-statistics-col"');
    expect(html).toContain("權限管理");
    expect(html).toContain("報名與註冊統計");
    expect(admin).toContain('renderAdminRegistrationStatisticsTable("大區統計", "大區"');
    expect(admin).toContain('renderAdminRegistrationStatisticsTable("牧區統計", "牧區"');
    expect(db).toContain('getAdminRegistrationStatistics(globalPlanId)');
    expect(css).toContain(".admin-registration-statistics__tables");
  });

  it("always offers the first stage even before global plans finish loading", () => {
    expect(admin).toContain("buildAdminRegistrationStatisticsPlans(");
    expect(admin).not.toContain('typeof isUuid !== "function"');
  });

  it("exports UTF-8 text in the requested slash-delimited format", () => {
    expect(admin).toContain('"大區 / 報名人數 / 註冊人數"');
    expect(admin).toContain('"牧區 / 報名人數 / 註冊人數"');
    expect(admin).toContain('].join("/")');
    expect(admin).toContain('new Blob(["\\uFEFF", text]');
    expect(admin).toContain('type: "text/plain;charset=utf-8"');
    expect(admin).toContain("報名與註冊統計-${planName}-");
  });

  it("bumps the browser cache keys for the new UI", () => {
    expect(html).toContain("index.css?v=20260731_bulk_plan_invites");
    expect(html).toContain("css/admin-registration-statistics.css?v=20260731_admin_management_refine");
    expect(html).toContain("js/app.js?v=20260731_batched_merged_users");
  });
});
