import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0034_admin_team_registration_overview.sql", "utf8");
const edge = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
const db = readFileSync("js/db.js", "utf8");
const admin = readFileSync("js/modules/admin.js", "utf8");
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
    expect(html).toContain("js/app.js?v=20260729_team_registration_overview");
  });
});
