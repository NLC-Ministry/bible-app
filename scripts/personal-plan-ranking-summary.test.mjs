import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0050_public_personal_plan_ranking_summary.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");

describe("public personal plan ranking summary", () => {
  it("ranks each authenticated caller against every active participant in the selected plan", () => {
    expect(migration).toContain("get_personal_plan_ranking_summary");
    expect(migration).toContain("actor_id := public.resolve_reading_team_actor(p_actor_id)");
    expect(migration).toContain("reading_plan.global_plan_id = p_global_plan_id");
    expect(migration).toContain("COALESCE(profile.is_active, TRUE) = TRUE");
    expect(migration).toContain("WHERE id = actor_id");
    expect(migration).toContain("'churchRank'");
    expect(migration).toContain("'churchTotal'");
    expect(migration).toContain("'zoneRank'");
    expect(migration).toContain("'zoneTotal'");
  });

  it("is available to every authenticated user without exposing another member identity", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("TO authenticated, service_role");
    expect(migration).not.toContain("profile.name");
    expect(edge).toContain('"get_personal_plan_ranking_summary"');
    expect(db).toContain('_callReadingTeamRpc("get_personal_plan_ranking_summary"');
  });

  it("uses the server summary instead of the permission-scoped profile list", () => {
    const rankingFunction = plan.match(/async function renderMyPersonalRankings\(\)[\s\S]*?\n}\n\nfunction updateReadingTeamRankingSummary/)?.[0] || "";
    expect(rankingFunction).toContain("db.getPersonalPlanRankingSummary(state.activePlan)");
    expect(rankingFunction).not.toContain("db.fetchMergedUsersList");
    expect(rankingFunction).toContain("churchRank > 0");
    expect(rankingFunction).toContain("zoneRank > 0");
  });
});
