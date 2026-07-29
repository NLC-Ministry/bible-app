import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0038_reading_team_leaderboards.sql");
const focusMigration = read("supabase/migrations/0039_focus_reading_team_leaderboards_on_my_team.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const html = read("index.html");
const css = read("index.css");

describe("reading team leaderboards", () => {
  it("ranks 3-person and 6-person teams independently by current-round chapters", () => {
    expect(migration).toContain("get_reading_team_leaderboards");
    expect(migration).toMatch(/FILTER \([\s\S]*reading_log\.round = COALESCE\(plan\.current_round, 1\)/);
    expect(migration).toMatch(/RANK\(\)[\s\S]*PARTITION BY division[\s\S]*ORDER BY chapters_read DESC, last_read_at ASC NULLS LAST/);
    expect(migration).toContain("'division3'");
    expect(migration).toContain("'division6'");
  });

  it("marks the caller's teams and includes their captain pastoral zones", () => {
    expect(focusMigration).toContain("actor_id := public.resolve_reading_team_actor");
    expect(focusMigration).toContain("BOOL_OR(member.user_id = actor_id)");
    expect(focusMigration.match(/'isMine'/g)?.length).toBe(2);
    expect(focusMigration.match(/'captainPastoralZone'/g)?.length).toBe(2);
    expect(focusMigration).not.toContain("profile.name");
    expect(db).toContain("ownTeamIds.has(String(team.id))");
  });

  it("centers the caller's team with nearby ranks and supports collapsing each division", () => {
    expect(html).toContain('data-team-ranking-toggle="3"');
    expect(html).toContain('data-team-ranking-toggle="6"');
    expect(html).toContain('data-team-ranking-summary="3"');
    expect(html).toContain('data-team-ranking-summary="6"');
    expect(plan).toContain("function updateReadingTeamRankingSummary");
    expect(plan).toContain("function focusReadingTeamRanking");
    expect(plan).toContain("teamCountLabel = `共 ${teams.length} 隊`");
    expect(plan).toContain('updateReadingTeamRankingSummary(section.division, "共 0 隊")');
    expect(plan).toContain('updateReadingTeamRankingSummary(section.division, "讀取失敗・請重新載入")');
    expect(plan).toContain('state.currentUser.role === "admin"');
    expect(plan).toMatch(/getReadingTeamLeaderboards\(state\.activePlan\),\s+8000/);
    expect(html.match(/團隊排行榜載入中…/g)?.length).toBe(2);
    expect(plan).toContain("myTeamRow.getBoundingClientRect()");
    expect(plan).toContain('bar-race-row--mine');
    expect(html).toContain('<details class="glass-card reading-team-ranking-card" data-team-ranking-details="3" open>');
    expect(html).toContain('<details class="glass-card reading-team-ranking-card" data-team-ranking-details="6" open>');
    expect(plan).toContain('details.addEventListener("toggle"');
    expect(css).toContain(".reading-team-ranking-card:not([open])");
    expect(css).toContain(".reading-team-ranking-list[hidden]");
    expect(css).toContain(".reading-team-ranking-list .bar-race-row--mine");
    expect(css).toContain("background: color-mix(in srgb, var(--color-achievement) 18%, var(--bg-card))");
    expect(css).toContain(".bar-race-row--mine .bar-race-bar");
    expect(css).toContain("border-left-width: 5px");
    expect(css).toContain("max-height: 456px");
  });

  it("requires an authenticated profile without exposing member identities", () => {
    expect(migration).toContain("resolve_reading_team_actor");
    expect(migration).toContain("TO authenticated, service_role");
    expect(migration).not.toContain("profile.name");
    expect(migration).not.toContain("'members'");
    expect(edge).toContain('"get_reading_team_leaderboards"');
    expect(edge).toContain("TEAM_RPC_FUNCTIONS.has(functionName)");
  });

  it("renders separate responsive leaderboard sections and escapes team names", () => {
    expect(html).toContain('id="reading-team-ranking-3"');
    expect(html).toContain('id="reading-team-ranking-6"');
    expect(html).toContain("3 人團隊排行榜");
    expect(html).toContain("6 人團隊排行榜");
    expect(db).toContain('_callReadingTeamRpc("get_reading_team_leaderboards"');
    expect(plan).toContain("async function renderReadingTeamLeaderboards");
    expect(plan).toContain('escapeHTML(team.name || "未命名隊伍")');
    expect(plan).toContain("memberCount}/${section.division}");
    expect(plan).toContain("chaptersRead} 章");
    expect(plan).toContain("const progressPercent = Math.min(100");
    expect(plan).toContain('class="bar-race-percent">${progressPercent}%');
    expect(plan).toContain('role="progressbar"');
    expect(plan).toContain('aria-valuenow="${progressPercent}"');
    expect(css).toContain(".reading-team-ranking-list .bar-race-bar-shell");
    expect(css).toContain("height: 10px");
    expect(css).toContain("background: color-mix(in srgb, var(--text-primary) 14%, var(--bg-card))");
    expect(css).toContain("body.dark-theme .reading-team-ranking-list .bar-race-bar-shell");
    expect(plan).toContain("settleRequest");
    expect(plan).toContain("團隊排行榜載入逾時");
    expect(plan).toContain("data-team-ranking-retry");
    expect(plan).toContain("db.getReadingTeamStatistics(state.activePlan)");
    expect(plan).toContain("completedAt(team)");
    expect(plan).toContain("Promise.allSettled");
    expect(plan).toContain("Promise.resolve().then(() => renderReadingTeamLeaderboards())");
  });
});
