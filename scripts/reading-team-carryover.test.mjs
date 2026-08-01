import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const migration = read("supabase/migrations/0058_carry_reading_team_to_next_stage.sql");
const plan = read("js/modules/plan.js");
const db = read("js/db.js");
const edge = read("supabase/functions/nlc-data/index.ts");
const teamUi = read("js/modules/team-registration.js");

describe("reading team stage carryover", () => {
  it("offers carryover only to captains of the immediately previous stage", () => {
    expect(migration).toContain("source_stage_no := target_stage_no - 1");
    expect(migration).toContain("source_team.captain_id = actor_id");
    expect(migration).toContain("own_membership.member_role = 'captain'");
    expect(migration).toContain("target_stage_not_open");
    expect(migration).toContain("is_hidden = FALSE");
  });

  it("copies the complete roster and plan enrollment in one idempotent operation", () => {
    expect(migration).toContain("carried_from_team_id");
    expect(migration).toContain("idx_reading_teams_one_carryover_per_stage");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toMatch(/INSERT INTO public\.reading_team_members[\s\S]*FROM public\.reading_team_members source_member/);
    expect(migration).toMatch(/INSERT INTO public\.reading_plans[\s\S]*ON CONFLICT \(user_id, global_plan_id\)/);
    expect(migration).toContain("team_carryover_member_conflict");
  });

  it("exposes the offer and confirmation RPCs through both data paths", () => {
    for (const name of [
      "get_reading_team_carryover_offer",
      "carry_reading_teams_to_stage"
    ]) {
      expect(edge).toContain('"' + name + '"');
      expect(migration).toContain("FUNCTION public." + name);
    }
    expect(db).toContain("getReadingTeamCarryoverOffer(plan)");
    expect(db).toContain("carryReadingTeamsToStage(plan)");
  });

  it("asks once per session and refreshes every member plan after captain confirmation", () => {
    expect(plan).toContain("maybeOfferNextStageTeamCarryover");
    expect(plan).toContain("reading_team_carryover_deferred_");
    expect(plan).toContain("getReadingTeamCarryoverOffer(plan)");
    expect(plan).toContain("carryReadingTeamsToStage(plan)");
    expect(plan).toContain("await db.loadUserData(true)");
    expect(plan).toContain("if (carryoverLoaderVisible) loader.hide()");
    expect(plan).toContain("保留原團隊");
  });

  it("uses the account logout icon for captain member removal controls", () => {
    const removeButtons = [...teamUi.matchAll(/<button[^>]+data-team-remove-user[\s\S]*?<\/button>/g)]
      .map(match => match[0]);
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach(button => {
      expect(button).toContain('data-icon="logout"');
      expect(button).not.toContain('data-icon="trash"');
    });
  });
});