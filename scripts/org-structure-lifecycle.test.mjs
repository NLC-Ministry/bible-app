import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cleanupMigration = readFileSync(
  "supabase/migrations/0032_clear_legacy_org_tables.sql",
  "utf8"
);
const nlcSession = readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

describe("organization structure cleanup", () => {
  it("never cascades a truncate into user data", () => {
    expect(cleanupMigration).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(cleanupMigration).not.toMatch(/^\s*TRUNCATE[^;]*\bCASCADE\b/im);
  });

  it("deletes only nodes without profile or descendant references", () => {
    expect(cleanupMigration).toMatch(/profile\.small_group_id\s*=\s*small_group\.id/i);
    expect(cleanupMigration).toMatch(/profile\.pastoral_zone_id\s*=\s*pastoral_zone\.id/i);
    expect(cleanupMigration).toMatch(/small_group\.pastoral_zone_id\s*=\s*pastoral_zone\.id/i);
    expect(cleanupMigration).toMatch(/profile\.great_region_id\s*=\s*great_region\.id/i);
    expect(cleanupMigration).toMatch(/pastoral_zone\.great_region_id\s*=\s*great_region\.id/i);
  });
});

describe("Member Hub organization structure rebuild", () => {
  it("recreates the hierarchy only after an authoritative context sync", () => {
    expect(nlcSession).toContain("if (memberContext && profilePayload.great_region)");
    expect(nlcSession).toContain("if (memberContext && profilePayload.pastoral_zone && great_region_id)");
    expect(nlcSession).toContain("if (memberContext && profilePayload.small_group && pastoral_zone_id)");
  });

  it("upserts each level before linking it to the profile", () => {
    const region = nlcSession.indexOf('.from("great_regions")');
    const zone = nlcSession.indexOf('.from("pastoral_zones")', region);
    const group = nlcSession.indexOf('.from("small_groups")', zone);
    const profile = nlcSession.indexOf('.from("profiles")', group);

    expect(region).toBeGreaterThan(-1);
    expect(zone).toBeGreaterThan(region);
    expect(group).toBeGreaterThan(zone);
    expect(profile).toBeGreaterThan(group);
    expect(nlcSession.slice(region, profile)).toContain(".upsert(");
    expect(nlcSession).toContain('onConflict: "name,great_region_id"');
    expect(nlcSession).toContain('onConflict: "name,pastoral_zone_id"');
  });
});
