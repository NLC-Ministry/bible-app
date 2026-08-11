import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0083_transfer_reading_team_captain.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const teamRegistration = read("js/modules/team-registration.js");

describe("reading team captain transfer", () => {
  it("allows only the current captain to transfer to an existing teammate", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.transfer_reading_team_captain(");
    expect(migration).toContain("selected_team.captain_id <> actor_id");
    expect(migration).toContain("RAISE EXCEPTION 'team_captain_transfer_required'");
    expect(migration).not.toMatch(/actor_role\s*=\s*'admin'/);
    expect(migration).toContain("user_id = p_new_captain_id");
    expect(migration).toContain("global_plan_id = selected_team.global_plan_id");
    expect(migration).toContain("member_role = 'member'");
  });

  it("updates both membership roles and the team's captain id in one RPC", () => {
    expect(migration).toContain("SET member_role = 'member'");
    expect(migration).toContain("SET member_role = 'captain'");
    expect(migration).toContain("SET captain_id = p_new_captain_id");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.transfer_reading_team_captain");
  });

  it("exposes the RPC through nlc-data and db.js", () => {
    expect(edge).toContain('"transfer_reading_team_captain"');
    expect(db).toContain("async transferReadingTeamCaptain(teamId, newCaptainId)");
    expect(db).toContain('this._callReadingTeamRpc("transfer_reading_team_captain"');
    expect(db).toContain("p_new_captain_id: newCaptainId");
  });

  it("shows and binds the transfer action only from captain-scoped render options", () => {
    expect(teamRegistration).toContain("canTransferCaptain: isCaptain");
    expect(teamRegistration).toContain("canTransferCaptain: isCurrentUserCaptain");
    expect(teamRegistration).toContain("data-team-transfer-captain-user");
    expect(teamRegistration).toContain("bindTeamCaptainTransferButtons");
    expect(teamRegistration).toContain("db.transferReadingTeamCaptain(team.id, member.userId)");
    expect(teamRegistration).toContain("轉移後你會成為一般隊員");
  });
});
