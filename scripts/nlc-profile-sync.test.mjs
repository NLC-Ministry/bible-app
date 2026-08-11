import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  orgFromCareChain,
  orgFromHomePath,
  orgFromMemberContext,
  mergeOrgSources,
  resolveSyncedRoleId,
  buildLockedFields,
  projectOrgFieldsFromHub,
  buildOrgProjectionAudit
} from "./lib/nlc-profile-sync.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");

describe("orgFromCareChain", () => {
  it("maps levelDepth 0/1/2 to great_region, pastoral_zone, small_group", () => {
    const careChain = [
      { nodeId: "1", name: "北大區", levelDepth: 0, levelName: "大區" },
      { nodeId: "2", name: "青年牧區", levelDepth: 1, levelName: "牧區" },
      { nodeId: "3", name: "大安小組", levelDepth: 2, levelName: "小組" },
      { nodeId: "4", name: "恩典小家", levelDepth: 3, levelName: "小家" }
    ];
    expect(orgFromCareChain(careChain)).toEqual({
      great_region: "北大區",
      pastoral_zone: "青年牧區",
      small_group: "大安小組"
    });
  });

  it("returns nulls for empty chain", () => {
    expect(orgFromCareChain([])).toEqual({
      great_region: null,
      pastoral_zone: null,
      small_group: null
    });
  });
});

describe("orgFromHomePath", () => {
  it("maps path segments by levelName", () => {
    const path = [
      { id: "1", name: "花蓮", levelName: "大區" },
      { id: "2", name: "資訊事工", levelName: "牧區" },
      { id: "3", name: "大安小組", levelName: "小組" },
      { id: "4", name: "恩典小家", levelName: "小家" }
    ];
    expect(orgFromHomePath(path)).toEqual({
      great_region: "花蓮",
      pastoral_zone: "資訊事工",
      small_group: "大安小組"
    });
  });
});

describe("mergeOrgSources", () => {
  it("projects canonical Member Hub placement into the matching local org field", () => {
    const platform = { great_region: "A", pastoral_zone: "B", small_group: "C" };
    const placement = { great_region: null, pastoral_zone: null, small_group: null };
    const context = { placementNodeName: "L3", placementLevelName: "小組" };
    expect(mergeOrgSources(platform, placement, context)).toEqual({
      great_region: "A",
      pastoral_zone: "B",
      small_group: "L3"
    });
  });

  it("prefers org-placement when it is available over other org sources", () => {
    const platform = { great_region: "舊大區", pastoral_zone: "舊牧區", small_group: "舊小組" };
    const placement = { great_region: "新大區", pastoral_zone: "新牧區", small_group: "新小組" };
    const context = { placementNodeName: "背景小組", placementLevelName: "小組" };

    expect(mergeOrgSources(platform, placement, context)).toEqual(placement);
  });

  it("projects canonical placement levels independently", () => {
    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { placementNodeName: "目前牧區", placementLevelName: "牧區" }
    )).toEqual({
      great_region: null,
      pastoral_zone: "目前牧區",
      small_group: null
    });

    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { placementNodeName: "北區", placementLevelName: "大區" }
    )).toEqual({
      great_region: "北區",
      pastoral_zone: null,
      small_group: null
    });
  });

  it("ignores unsupported canonical placement levels instead of guessing", () => {
    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { placementNodeName: "恩典小家", placementLevelName: "小家" }
    )).toEqual({
      great_region: null,
      pastoral_zone: null,
      small_group: null
    });
  });
});

describe("orgFromMemberContext", () => {
  it("reads canonical Member Hub placement fields", () => {
    expect(orgFromMemberContext({
      placementNodeName: "馬鈴薯",
      placementLevelName: "小組"
    })).toEqual({
      great_region: null,
      pastoral_zone: null,
      small_group: "馬鈴薯"
    });
  });

  it("returns empty local projection when canonical placement is incomplete", () => {
    expect(orgFromMemberContext({
      placementNodeName: "馬鈴薯"
    })).toEqual({
      great_region: null,
      pastoral_zone: null,
      small_group: null
    });
  });
});

describe("resolveSyncedRoleId", () => {
  const definitions = [
    { id: "admin-id", code: "admin", label: "系統管理員", hub_permission_keys: ["system_admin"], hub_permission_labels: ["管理員"] },
    { id: "pastor-id", code: "pastor", label: "牧者", hub_permission_keys: ["church_pastor"], hub_permission_labels: ["主任牧師"] }
  ];

  it("maps Hub keys and labels to immutable UUIDs", () => {
    expect(resolveSyncedRoleId({ leadershipIdentity: { assignments: [{ identityKey: "church_pastor" }] } }, definitions, null, "identity")).toBe("pastor-id");
    expect(resolveSyncedRoleId({ primaryRole: "管理員" }, definitions, null, "member_id")).toBe("admin-id");
  });

  it("preserves the current UUID only during a degraded context sync", () => {
    expect(resolveSyncedRoleId(null, definitions, "pastor-id", "identity")).toBe("pastor-id");
  });
});
describe("buildLockedFields", () => {
  it("includes only non-empty source values", () => {
    expect(buildLockedFields({
      name: "王小明",
      email: null,
      great_region: "東區",
      pastoral_zone: "",
      small_group: "馬鈴"
    })).toEqual(["name", "great_region", "small_group"]);
  });

  it("always locks org fields for Member Hub-linked users", () => {
    expect(buildLockedFields({
      name: "王小明",
      email: "a@b.c",
      great_region: null,
      pastoral_zone: null,
      small_group: null
    }, { hubLinked: true })).toEqual([
      "name",
      "email",
      "great_region",
      "pastoral_zone",
      "small_group"
    ]);
  });
});

