import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  orgFromProjectedOrganization,
  mergeOrgSources,
  resolveRequiredPlacement,
  resolveSyncedRole,
  buildLockedFields
} from "./lib/nlc-profile-sync.mjs";

describe("mergeOrgSources", () => {
  it("uses Member Hub projected organization fields before any fallback", () => {
    const projected = orgFromProjectedOrganization({
      greatRegion: "北一大區",
      pastoralZone: "士林牧區",
      smallGroup: "士林小組",
      homeRegionName: "Legacy Region",
      homeZoneName: "Legacy Zone",
      homeGroupName: "Legacy Group"
    });

    expect(projected).toEqual({
      great_region: "北一大區",
      pastoral_zone: "士林牧區",
      small_group: "士林小組"
    });
  });

  it("prefers projected org over existing profile fallback", () => {
    const projected = { great_region: "A", pastoral_zone: "B", small_group: "C" };
    const existing = { great_region: "X", pastoral_zone: "Y", small_group: "Z" };
    expect(mergeOrgSources(projected, existing)).toEqual(projected);
  });

  it("falls back to existing profile fields only when projected org is absent", () => {
    expect(mergeOrgSources(
      { great_region: null, pastoral_zone: null, small_group: null },
      { great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴" }
    )).toEqual({
      great_region: "東區",
      pastoral_zone: "大安1",
      small_group: "馬鈴"
    });
  });
});

describe("resolveRequiredPlacement", () => {
  it("uses hasRequiredPlacement and does not derive readiness from hasHome", () => {
    expect(resolveRequiredPlacement(
      { hasRequiredPlacement: true, hasHome: false },
      false
    )).toBe(true);
    expect(resolveRequiredPlacement(
      { hasRequiredPlacement: false, hasHome: true },
      true
    )).toBe(false);
  });

  it("preserves the previous value when Hub omits hasRequiredPlacement", () => {
    expect(resolveRequiredPlacement({ hasHome: false }, true)).toBe(true);
  });
});

describe("profile readiness source", () => {
  it("checks hasRequiredPlacement instead of hasHome for Member Hub org setup readiness", () => {
    const profileSource = readFileSync(join(process.cwd(), "js/modules/profile.js"), "utf8");
    const match = profileSource.match(/function userNeedsOrgSetup\(\) \{[\s\S]*?\n\}/);
    expect(match && match[0]).toContain("hasRequiredPlacement");
    expect(match && match[0]).not.toContain("hasHome");
  });

  it("does not call legacy org derivation helpers from the Edge Function", () => {
    const edgeSource = readFileSync(join(process.cwd(), "supabase/functions/nlc-session/index.ts"), "utf8");
    expect(edgeSource).toContain("orgFromProjectedOrganization(organization)");
    expect(edgeSource).not.toContain("/api/me/org-placement");
    expect(edgeSource).not.toContain("/members/${encodeURIComponent(memberId)}/organization");
    expect(edgeSource).not.toContain("orgFromCareChain");
    expect(edgeSource).not.toContain("orgFromHomePath");
    expect(edgeSource).not.toContain("orgFromLegacyOrganization");
  });

  it("persists hasRequiredPlacement into the profiles row for degraded future syncs", () => {
    const edgeSource = readFileSync(join(process.cwd(), "supabase/functions/nlc-session/index.ts"), "utf8");
    expect(edgeSource).toContain("profilePayload.has_required_placement = hasRequiredPlacement");
    expect(edgeSource).toContain("profile.hasRequiredPlacement = hasRequiredPlacement");
  });

  it("maps snake-case persisted required placement back into the browser profile state", () => {
    const dbSource = readFileSync(join(process.cwd(), "js/db.js"), "utf8");
    expect(dbSource).toContain("profile.hasRequiredPlacement === true || profile.has_required_placement === true");
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
});
