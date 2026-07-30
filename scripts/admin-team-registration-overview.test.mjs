import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0034_admin_team_registration_overview.sql", "utf8");
const edge = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
const db = readFileSync("js/db.js", "utf8");
const admin = readFileSync("js/modules/admin.js", "utf8");
const css = readFileSync("index.css", "utf8");
const html = readFileSync("index.html", "utf8");

describe("admin team registration overview", () => {
  it("returns plans, teams, captain pastoral zones, and complete rosters in one RPC", () => {
    expect(migration).toContain("get_reading_team_registration_overview");
    expect(migration).toMatch(/JOIN public\.global_plans AS plan ON plan\.id = team\.global_plan_id/);
    expect(migration).toContain("'captainPastoralZone'");
    expect(migration).toContain("'pastoralZone'");
    expect(migration).toContain("'members'");
    expect(migration).toContain("'plans'");
  });

  it("restricts the overview to administrators across both auth paths", () => {
    expect(migration).toMatch(/actor_role <> 'admin'/);
    expect(migration).toContain("team_statistics_admin_required");
    expect(edge).toContain('"get_reading_team_registration_overview"');
    expect(edge).toMatch(/get_reading_team_registration_overview"\]\.includes\(functionName\)[\s\S]*?!isAdmin\(profile\)/);
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

  it("bumps the app cache key", () => {
    expect(html).toContain("js/app.js?v=20260730_team_size_modal_chooser");
    expect(html).toContain("index.css?v=20260730_team_card_action_captain_member");
    expect(html).toContain("css/team-registration.css?v=20260730_team_size_modal_chooser");
  });

  it("restores user permission management and uses native team disclosure", () => {
    expect(html).toContain('id="admin-users-accordion-root"');
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
