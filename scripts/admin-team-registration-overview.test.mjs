import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const migration = currentMigrationSql("0044_remove_group_leader_plan_management.sql");
const edge = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
const db = readFileSync("js/db.js", "utf8");
const admin = readFileSync("js/modules/admin.js", "utf8");
const css = readFileSync("index.css", "utf8");
const html = readLegacyIndexHtml();

describe("admin team registration overview", () => {
  it("returns plans, teams, captain pastoral zones, and complete rosters in one RPC", () => {
    expect(migration).toContain("get_reading_team_registration_overview");
    expect(migration).toMatch(/FROM public\.global_plans gp\s+LEFT JOIN scoped_teams st ON st\.global_plan_id = gp\.id/);
    expect(migration).toContain("'captainPastoralZone'");
    expect(migration).toContain("'pastoralZone'");
    expect(migration).toContain("'members'");
    expect(migration).toContain("'plans'");
  });

  it("restricts the overview to plan managers across both auth paths", () => {
    expect(migration).toContain("'great_zone_leader', 'zone_leader'");
    expect(migration).not.toContain("actor_profile.role = 'group_leader'");
    expect(edge).toContain('return ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(getProfileRoleCode(profile));');
    expect(migration).toContain("team_statistics_management_scope_required");
    expect(edge).toContain('PLAN_MANAGEMENT_RPC_FUNCTIONS.has(functionName) && !canManagePlans(profile)');
  });

  it("shows a complete team when any member is inside the manager scope", () => {
    // 範圍篩的是「隊」（任一隊員符合就整隊入選），名單本身（team_details.members）不篩
    expect(migration).toContain("scoped_teams AS (\n    SELECT DISTINCT td.*\n    FROM team_details td\n    JOIN member_details md ON md.team_id = td.team_id");
    const roster = migration.slice(migration.indexOf("team_details AS ("), migration.indexOf("scoped_teams AS ("));
    expect(roster).not.toMatch(/managed_|values_overlap/);
    const visibleScope = migration.slice(migration.indexOf("scoped_teams AS ("), migration.indexOf("plan_aggregates AS ("));
    expect(visibleScope).not.toContain("member_role = 'captain'");
    expect(migration).toContain("actor_profile.managed_regions");
    expect(migration).toContain("actor_profile.managed_zones");
  });

  it("matches each leader's scope against the member field of the same level (#460)", () => {
    const { text } = latestFunctionDefinition("get_reading_team_registration_overview");
    expect(text).toContain("actor_role = 'great_zone_leader' AND public.values_overlap(md.great_region, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''))");
    expect(text).toContain("actor_role = 'zone_leader' AND public.values_overlap(md.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''))");
    expect(text).toContain("actor_role = 'group_leader' AND public.values_overlap(md.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, ''))");
    // 0137 以動態改寫換成述詞；重新定義時要保留，不能退回舊的字面值。
    expect(text).toContain("public.is_campaign_stage_kind(gp.plan_kind)");
    expect(text).not.toContain("gp.plan_kind = 'church_campaign_stage'");
  });

  it("loads the overview directly instead of guessing plan ids in the browser", () => {
    expect(db).toContain('async getReadingTeamRegistrationOverview()');
    expect(db).toContain('_callReadingTeamRpc("get_reading_team_registration_overview", {})');

    const renderStart = admin.indexOf("export async function renderAdminTeamRegistrationStatus");
    const renderEnd = admin.indexOf("export function initAdminTeamRegistration", renderStart);
    const renderSource = admin.slice(renderStart, renderEnd);
    expect(renderSource).toContain("db.getReadingTeamRegistrationOverview()");
    expect(renderSource).not.toContain("for (const plan of state.globalPlans)");
    expect(renderSource).toContain("admin-team-status-retry");
    expect(renderSource).toContain("MANAGEMENT_ROLES.includes(role)");
    expect(renderSource).toContain("cachedTeamsDataKey !== scopeCacheKey");
  });

  it("groups the visible details by plan and team", () => {
    expect(admin).toContain("計畫：${planName}");
    expect(admin).toContain("計畫期間：${planPeriod}");
    expect(admin).toContain("team.captainPastoralZone");
    expect(admin).toContain("隊長所屬牧區");
    expect(admin).toContain("隊名");
    expect(admin).toContain("m.pastoralZone");
    expect(admin).toContain('team.status === "forming"');
  });

  it("removes local user permission management and uses native team disclosure", () => {
    expect(html).not.toContain('id="admin-users-accordion-root"');
    expect(html).toContain('<details class="glass-card admin-team-status-disclosure"');
    expect(html).toContain('<summary id="admin-team-status-toggle"');
    expect(html).toContain('aria-controls="admin-team-status-panel"');
    expect(css).toContain(".admin-team-status-disclosure:not([open])");
    expect(admin).not.toContain("panel.hidden = !willExpand");
  });

  it("keeps the roster header visible and labels the captain only once", () => {
    expect(admin).toContain('class="admin-team-table-scroll"');
    expect(admin).toContain('max-height: min(60vh, 32rem)');
    expect(admin).toContain('<thead style="position: sticky; top: 0; z-index: 2;');
    expect(admin).toContain('>隊長</th>');
    expect(admin).not.toContain('隊員1 (隊長)');
    expect(admin).not.toContain('${escapeHTML(captain.name)}（隊長）');
  });
});