describe("projectOrgFieldsFromHub", () => {
  it("uses Member Hub values directly when hub-linked, clearing stale local org fields", () => {
    expect(projectOrgFieldsFromHub(
      { great_region: "北區", pastoral_zone: null, small_group: null },
      { great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴" },
      true
    )).toEqual({
      great_region: "北區",
      pastoral_zone: "",
      small_group: ""
    });
  });

  it("falls back to existing profile org fields when not hub-linked", () => {
    expect(projectOrgFieldsFromHub(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴" },
      false
    )).toEqual({
      great_region: "東區",
      pastoral_zone: "大安1",
      small_group: "馬鈴"
    });
  });
});

describe("buildOrgProjectionAudit", () => {
  it("captures canonical placement, every org source, and the final profile projection", () => {
    const audit = buildOrgProjectionAudit({
      memberContext: { hasRequiredPlacement: true },
      organization: {
        placementNodeId: "node-1",
        placementNodeName: "馬鈴薯",
        placementLevelName: "小組"
      },
      platformOrgFields: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: null },
      placementOrgFields: { great_region: null, pastoral_zone: null, small_group: null },
      contextOrgFields: { great_region: null, pastoral_zone: null, small_group: "馬鈴薯" },
      mergedOrg: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: "馬鈴薯" },
      projectedOrg: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: "馬鈴薯" },
      existingProfile: { great_region: "", pastoral_zone: "", small_group: "" },
      orgResolutionSource: "member_hub_context",
      memberContextError: null
    });

    expect(audit).toMatchObject({
      source: "member_hub_context",
      status: "projected",
      member_context_available: true,
      canonical_placement: {
        placementNodeId: "node-1",
        placementNodeName: "馬鈴薯",
        placementLevelName: "小組",
        hasRequiredPlacement: true
      },
      inputs: {
        platform: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: null },
        context: { great_region: null, pastoral_zone: null, small_group: "馬鈴薯" },
        merged: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: "馬鈴薯" }
      },
      projected_profile: { great_region: "北大區", pastoral_zone: "青年牧區", small_group: "馬鈴薯" }
    });
  });

  it("marks an available Member Hub context as empty when no source projected org labels", () => {
    const audit = buildOrgProjectionAudit({
      memberContext: { hasRequiredPlacement: true },
      organization: {
        placementNodeId: "home-1",
        placementNodeName: "恩典小家",
        placementLevelName: "小家"
      },
      platformOrgFields: { great_region: null, pastoral_zone: null, small_group: null },
      placementOrgFields: { great_region: null, pastoral_zone: null, small_group: null },
      contextOrgFields: { great_region: null, pastoral_zone: null, small_group: null },
      mergedOrg: { great_region: null, pastoral_zone: null, small_group: null },
      projectedOrg: { great_region: "", pastoral_zone: "", small_group: "" },
      existingProfile: { great_region: "舊大區", pastoral_zone: "舊牧區", small_group: "舊小組" },
      orgResolutionSource: "none",
      memberContextError: null
    });

    expect(audit.status).toBe("empty");
    expect(audit.member_context_available).toBe(true);
    expect(audit.canonical_placement).toEqual({
      placementNodeId: "home-1",
      placementNodeName: "恩典小家",
      placementLevelName: "小家",
      hasRequiredPlacement: true
    });
    expect(audit.projected_profile).toEqual({
      great_region: null,
      pastoral_zone: null,
      small_group: null
    });
  });
});

it("stores Member Hub leadership identity projection and resolves the role UUID", () => {
  const source = fs.readFileSync(
    path.join(rootDir, "supabase/functions/nlc-session/index.ts"),
    "utf8"
  );

  expect(source).toContain("member_context_leadership_display_label");
  expect(source).toContain("member_context_leadership_primary_assignment_id");
  expect(source).toContain("member_context_leadership_assignments");
  expect(source).toContain("memberContext?.leadershipIdentity");
  expect(source).toContain('role_id: syncedRoleId');
});

