import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("management plan unjoined members", () => {
  it("places the list immediately below the region and zone selectors", () => {
    const html = read("index.html");
    const filterIndex = html.indexOf('id="admin-management-plan-select"');
    const unjoinedIndex = html.indexOf('id="admin-unjoined-plan-members"');
    const orgFilterIndex = html.indexOf('id="members-admin-group-select"');
    const orgContentIndex = html.indexOf('id="plan-org-stats-content"');

    expect(filterIndex).toBeGreaterThan(-1);
    expect(orgFilterIndex).toBeGreaterThan(-1);
    expect(unjoinedIndex).toBeGreaterThan(orgFilterIndex);
    expect(orgContentIndex).toBeGreaterThan(unjoinedIndex);
    expect(html).toMatch(/index\.css\?v=2026\d{4}_/);
    expect(html).toMatch(/js\/app\.js\?v=2026\d{4}_/);
  });

  it("loads, filters, and reminds unjoined members in the management view", () => {
    const admin = read("js/modules/admin.js");
    const db = read("js/db.js");

    expect(admin).toContain("renderAdminUnjoinedPlanMembers");
    expect(admin).toContain("memberMatchesManagementOrgFilter");
    expect(admin).toContain("db.getUnjoinedPlanMembers(plan)");
    expect(admin).toContain("db.sendPlanJoinInvitation");
    expect(admin).toContain("戳一下");
    expect(db).toContain('"get_unjoined_plan_members"');
    expect(db).toContain('"send_plan_join_invitation"');
    expect(db).toContain("_resolveManagementGlobalPlanId");
    expect(db).toContain("_getUnjoinedPlanMembersFallback");
    expect(admin).toContain("目前篩選範圍內沒有尚未加入所選計畫的人員。");
  });

  it("defaults plan management to whichever plan is currently ongoing", () => {
    // See scripts/admin-ongoing-plan-selection.test.mjs: the stage-one-first
    // default was intentionally replaced with an ongoing-first default.
    const admin = read("js/modules/admin.js");
    expect(admin).toContain("const ongoingPlan = plans.find(plan => plan.managementStatus === 'ongoing')");
    expect(admin).toContain("const defaultPlan = (matchingOption ? plans.find(p => String(p.globalPlanId || p.id || p.presetKey || p.name) === matchingOption.value) : null) || ongoingPlan || plans[0]");
  });

  it("bulk-reminds only visible people who have not been reminded today", () => {
    const html = read("index.html");
    const admin = read("js/modules/admin.js");
    const bulkInvite = read("js/modules/admin-bulk-plan-invite.mjs");
    expect(html).toContain('id="admin-unjoined-plan-invite-all"');
    expect(html).toContain("全部戳一下");
    expect(admin).toContain("wasPlanInviteRemindedToday");
    expect(admin).toContain("eligibleMembers");
    expect(admin).toContain("window.confirm");
    expect(admin).toContain("bulkPlanInviteInProgress");
    expect(admin).toContain("sendBulkPlanInvitations");
    expect(bulkInvite).toContain("result.context?.duplicate");
    expect(bulkInvite).toContain("failedMembers");
  });

  it("enforces manager scope and excludes people who already joined", () => {
    const migration = read("supabase/migrations/0045_plan_join_encouragement.sql");
    const edge = read("supabase/functions/nlc-data/index.ts");

    expect(migration).toContain("actor_profile.role NOT IN ('admin', 'great_zone_leader', 'zone_leader')");
    expect(migration).toContain("AND NOT EXISTS");
    expect(migration).toContain("FROM public.reading_plans");
    expect(migration).toContain("actor_profile.managed_regions");
    expect(migration).toContain("actor_profile.managed_zones");
    expect(migration).toContain("INSERT INTO public.care_reminders");
    expect(migration).toContain("'plan-invite:' || target_plan.id::TEXT");
    expect(migration).not.toContain("actor_profile.role = 'group_leader'");
    expect(edge).toContain("PLAN_MANAGEMENT_RPC_FUNCTIONS.has(functionName) && !canManagePlans(profile)");
  });
});
