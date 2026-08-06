import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("admin member team placement lookup tests", () => {
  it("verifies migration 0064 creates get_admin_member_team_placements stored procedure", () => {
    const migration = readFileSync("supabase/migrations/0064_get_admin_member_team_placements.sql", "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_admin_member_team_placements(");
    expect(migration).toContain("RETURNS JSONB");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements");
  });

  it("verifies nlc-data edge function exposes get_admin_member_team_placements in RPC sets", () => {
    const indexTs = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
    expect(indexTs).toContain('"get_admin_member_team_placements"');
  });

  it("verifies db.js provides getAdminMemberTeamPlacements method", () => {
    const dbJs = readFileSync("js/db.js", "utf8");
    expect(dbJs).toContain("getAdminMemberTeamPlacements(plan)");
    expect(dbJs).toContain('"get_admin_member_team_placements"');
  });

  it("verifies index.html renders team placement search & filter tabs", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="admin-team-placements-card-wrap"');
    expect(html).toContain('id="admin-team-placement-search"');
    expect(html).toContain('data-team-filter="joined"');
    expect(html).toContain('data-team-filter="unjoined"');
    expect(html).toContain('id="admin-user-directory-filter-unjoined-team"');
  });

  it("verifies db.js provides _getAdminMemberTeamPlacementsFallback for robust fallback data fetching", () => {
    const dbJs = readFileSync("js/db.js", "utf8");
    expect(dbJs).toContain("_getAdminMemberTeamPlacementsFallback(plan, planId)");
    expect(dbJs).toContain('.from("profiles")');
    expect(dbJs).toContain('.from("reading_team_members")');
    expect(dbJs).toContain('.from("reading_teams")');
  });
});
