import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0052_admin_registration_statistics.sql", "utf8");
const summaryMigration = readFileSync("supabase/migrations/0055_admin_registration_summary.sql", "utf8");
const teamCountsMigration = readFileSync("supabase/migrations/0080_admin_registration_team_counts.sql", "utf8");
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

  it("adds the pastoral-zone completeness and plan participation summary", () => {
    expect(summaryMigration).toContain("'withoutPastoralZoneNotJoined'");
    expect(summaryMigration).toContain("'withoutPastoralZoneJoined'");
    expect(summaryMigration).toContain("'withPastoralZoneNotJoined'");
    expect(summaryMigration).toContain("'withPastoralZoneJoined'");
    expect(summaryMigration).toContain("'totalJoined'");
    expect(summaryMigration).toContain("'totalRegistered'");
    expect(summaryMigration).toContain("NULLIF(BTRIM(profile.pastoral_zone), '') IS NOT NULL");
    expect(admin).toContain("無牧區資料未加入計畫");
    expect(admin).toContain("總參加人數");
    expect(css).toContain(".admin-registration-statistics__summary-grid");
  });

  it("always offers the first stage even before global plans finish loading", () => {
    expect(admin).toContain("buildAdminRegistrationStatisticsPlans(");
    expect(admin).not.toContain('typeof isUuid !== "function"');
  });

  it("exports UTF-8 CSV instead of a plain-text slash-delimited file", () => {
    expect(admin).toContain("export function convertAdminRegistrationStatisticsToCSV(context)");
    expect(admin).toContain('new Blob(["\\uFEFF" + csvContent]');
    expect(admin).toContain('type: "text/csv;charset=utf-8;"');
    expect(admin).toContain("報名與註冊統計-${planName}-${todayTW}.csv");
    expect(html).toContain("匯出 CSV");
    expect(html).not.toContain("匯出文字檔");
  });

  it("orders great regions and pastoral zones by the fixed roster order, not insertion order", () => {
    expect(admin).toContain('const CHURCH_GREAT_REGION_ORDER = ["東區", "西區", "南區", "北區", "青少年", "慶典", "創藝"];');
    expect(admin).toContain('"大安1", "大安2", "大安3", "大安4", "大安6", "大安7", "大安8", "大安9", "大安10", "大安11", "大安12",');
    expect(admin).toContain("function compareByChurchOrgOrder(orderList)");
    // Rows outside the fixed list must still be exported, not silently dropped — sorted after via Infinity.
    expect(admin).toContain('const aIndex = orderIndex.has(a) ? orderIndex.get(a) : Infinity;');
    expect(admin).toContain("sortByChurchOrgOrder(greatRegions, compareGreatRegions, row => row.label)");
  });

  it("applies the same fixed 大區/牧區 order to every other CSV export (users, org structure, team registration)", () => {
    expect(admin).toContain("function sortProfilesByChurchOrgOrder(profiles)");
    expect(admin).toContain("const rows = sortProfilesByChurchOrgOrder(profiles).map(p => [");
    expect(admin).toContain('const regions = sortByChurchOrgOrder(orgStructure.regions || [], compareGreatRegions, region => region);');
    expect(admin).toContain('const zones = sortByChurchOrgOrder(zonesMap[region] || [], comparePastoralZones, zone => zone);');
    expect(admin).toContain("const sortedTeams = sortByChurchOrgOrder(teams, comparePastoralZones, team => {");
  });

  it("adds 3-person and 6-person reading-team join counts per great region and pastoral zone", () => {
    expect(teamCountsMigration).toContain("CREATE OR REPLACE FUNCTION public.get_admin_registration_statistics(");
    expect(teamCountsMigration).toContain("JOIN public.reading_teams AS rt ON rt.id = tm.team_id");
    expect(teamCountsMigration).toContain("tm.global_plan_id = p_global_plan_id");
    expect(teamCountsMigration).toContain("team3.division = 3");
    expect(teamCountsMigration).toContain("team6.division = 6");
    expect(teamCountsMigration).toContain("'team3Count', team3_count");
    expect(teamCountsMigration).toContain("'team6Count', team6_count");
    // Both rollups (pastoral zone AND great region) must expose the new counts,
    // not just one of them.
    expect(teamCountsMigration.match(/'team3Count', team3_count/g)?.length).toBe(2);
    expect(teamCountsMigration.match(/'team6Count', team6_count/g)?.length).toBe(2);

    expect(admin).toContain('<th>3 人團隊人數</th>');
    expect(admin).toContain('<th>6 人團隊人數</th>');
    expect(admin).toContain("Number(row.team3Count || 0)");
    expect(admin).toContain("Number(row.team6Count || 0)");
    expect(admin).toContain('esc(Number(row.team3Count || 0))');
    expect(admin).toContain('esc(Number(row.team6Count || 0))');
  });

  it("bumps the browser cache keys for the new UI", () => {
    expect(html).toMatch(/index\.css\?v=2026\d{4}_/);
    expect(html).toMatch(/js\/app\.js\?v=2026\d{4}_/);
  });
});