describe("nlc-session leadership identity sync", () => {
  it("preserves the existing projection when Member Hub context is degraded", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "supabase/functions/nlc-session/index.ts"),
      "utf8"
    );

    expect(source).toContain("...(memberContext ? {");
    expect(source).toContain("member_context_leadership_display_label: leadershipIdentity.displayLabel");
    expect(source).toContain("member_context_leadership_primary_assignment_id: leadershipIdentity.primaryAssignmentId");
    expect(source).toContain("member_context_leadership_assignments: leadershipIdentity.assignments");
  });

  it("filters malformed leadership assignments before reading assignment fields", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "supabase/functions/nlc-session/index.ts"),
      "utf8"
    );

    expect(source).toContain(".filter((assignment: any) => assignment && typeof assignment === \"object\")");
    expect(source.indexOf(".filter((assignment: any) => assignment && typeof assignment === \"object\")"))
      .toBeLessThan(source.indexOf(".map((assignment: any) => ({"));
  });

  it("preserves null leadership levelDepth instead of coercing it to root depth", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "supabase/functions/nlc-session/index.ts"),
      "utf8"
    );

    expect(source).toContain("levelDepth: assignment.levelDepth === null || assignment.levelDepth === undefined");
    expect(source.indexOf("assignment.levelDepth === null || assignment.levelDepth === undefined"))
      .toBeLessThan(source.indexOf("Number.isFinite(Number(assignment.levelDepth))"));
  });

  it("protects Hub-owned leadership projection columns from member profile writes", () => {
    const migration = fs.readFileSync(
      path.join(rootDir, "supabase/migrations/0041_protect_member_context_leadership_identity.sql"),
      "utf8"
    );

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.protect_profile_member_context_leadership_fields");
    expect(migration).toContain("member_context_leadership_display_label");
    expect(migration).toContain("member_context_leadership_primary_assignment_id");
    expect(migration).toContain("member_context_leadership_assignments");
    expect(migration).toContain("RAISE EXCEPTION 'member context leadership fields are managed by Member Hub'");
    expect(migration).toContain("CREATE TRIGGER trg_profiles_protect_member_context_leadership");
    expect(migration).not.toContain("actor_role");
    expect(migration).not.toContain("senior_pastor");
  });
});

describe("nlc-session member context sync timestamp", () => {
  it("sets member_context_synced_at from the successful session sync timestamp", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("member_context_synced_at");
    expect(source).toMatch(/member_context_synced_at:\s*memberContext\s*\?\s*nowIso/);
    expect(source.indexOf("const nowIso = new Date().toISOString()"))
      .toBeLessThan(source.indexOf("member_context_synced_at: memberContext ? nowIso"));
  });

  it("projects org placement from Member Hub for every Logto session", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("projectOrgFieldsFromHub(mergedOrg, existingProfile, hubLinked)");
    expect(source).toContain("const hubLinked = !!memberContext");
    expect(source).toContain("placementLevelName");
    expect(source).toContain("placementNodeName");
    expect(source).toContain("member_hub_context_failed");
    expect(source).not.toMatch(/fetchJsonOptional\(`\$\{memberHubUrl\}\/api\/me\/context`/);
  });

  it("does not depend on the cookie-only org-placement endpoint for delegated Edge sync", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).not.toContain("const placementResponse = await fetchJsonOptional(`${memberHubUrl}/api/me/org-placement`");
    expect(source).not.toContain("const needsPlacementFallback = !platformOrgFields.great_region");
  });

  it("records which upstream source supplied the projected organization fields", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("const contextOrgFields = orgFromMemberContext(organization)");
    expect(source).toContain("const orgResolutionSource = hasAnyOrgField(placementOrgFields)");
    expect(source).toContain("member_hub_org_placement");
    expect(source).toContain("member_hub_context");
    expect(source).toContain("platform_organization");
    expect(source).toContain("identityMetadata.org_resolution_source = orgResolutionSource");
  });

  it("does not reject the whole login when Member Hub context is temporarily unavailable", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).not.toMatch(/return\s+jsonResponse\(\{\s*error:\s*"member_hub_context_failed"/);
    expect(source).not.toMatch(/return\s+jsonResponse\(\{\s*error:\s*"member_hub_context_missing"/);
    expect(source).toContain("member_context_error");
  });

  it("persists sync attempt status and clears previous errors after successful context sync", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("const memberContextSyncStatus = memberContext ? \"success\" : \"degraded\"");
    expect(source).toContain("member_context_sync_attempted_at: nowIso");
    expect(source).toContain("member_context_sync_status: memberContextSyncStatus");
    expect(source).toContain("member_context_sync_error: memberContextError");
    expect(source).toContain("member_context_sync_status: memberContextSyncStatus");
  });

  it("persists and logs org projection diagnostics for production troubleshooting", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("const orgProjectionAudit = buildOrgProjectionAudit");
    expect(source).toContain("identityMetadata.org_projection_audit = orgProjectionAudit");
    expect(source).toContain('console.info("nlc-session org projection"');
    expect(source).toContain("org_projection_debug: orgProjectionAudit");
  });
});
