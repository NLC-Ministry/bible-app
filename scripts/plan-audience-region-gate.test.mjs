import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentMigrationSql } from "./migration-sql.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = readFileSync(join(root, "js", "db.js"), "utf8");
const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");
const migration = currentMigrationSql("0127_region_cohort_stage_gates.sql");

describe("plan-join error messages (js/db.js)", () => {
  it("still maps the raw server codes assert_campaign_stage_open can raise", () => {
    // The migration this mapping exists for.
    expect(migration).toContain("RAISE EXCEPTION 'plan_audience_restricted'");
    expect(migration).toContain("RAISE EXCEPTION 'campaign_stage_not_open'");
  });

  it("translates plan_audience_restricted into a fill-in-your-region sentence", () => {
    const fn = db.slice(db.indexOf("_planJoinErrorMessage(error)"), db.indexOf("async joinPresetPlan("));
    expect(fn).toContain("plan_audience_restricted:");
    expect(fn).toContain("會員中心");
    expect(fn).toContain("campaign_stage_not_open:");
    expect(fn).toContain("profile_required:");
    // unknown codes keep the old visible behaviour
    expect(fn).toContain('"加入讀經計畫失敗："');
  });

  it("routes both plan-insert failure paths through the mapper, not a raw concat", () => {
    const joinFn = db.slice(db.indexOf("async joinPresetPlan("), db.indexOf("async joinPlan("));
    expect(joinFn).toContain("showToast(this._planJoinErrorMessage(error))");
    expect(joinFn).toContain("showToast(this._planJoinErrorMessage(e))");
    expect(joinFn).not.toContain('showToast("加入讀經計畫失敗：" + (error.message');
    expect(joinFn).not.toContain('showToast("加入讀經計畫失敗：" + (e.message');
  });
});

describe("explore list: region-cohort plans and a member with no region (js/modules/plan.js)", () => {
  const presetList = plan.slice(
    plan.indexOf("function renderPresetPlansList"),
    plan.indexOf("function isChapterReadForRound")
  );

  it("filters an audience-restricted plan out when the viewer has a (non-matching) region", () => {
    expect(presetList).toContain("plan.audienceRegions || plan.audience_regions");
    expect(presetList).toContain("window.isPlanAudienceMatch(plan)");
    // has a region but not in the list → hidden
    expect(presetList).toMatch(/if \(hasAudience && !window\.isPlanAudienceMatch\(plan\)\) \{[\s\S]*?return false;/);
  });

  it("keeps the card but disables joining when the viewer has NOT set a region yet", () => {
    expect(presetList).toContain("viewerRegionMissing");
    expect(presetList).toContain("great_region");
    expect(presetList).toContain("markRegionSetup(plan)");
    expect(presetList).toContain("const needsRegionSetup");
    expect(presetList).toContain("const isJoinBlocked = isLockedStage || needsRegionSetup");
  });

  it("a region-setup card shows a hint status row and no join buttons", () => {
    // The status row (Chinese may be stored \u-escaped in this file).
    expect(presetList).toMatch(/needsRegionSetup && \{\s*\n\s*icon: "personBox",/);
    // A missing-pastoral-zone card is the one exception: it gets an actual
    // CTA button (no dialog/full-screen takeover — see showPastoralZoneCta),
    // so the ternary now branches on that before falling back to the plain
    // isJoinBlocked -> "" behaviour region-setup/locked cards still use.
    expect(presetList).toMatch(/actions: showPastoralZoneCta\s*\n\s*\? renderPlanCardActions/);
    expect(presetList).toMatch(/:\s*isJoinBlocked\s*\n\s*\? ""/);
    expect(presetList).toMatch(/if \(showPastoralZoneCta\) \{\s*\n\s*goSetPastoralZone\(\);/);
    expect(presetList).toMatch(/if \(isJoinBlocked\) \{\s*\n\s*openPlanDetailsDialog\(plan\);/);
    // no join action listener wiring beyond what an empty actions string yields
    expect(presetList).toContain('data-plan-card-action="solo-join"'); // still present for non-blocked cards
  });

  it("a missing-pastoral-zone card gets an actionable CTA to Member Hub, not a dialog", () => {
    expect(presetList).toContain("PASTORAL_ZONE_REQUIRED_FROM");
    expect(presetList).toContain("viewerPastoralZoneMissing");
    expect(presetList).toContain("markPastoralZoneSetup(plan)");
    expect(presetList).toContain("const needsPastoralZoneSetup");
    expect(presetList).toContain('data-plan-card-action="member-hub-pastoral-zone"');
    expect(presetList).toContain('auth.openMemberHub("onboarding")');
  });
});
