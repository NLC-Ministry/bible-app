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

  it("verifies index.html renders the 尚未加入團隊 search box with no joined/all filter tabs", () => {
    // Regression: this section used to show all members with a
    // 全部成員/已組隊成員/未組隊 tab switcher. It was simplified to show only
    // people who haven't joined a team — no tabs needed since there's only
    // one category left to show.
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="admin-team-placements-card-wrap"');
    expect(html).toContain("尚未加入團隊");
    expect(html).toContain('id="admin-team-placement-search"');
    expect(html).not.toContain('data-team-filter="all"');
    expect(html).not.toContain('data-team-filter="joined"');
    expect(html).not.toContain('data-team-filter="unjoined"');
    expect(html).not.toContain("admin-team-placement-tabs");
    expect(html).toContain('id="admin-user-directory-filter-unjoined-team"');
  });

  it("filters the 尚未加入團隊 list to unjoined members and respects the shared org filter", () => {
    const admin = readFileSync("js/modules/admin.js", "utf8");
    expect(admin).not.toContain("adminTeamPlacementFilterTab");
    const listFn = admin.slice(
      admin.indexOf("function renderAdminTeamPlacementList()"),
      admin.indexOf("window.renderAdminUnjoinedPlanMembers")
    );
    expect(listFn).toContain("adminTeamPlacementsData.filter(item => item.isJoined !== true)");
    expect(listFn).toContain("memberMatchesManagementOrgFilter(item)");
    const refreshFn = admin.slice(
      admin.indexOf("async function refreshAdminTeamRegistrationFilters()"),
      admin.indexOf("export async function renderAdminTeamRegistrationStatus")
    );
    expect(refreshFn).toContain("loadActiveAdminPlanSubtab(false)");
    const lazyLoader = admin.slice(
      admin.indexOf("async function loadActiveAdminPlanSubtab(forceRefresh = false)"),
      admin.indexOf("export async function renderAdminPlanManagement()")
    );
    expect(lazyLoader).toContain("activeAdminPlanSubtab === 'teams'");
    expect(lazyLoader).toContain("renderAdminTeamPlacementLookup(state.activePlan, forceRefresh)");
  });

  it("reuses the team placement payload when reopening the same plan and scope", () => {
    const admin = readFileSync("js/modules/admin.js", "utf8");
    const lookupFn = admin.slice(
      admin.indexOf("export async function renderAdminTeamPlacementLookup"),
      admin.indexOf("function renderAdminTeamPlacementList()")
    );
    expect(lookupFn).toContain("adminTeamPlacementsDataKey === dataKey");
    expect(lookupFn).toContain("if (!forceRefresh");
    expect(lookupFn).toContain("adminTeamPlacementsDataKey = dataKey");
  });

  it("verifies db.js provides _getAdminMemberTeamPlacementsFallback for robust fallback data fetching", () => {
    const dbJs = readFileSync("js/db.js", "utf8");
    expect(dbJs).toContain("_getAdminMemberTeamPlacementsFallback(plan, planId)");
    expect(dbJs).toContain('.from("profiles")');
    expect(dbJs).toContain('.from("reading_team_members")');
    expect(dbJs).toContain('.from("reading_teams")');
  });

  it("injects p_actor_id for get_admin_member_team_placements like every other TEAM_RPC_FUNCTIONS entry", () => {
    // Regression: this RPC's SQL signature is
    // get_admin_member_team_placements(p_global_plan_id, p_actor_id DEFAULT
    // NULL), and it calls resolve_reading_team_actor(p_actor_id) exactly
    // like the other TEAM_RPC_FUNCTIONS (migration 0064). nlc-data used to
    // explicitly exclude it from the p_actor_id auto-injection, so
    // p_actor_id stayed NULL, current_profile_id() resolved to NULL under
    // the service-role key, and every call raised "profile_required".
    const indexTs = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
    const start = indexTs.indexOf("const rpcArgs = (functionName === \"publish_global_plan_rules\"");
    const end = indexTs.indexOf(";", start);
    const rpcArgsBlock = indexTs.slice(start, end);
    expect(rpcArgsBlock).not.toContain("get_admin_member_team_placements");
    expect(rpcArgsBlock).toContain("TEAM_RPC_FUNCTIONS.has(functionName)");

    const migration = readFileSync("supabase/migrations/0064_get_admin_member_team_placements.sql", "utf8");
    expect(migration).toContain("p_actor_id UUID DEFAULT NULL");
    expect(migration).toContain("actor_id := public.resolve_reading_team_actor(p_actor_id);");
  });

  it("fixes the membership.id crash and the empty-managed-scope permission leak (migration 0071)", () => {
    // 1. reading_team_members has no `id` column (composite PK team_id +
    //    user_id, migration 0019) — `membership.id IS NOT NULL` failed with
    //    42703. Fixed with membership.user_id, an equivalent
    //    "did the LEFT JOIN match" check on a column that exists.
    // 2. managed_regions/zones/groups are NOT NULL DEFAULT '' (migration
    //    0011), never actually SQL NULL, so plain COALESCE(managed_x, x, '')
    //    never fell back to the personal region/zone/group field. The
    //    resulting empty array then hit this function's own
    //    `CARDINALITY(...) = 0 OR ...` fallback, which treats "no explicit
    //    scope" as "show everyone" — so any leader never explicitly given a
    //    managed_* value saw the whole church here instead of just their
    //    own scope.
    const fixMigration = readFileSync("supabase/migrations/0071_fix_get_admin_member_team_placements.sql", "utf8");
    expect(fixMigration).toContain("'isJoined', (membership.user_id IS NOT NULL),");
    expect(fixMigration).not.toContain("membership.id");
    expect(fixMigration).toContain("COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')");
    expect(fixMigration).toContain("COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')");
    expect(fixMigration).toContain("COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')");
    expect(fixMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) TO authenticated, service_role;");
  });
});
