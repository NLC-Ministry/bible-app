import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("rename reading team feature", () => {
  it("provides a secure database migration with permission and uniqueness checks", () => {
    const migrationPath = join(root, "supabase", "migrations", "0038_rename_reading_team.sql");
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.rename_reading_team(");
    expect(sql).toContain("p_team_id UUID");
    expect(sql).toContain("p_name TEXT");
    expect(sql).toContain("is_safe_reading_team_name");
    expect(sql).toContain("normalize_reading_team_name");
    expect(sql).toContain("team_captain_required");
    expect(sql).toContain("duplicate_team_name");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.rename_reading_team");
  });

  it("whitelists rename_reading_team in the nlc-data Edge Function", () => {
    const edgeFunction = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
    expect(edgeFunction).toContain('"rename_reading_team"');
  });

  it("exposes db.renameReadingTeam in the frontend database layer", () => {
    const db = readFileSync(join(root, "js", "db.js"), "utf8");
    expect(db).toContain("async renameReadingTeam(teamId, newName)");
    expect(db).toContain('"rename_reading_team"');
    expect(db).toContain("p_team_id: teamId");
    expect(db).toContain("p_name: String(newName || \"\").trim()");
  });

  it("renders a team name edit button for captains and binds prompt dialog in team-registration UI", () => {
    const teamReg = readFileSync(join(root, "js", "modules", "team-registration.js"), "utf8");
    const utils = readFileSync(join(root, "js", "utils.js"), "utf8");

    expect(teamReg).toContain("data-rename-team");
    expect(teamReg).toContain("data-rename-team-inline");
    expect(teamReg).toContain("team.captain_id");
    expect(teamReg).toContain('title="修改團隊名稱"');
    expect(teamReg).toContain("showPromptDialog");
    expect(teamReg).toContain("db.renameReadingTeam(team.id, trimmed)");
    expect(utils).toContain("function showPromptDialog");
    expect(utils).toContain("window.showPromptDialog = showPromptDialog");
  });
});
