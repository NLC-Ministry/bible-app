import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0019_reading_team_registration.sql");
const forwardMigration = read("supabase/migrations/0021_enforce_reading_team_uuid_links.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const teamUi = read("js/modules/team-registration.js");
const teamCss = read("css/team-registration.css");
const html = read("index.html");

describe("reading competition team schema", () => {
  it("keeps 3-person and 6-person teams separate from organisation groups", () => {
    expect(migration).toContain("division IN (3, 6)");
    expect(migration).toContain("UNIQUE (global_plan_id, user_id)");
    expect(migration).toContain("user_id UUID NOT NULL REFERENCES public.profiles(id)");
    expect(migration).toContain("FOREIGN KEY (team_id, global_plan_id)");
    expect(migration).toContain("REFERENCES public.reading_teams(id, global_plan_id)");
    expect(migration).not.toMatch(/member_name|display_name/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.profiles/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+public\.(small_groups|pastoral_zones)/i);
  });

  it("can safely upgrade a database that already applied an earlier team migration", () => {
    expect(forwardMigration).toContain("IF NOT EXISTS");
    expect(forwardMigration).toContain("reading_team_members_team_plan_fk");
    expect(forwardMigration).toContain("FOREIGN KEY (team_id, global_plan_id)");
  });

  it("locks concurrent joins and freezes a completed roster", () => {
    expect(migration).toMatch(/join_reading_team_by_code[\s\S]*FOR UPDATE/);
    expect(migration).toContain("current_count >= selected_team.division");
    expect(migration).toContain("status = 'ready'");
    expect(migration).toContain("ready_team_roster_locked");
  });

  it("uses a non-recursive membership helper for row-level visibility", () => {
    expect(migration).toContain("FUNCTION public.is_reading_team_member");
    expect(migration).toContain("public.is_reading_team_member(reading_teams.id");
    expect(migration).toContain("public.is_reading_team_member(reading_team_members.team_id");
    const memberPolicy = migration.match(/CREATE POLICY reading_team_members_own_team_read[\s\S]*?\);/)?.[0] || "";
    expect(memberPolicy).not.toContain("FROM public.reading_team_members");
  });

  it("returns only the caller's joined team through the user RPC", () => {
    expect(migration).toMatch(/get_my_reading_team[\s\S]*membership\.user_id = actor_id/);
    expect(migration).toMatch(/WHERE membership\.team_id = selected_team\.id/);
    expect(migration).not.toContain("get_all_reading_teams");
    expect(migration).toContain("membership.user_id = actor_id");
  });
});

describe("NLC and browser integration", () => {
  it("allows only the bounded team RPCs and forces the authenticated profile id", () => {
    for (const name of [
      "get_my_reading_team",
      "create_reading_team",
      "join_reading_team_by_code",
      "leave_reading_team",
      "disband_reading_team"
    ]) expect(edge).toContain(`"${name}"`);
    expect(edge).toContain("TEAM_RPC_FUNCTIONS.has(functionName)");
    expect(edge).toContain('"get_reading_team_statistics"');
    expect(edge).toContain("p_actor_id: profile.id");

    const readAllowlist = edge.match(/const READ_TABLES = new Set\([\s\S]*?\);/)?.[0] || "";
    expect(readAllowlist).not.toContain("reading_teams");
    expect(readAllowlist).not.toContain("reading_team_members");
  });

  it("offers personal, 3-person, and 6-person registration", () => {
    expect(teamUi).toContain('data-team-mode="personal"');
    expect(teamUi).toContain('data-division="3"');
    expect(teamUi).toContain('data-division="6"');
    expect(teamUi).toContain("一般會員只能查看自己加入的隊伍");
    expect(teamUi).toContain("只有同隊成員可查看");
    expect(teamUi).toContain("系統不會只用姓名建立成員");
    expect(db).toContain("尚未找到你的會員資料");
  });

  it("renders the participation chooser above fixed app navigation", () => {
    expect(teamCss).toMatch(/\.reading-team-overlay[\s\S]*position: fixed/);
    expect(teamCss).toContain("inset: 0");
    expect(teamCss).toContain("z-index: var(--z-modal, 700)");
    expect(teamCss).toMatch(/@media \(max-width: 640px\)[\s\S]*align-items: flex-end/);
    expect(teamUi).toContain("reading-team-modal-open");
    expect(teamUi).toContain("reading-team-dialog--choice");
    expect(teamUi).toContain('data-icon="chevronRight"');
  });

  it("connects joining and the plan options menu to My Team", () => {
    expect(plan).toContain("chooseReadingPlanParticipation(plan)");
    expect(plan).toContain("openReadingTeamDialog(joinedPlan");
    expect(html).toContain('id="view-reading-team-btn"');
    expect(html).toContain("我的團隊");
    expect(html).toContain("競賽團隊統計");
    expect(plan).toContain('readingTeamStatsButton.hidden = !isTeamPlan || role !== "admin"');
    expect(migration).toMatch(/get_reading_team_statistics[\s\S]*team_statistics_admin_required/);
    expect(db).toContain('_callReadingTeamRpc("get_my_reading_team"');
    expect(db).toContain("return newPlanObj;");
  });

  it("does not reuse organisation statistics as team registration", () => {
    expect(teamUi).not.toContain("pastoral_zone");
    expect(teamUi).not.toContain("small_group");
    expect(db).toContain("getPlanFilterAliases");
    expect(plan).toContain("canUseAdvancedGroupStats");
  });
});
