import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  orgFromCareChain,
  orgFromHomePath,
  orgFromLegacyOrganization,
  orgFromMemberContext,
  mergeOrgSources,
  resolveSyncedRole,
  buildLockedFields,
  projectOrgFieldsFromHub
} from "./lib/nlc-profile-sync.mjs";

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
  it("prefers Platform org over placement and Member Hub context", () => {
    const platform = { great_region: "A", pastoral_zone: "B", small_group: "C" };
    const placement = { great_region: "X", pastoral_zone: "Y", small_group: "Z" };
    const context = { greatRegion: "L1", pastoralZone: "L2", smallGroup: "L3" };
    expect(mergeOrgSources(platform, placement, context)).toEqual(platform);
  });

  it("reads canonical Member Hub context fields before legacy names", () => {
    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { greatRegion: "北區", pastoralZone: "青年牧區", smallGroup: "馬鈴薯" }
    )).toEqual({
      great_region: "北區",
      pastoral_zone: "青年牧區",
      small_group: "馬鈴薯"
    });
  });

  it("falls back to legacy fields then homeNodeName", () => {
    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { homeRegionName: "東區", homeZoneName: "大安1", homeGroupName: "馬鈴" }
    )).toEqual({
      great_region: "東區",
      pastoral_zone: "大安1",
      small_group: "馬鈴"
    });

    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: null, pastoral_zone: null, small_group: null },
      { homeNodeName: "恩典小家" }
    )).toEqual({
      great_region: null,
      pastoral_zone: "恩典小家",
      small_group: null
    });
  });
});

describe("orgFromMemberContext", () => {
  it("reads canonical greatRegion / pastoralZone / smallGroup fields", () => {
    expect(orgFromMemberContext({
      greatRegion: "北區",
      pastoralZone: "青年牧區",
      smallGroup: "馬鈴薯"
    })).toEqual({
      great_region: "北區",
      pastoral_zone: "青年牧區",
      small_group: "馬鈴薯"
    });
  });
});

describe("orgFromLegacyOrganization", () => {
  it("reads deprecated homeRegionName fields", () => {
    expect(orgFromLegacyOrganization({
      homeRegionName: "東區",
      homeZoneName: "大安1",
      homeGroupName: "馬鈴"
    })).toEqual({
      great_region: "東區",
      pastoral_zone: "大安1",
      small_group: "馬鈴"
    });
  });
});

describe("resolveSyncedRole", () => {
  it("maps Hub primaryRole admin to app admin", () => {
    expect(resolveSyncedRole("admin", "member")).toBe("admin");
  });

  it("preserves SQL-promoted admin when Hub primaryRole is member", () => {
    expect(resolveSyncedRole("member", "admin")).toBe("admin");
  });

  it("normalizes the retired senior-pastor role to admin", () => {
    expect(resolveSyncedRole("member", "senior_pastor")).toBe("admin");
  });

  it("defaults to member when no existing role", () => {
    expect(resolveSyncedRole("member", null)).toBe("member");
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

describe("nlc-session member context sync timestamp", () => {
  it("sets member_context_synced_at from the successful session sync timestamp", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("member_context_synced_at");
    expect(source).toMatch(/member_context_synced_at:\s*nowIso/);
    expect(source.indexOf("const nowIso = new Date().toISOString()"))
      .toBeLessThan(source.indexOf("member_context_synced_at: nowIso"));
  });

  it("projects org placement from Member Hub for every Logto session", () => {
    const source = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

    expect(source).toContain("projectOrgFieldsFromHub(mergedOrg, existingProfile, hubLinked)");
    expect(source).toContain("const hubLinked = true");
    expect(source).toContain("orgFromMemberContext");
    expect(source).toContain("member_hub_context_failed");
    expect(source).not.toMatch(/fetchJsonOptional\(`\$\{memberHubUrl\}\/api\/me\/context`/);
  });
});
