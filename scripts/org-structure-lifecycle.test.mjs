import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cleanupMigration = readFileSync(
  "supabase/migrations/0032_clear_legacy_org_tables.sql",
  "utf8"
);
const nlcSession = readFileSync("supabase/functions/nlc-session/index.ts", "utf8");
const continuousCleanupMigration = readFileSync(
  "supabase/migrations/0036_prune_orphaned_org_nodes_on_sync.sql",
  "utf8"
);

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

  it("keeps login/session sync available when local org-tree linking fails", () => {
    expect(nlcSession).toContain("async function resolveLocalOrgLinks");
    expect(nlcSession).toContain("org_link_status: orgLinkStatus");
    expect(nlcSession).toContain("org_link_error: orgLinkError");
    expect(nlcSession).toContain('console.warn("Member Hub org-tree link failed');

    const rebuildStart = nlcSession.indexOf("async function resolveLocalOrgLinks");
    const profileUpsert = nlcSession.indexOf('.from("profiles")', rebuildStart);
    const rebuildBlock = nlcSession.slice(rebuildStart, profileUpsert);

    expect(rebuildStart).toBeGreaterThan(-1);
    expect(profileUpsert).toBeGreaterThan(rebuildStart);
    expect(rebuildBlock).not.toContain("throw regionError");
    expect(rebuildBlock).not.toContain("throw zoneError");
    expect(rebuildBlock).not.toContain("throw groupError");
  });
});

describe("continuous organization structure cleanup", () => {
  it("cleans existing orphans once and exposes a service-role-only cleanup function", () => {
    expect(continuousCleanupMigration).toContain("prune_orphaned_church_org_nodes");
    expect(continuousCleanupMigration).toContain("service_role_required");
    expect(continuousCleanupMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.prune_orphaned_church_org_nodes\(INTERVAL\) TO service_role/i
    );
    expect(continuousCleanupMigration).not.toMatch(/\bTRUNCATE\b/i);
    expect(continuousCleanupMigration).not.toMatch(/\bCASCADE\b/i);
  });

  it("uses a grace period and deletes safely from leaves to roots", () => {
    expect(continuousCleanupMigration).toContain("INTERVAL '15 minutes'");
    expect(continuousCleanupMigration).toMatch(/updated_at\s*<\s*NOW\(\)\s*-\s*p_grace_period/i);

    const groupDelete = continuousCleanupMigration.indexOf("DELETE FROM public.small_groups");
    const zoneDelete = continuousCleanupMigration.indexOf("DELETE FROM public.pastoral_zones");
    const regionDelete = continuousCleanupMigration.indexOf("DELETE FROM public.great_regions");
    expect(groupDelete).toBeGreaterThan(-1);
    expect(zoneDelete).toBeGreaterThan(groupDelete);
    expect(regionDelete).toBeGreaterThan(zoneDelete);

    expect(continuousCleanupMigration).toMatch(/profile\.small_group_id\s*=\s*small_group\.id/i);
    expect(continuousCleanupMigration).toMatch(/profile\.pastoral_zone_id\s*=\s*pastoral_zone\.id/i);
    expect(continuousCleanupMigration).toMatch(/small_group\.pastoral_zone_id\s*=\s*pastoral_zone\.id/i);
    expect(continuousCleanupMigration).toMatch(/profile\.great_region_id\s*=\s*great_region\.id/i);
    expect(continuousCleanupMigration).toMatch(/pastoral_zone\.great_region_id\s*=\s*great_region\.id/i);
  });

  it("runs cleanup after profile projection without blocking login on maintenance failure", () => {
    const profileUpsert = nlcSession.indexOf(".upsert(profilePayload");
    const cleanupRpc = nlcSession.indexOf('.rpc("prune_orphaned_church_org_nodes", {})');
    const identityUpsert = nlcSession.indexOf('.from("user_identities")', cleanupRpc);

    expect(profileUpsert).toBeGreaterThan(-1);
    expect(cleanupRpc).toBeGreaterThan(profileUpsert);
    expect(identityUpsert).toBeGreaterThan(cleanupRpc);
    expect(nlcSession).toContain("if (memberContext)");
    expect(nlcSession).toContain('orgCleanupStatus = "failed"');
    expect(nlcSession).toContain("continuing session sync");
    expect(nlcSession).toContain("org_cleanup_status: orgCleanupStatus");
  });
});
