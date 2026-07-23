import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0019_reading_team_registration.sql");
const forwardMigration = read("supabase/migrations/0021_enforce_reading_team_uuid_links.sql");
const dualDivisionMigration = read("supabase/migrations/0022_allow_both_team_divisions.sql");
const peerReminderMigration = read("supabase/migrations/0023_reading_team_peer_reminders.sql");
const rosterStatsMigration = read("supabase/migrations/0024_reading_team_member_roster_stats.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const teamUi = read("js/modules/team-registration.js");
const profile = read("js/modules/profile.js");
const reminderFixture = read("supabase/scripts/seed_reading_team_reminder_test.sql");
const reminderFixtureCleanup = read("supabase/scripts/cleanup_reading_team_reminder_test.sql");
const teamCss = read("css/team-registration.css");
const html = read("index.html");
const teamFixture = read("supabase/scripts/seed_reading_team_test_data.sql");
const teamFixtureCleanup = read("supabase/scripts/cleanup_reading_team_test_data.sql");

describe("reading competition team schema", () => {
  it("keeps 3-person and 6-person teams separate from organisation groups", () => {
    expect(migration).toContain("division IN (3, 6)");
    expect(migration).toContain("UNIQUE (global_plan_id, user_id)"); // upgraded by 0022
    expect(migration).toContain("user_id UUID NOT NULL REFERENCES public.profiles(id)");
    expect(migration).toContain("FOREIGN KEY (team_id, global_plan_id)");
    expect(migration).toContain("REFERENCES public.reading_teams(id, global_plan_id)");
    expect(migration).not.toMatch(/member_name|display_name/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.profiles/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+public\.(small_groups|pastoral_zones)/i);
  });

  it("can safely upgrade a database that already applied earlier team migrations", () => {
    expect(forwardMigration).toContain("IF NOT EXISTS");
    expect(dualDivisionMigration).toContain("ADD COLUMN IF NOT EXISTS division SMALLINT");
    expect(dualDivisionMigration).toContain("UNIQUE (global_plan_id, user_id, division)");
    expect(dualDivisionMigration).toContain("FOREIGN KEY (team_id, global_plan_id, division)");
    expect(dualDivisionMigration).toContain("already_in_plan_division");
  });

  it("provides repeatable UUID-linked test teams that need one final real join", () => {
    expect(teamFixture).toContain("TEST3TEAM");
    expect(teamFixture).toContain("TEST6TEAM");
    expect(teamFixture).toContain("'2 / 3'");
    expect(teamFixture).toContain("'5 / 6'");
    expect(teamFixture).toContain("team.captain_id");
    expect(teamFixture).toContain("團報功能測試計畫");
    expect(teamFixture).toContain("00000000-0000-0000-c026-000000009999");
    expect(teamFixture).toContain("團報測試隊長");
    expect(teamFixture).toContain("is_demo, is_active");
    expect(teamFixture).not.toContain("INSERT INTO auth.users");
    expect(teamFixture).not.toContain("is_demo = FALSE");
    expect(teamFixtureCleanup).toContain("TEST3TEAM");
    expect(teamFixtureCleanup).toContain("TEST6TEAM");
    expect(teamFixtureCleanup).toContain("00000000-0000-0000-c026-000000009999");
    expect(teamFixtureCleanup.indexOf("DELETE FROM public.reading_plans"))
      .toBeLessThan(teamFixtureCleanup.indexOf("DELETE FROM public.global_plans"));
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

  it("returns both of the caller's joined team divisions through the user RPC", () => {
    expect(dualDivisionMigration).toMatch(/get_my_reading_team[\s\S]*own_membership\.user_id = actor_id/);
    expect(dualDivisionMigration).toContain("'teams', team_contexts");
    expect(dualDivisionMigration).toContain("ORDER BY division");
    expect(dualDivisionMigration).not.toContain("get_all_reading_teams");
  });

  it("allows peer reminders only between UUID-linked members of the same team", () => {
    expect(peerReminderMigration).toContain("send_reading_team_reminder");
    expect(peerReminderMigration).toMatch(/JOIN public\.reading_team_members sender[\s\S]*sender\.user_id = actor_id/);
    expect(peerReminderMigration).toMatch(/JOIN public\.reading_team_members recipient[\s\S]*recipient\.user_id = p_recipient_id/);
    expect(peerReminderMigration).toContain("team_reminder_same_team_required");
    expect(peerReminderMigration).toContain("team_reminder_daily_limit");
    expect(peerReminderMigration).toContain("auth.uid() IS NOT NULL");
    expect(peerReminderMigration).not.toMatch(/UPDATE\s+public\.(profiles|small_groups|pastoral_zones)/i);
  });

  it("returns the same roster metrics needed by organisation member status", () => {
    expect(rosterStatsMigration).toContain("'longestStreak'");
    expect(rosterStatsMigration).toContain("'readingLogs'");
    expect(rosterStatsMigration).toContain("ROW_NUMBER() OVER (ORDER BY read_day)");
    expect(rosterStatsMigration).toContain("membership.team_id = selected_team.id");
    expect(rosterStatsMigration).not.toMatch(/ALTER\s+TABLE\s+public\.(profiles|small_groups|pastoral_zones)/i);
  });
});

describe("NLC and browser integration", () => {
  it("allows only the bounded team RPCs and forces the authenticated profile id", () => {
    for (const name of [
      "get_my_reading_team",
      "create_reading_team",
      "join_reading_team_by_code",
      "leave_reading_team",
      "disband_reading_team",
      "send_reading_team_reminder"
    ]) expect(edge).toContain(`"${name}"`);
    expect(edge).toContain("TEAM_RPC_FUNCTIONS.has(functionName)");
    expect(edge).toContain('"get_reading_team_statistics"');
    expect(edge).toContain("p_actor_id: profile.id");

    const readAllowlist = edge.match(/const READ_TABLES = new Set\([\s\S]*?\);/)?.[0] || "";
    expect(readAllowlist).not.toContain("reading_teams");
    expect(readAllowlist).not.toContain("reading_team_members");
  });

  it("delivers team reminders without requiring a table parameter", () => {
    expect(edge).toContain('["save_profile", "rpc", "send_care_reminder"]');
    expect(edge).toContain('const pastoralRoles = ["admin", "great_zone_leader", "zone_leader", "group_leader"]');
    expect(edge).toContain("pastoral_reminder_scope_required");
    expect(edge).toContain("const withinScope = isAdmin(profile)");
    expect(db).toContain("response.status === 403");
    expect(profile).toContain("收到的關心提醒");
    expect(profile).toContain('startsWith("reading-team:")');
    expect(profile).toContain('isTeamReminder ? "隊友"');
    expect(profile).not.toContain("收到牧長同工的關心提醒");
    expect(reminderFixture).toContain("[團隊提醒測試]");
    expect(reminderFixture).toContain("recipient.is_demo = FALSE");
    expect(reminderFixtureCleanup).toContain("[團隊提醒測試]");
  });

  it("keeps personal progress primary and offers optional 3-person or 6-person teams", () => {
    expect(teamUi).toContain("計畫已加入");
    expect(teamUi).toContain("你可以同時參加一支 3 人團隊與一支 6 人團隊");
    expect(teamUi).toContain("章節進度只需勾選一次");
    expect(teamUi).toContain("data-team-skip");
    expect(teamUi).toContain('data-team-division="3"');
    expect(teamUi).toContain('data-team-division="6"');
    expect(teamUi).toContain('data-registration-mode="create"');
    expect(teamUi).toContain('data-registration-mode="join"');
    expect(teamUi).toContain('id="reading-team-code"');
    expect(teamUi).toContain("並產生邀請碼");
    expect(teamUi).toContain("使用邀請碼加入團隊");
    expect(teamUi).toContain("team.inviteCode");
    expect(teamUi).toContain("renderTeamStatGrid");
    expect(teamUi).toContain("renderTeamMemberRoster");
    expect(teamUi).toContain("最高連續");
    expect(teamUi).toContain("累計完成");
    expect(teamUi).toContain("補讀");
    expect(teamUi).toContain("進度狀態");
    expect(teamUi).toContain("data-team-remind-user");
    expect(db).toContain("sendReadingTeamReminder");
    expect(teamUi).toContain("加入後，你可以查看自己的團隊與夥伴進度");
    expect(teamUi).toContain("只有同隊成員可查看");
    expect(teamUi).toContain("其他隊伍的資料不會顯示");
    expect(teamUi).not.toContain("UUID");
    expect(db).toContain("目前找不到你的會員資料");
  });

  it("uses adaptive semantic surfaces in light, dark, and warm themes", () => {
    expect(teamCss).toContain("--reading-team-surface:");
    expect(teamCss).toContain("--reading-team-surface-raised:");
    expect(teamCss).toContain("body.dark-theme .reading-team-overlay");
    expect(teamCss).toContain("body.warm-theme .reading-team-overlay");
    expect(teamCss).toContain(".reading-team-registration-tabs");
    expect(teamCss).toContain("@media (prefers-contrast: more)");
    expect(teamCss).not.toMatch(/var\(--bg-secondary,\s*#2/i);
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

  it("connects joining to My Team and integrates team data into existing group views", () => {
    expect(plan).not.toContain("chooseReadingPlanParticipation(plan)");
    expect(plan).toContain("offerReadingTeamParticipation(joinedPlan)");
    expect(plan).toContain("openReadingTeamDialog(joinedPlan");
    expect(plan.indexOf("await db.joinPresetPlan")).toBeLessThan(plan.indexOf("offerReadingTeamParticipation(joinedPlan)"));
    expect(html).toContain('id="view-reading-team-btn"');
    expect(html).toContain("我的團隊");
    expect(html).not.toContain('id="view-reading-team-stats-btn"');
    expect(html).toContain('id="stats-team-view-select"');
    expect(html).toContain('id="members-team-view-select"');
    expect(plan).toContain("async function prepareReadingTeamSubview");
    expect(plan).toContain('prepareReadingTeamSubview("stats")');
    expect(plan).toContain('prepareReadingTeamSubview("members")');
    expect(plan).toContain('reading-team-');
    expect(plan).toContain('data-reading-team-division');
    expect(plan).toContain('readingTeamDefaultPlan');
    expect(teamUi).toContain("renderMyReadingTeamInline");
    expect(teamUi).toContain("data-team-view-division");
    expect(teamUi).toContain("data-add-other-team");
    expect(teamUi).not.toContain("openReadingTeamAdminStatsDialog");
    expect(teamUi).not.toContain("競賽團隊統計");
    expect(db).toContain("forbidden_rpc");
    expect(db).toContain("already_in_plan_division");
    expect(migration).toMatch(/get_reading_team_statistics[\s\S]*team_statistics_admin_required/);
    expect(db).toContain('_callReadingTeamRpc("get_my_reading_team"');
    expect(db).toContain("return newPlanObj;");
  });

  it("derives team progress from each member's single personal reading log", () => {
    expect(migration).not.toContain("reading_team_logs");
    expect(migration).toMatch(/LEFT JOIN public\.reading_plans plan[\s\S]*plan\.user_id = membership\.user_id/);
    expect(migration).toMatch(/FROM public\.reading_logs log WHERE log\.plan_id = plan\.id/);
    expect(db).toContain('onConflict: "user_id,plan_id,book,chapter,round"');
  });

  it("does not reuse organisation statistics as team registration", () => {
    expect(teamUi).not.toContain("pastoral_zone");
    expect(teamUi).not.toContain("small_group");
    expect(db).toContain("getPlanFilterAliases");
    expect(plan).toContain("canUseAdvancedGroupStats");
  });
});
