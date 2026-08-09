import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/0076_leaderboard_ranks_by_true_total_chapters.sql");
const personalRankingMigration = read("supabase/migrations/0050_public_personal_plan_ranking_summary.sql");

// Explicit product decision (user-confirmed): re-reading a full round is real
// effort and must count towards a "total chapters read" ranking. Every
// chapter-count-based leaderboard/ranking must therefore sum reading_logs
// across ALL rounds, never just round = current_round.
const ROUND_FILTER_PATTERN = /round\s*=\s*COALESCE\([\w.]+\.current_round/i;

describe("leaderboards rank by true total chapters read across all rounds", () => {
  it("get_reading_team_leaderboards no longer filters chapters_read by current round", () => {
    const fnStart = migration.indexOf("FUNCTION public.get_reading_team_leaderboards");
    const fnEnd = migration.indexOf("get_reading_team_leaderboards$;", fnStart);
    const body = migration.slice(fnStart, fnEnd);
    expect(body).not.toMatch(ROUND_FILTER_PATTERN);
    expect(body).toContain("COUNT(*)::INTEGER AS chapters_read");
  });

  it("get_reading_team_statistics (admin fallback) no longer filters chapters_read by current round", () => {
    const fnStart = migration.indexOf("FUNCTION public.get_reading_team_statistics");
    const fnEnd = migration.indexOf("reading_team_statistics$;", fnStart);
    const body = migration.slice(fnStart, fnEnd);
    expect(body).not.toMatch(ROUND_FILTER_PATTERN);
    expect(body).toContain("COUNT(*)::INTEGER AS chapters_read");
    // Preserves the role_code() + senior_pastor patch from migrations 0048/0033
    // (a dynamic-patch function — see SKILL.md — so this must be re-asserted
    // explicitly rather than assumed from the original 0033 file text).
    expect(body).toContain("public.role_code(role_id)");
    expect(body).toContain("actor_role NOT IN ('admin', 'senior_pastor')");
  });

  it("get_pastoral_zone_leaderboard no longer filters chapters_read by current round", () => {
    const fnStart = migration.indexOf("FUNCTION public.get_pastoral_zone_leaderboard");
    const fnEnd = migration.indexOf("get_pastoral_zone_leaderboard$;", fnStart);
    const body = migration.slice(fnStart, fnEnd);
    expect(body).not.toMatch(ROUND_FILTER_PATTERN);
    expect(body).toContain("COUNT(*)::INTEGER AS chapters_read");
  });

  it("get_personal_plan_ranking_summary already summed all rounds from the start (regression guard)", () => {
    expect(personalRankingMigration).toContain("COUNT(reading_log.id)::INTEGER AS chapters_read");
    expect(personalRankingMigration).not.toMatch(ROUND_FILTER_PATTERN);
  });
});
