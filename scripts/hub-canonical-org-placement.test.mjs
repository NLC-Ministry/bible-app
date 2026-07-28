import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = readFileSync(join(root, "supabase", "migrations", "0028_protect_hub_owned_org_placement.sql"), "utf8");
const db = readFileSync(join(root, "js", "db.js"), "utf8");

describe("hub-owned org placement migration", () => {
  it("blocks authenticated members from writing org placement columns", () => {
    expect(migration).toContain("protect_profile_org_placement_fields");
    expect(migration).toContain("trg_profiles_protect_org_placement");
    expect(migration).toContain("great_region IS DISTINCT FROM OLD.great_region");
    expect(migration).toContain("org placement fields are managed by Member Hub");
  });
});

describe("syncProfileStatsToSupabase org placement contract", () => {
  const start = db.indexOf("async syncProfileStatsToSupabase");
  const end = db.indexOf("calculateStreak()", start);
  const source = db.slice(start, end);

  it("does not write org placement fields", () => {
    expect(source).not.toContain("great_region");
    expect(source).not.toContain("pastoral_zone");
    expect(source).not.toContain("small_group");
    expect(source).not.toContain("great_region_id");
  });

  it("merges only the display name into the cached nlc profile", () => {
    expect(source).toContain('const merged = { ...JSON.parse(cachedProfile), name: verifiedProfile.name }');
  });
});

describe("Google auth profile bootstrap", () => {
  it("creates first-time profiles without default org placement", () => {
    expect(db).toContain("// First-time login: create profile without local org placement (Hub-owned).");
    expect(db).toContain('great_region: ""');
    expect(db).not.toMatch(/First-time login:[\s\S]*great_region: "東區"/);
  });
});
