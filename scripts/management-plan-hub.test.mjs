import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const admin = readFileSync("js/modules/admin.js", "utf8");
const utils = readFileSync("js/utils.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
const plan = readFileSync("js/modules/plan.js", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");
const edge = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
const css = readFileSync("index.css", "utf8");

describe("management plan hub", () => {
  it("puts the requested plan management sections in discovery order", () => {
    const planPanel = html.slice(html.indexOf('id="admin-plans-panel"'), html.indexOf('    </main>', html.indexOf('id="admin-plans-panel"')));
    const labels = ["\u8a08\u756b\u7be9\u9078", "\u53c3\u8207\u8005\u7e3d\u89bd", "3 \u4eba\u5718\u968a\u5831\u540d\u72c0\u6cc1", "6 \u4eba\u5718\u968a\u5831\u540d\u72c0\u6cc1", "\u5404\u7a2e\u7d71\u8a08"];
    const positions = labels.map(label => planPanel.indexOf(label));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("gives system administrators permission and plan tabs", () => {
    expect(html).toContain('data-admin-panel="permissions">\u6b0a\u9650\u7ba1\u7406</button>');
    expect(html).toContain('data-admin-panel="plans">\u8a08\u756b\u7ba1\u7406</button>');
    expect(html).toContain('id="admin-users-accordion-root"');
    expect(html).toContain('id="admin-reports-root"');
    expect(admin).toContain("panelName === 'permissions' && isAdmin");
  });

  it("keeps plan management available above the small-group level", () => {
    const adminRoles = admin.match(/const MANAGEMENT_ROLES = \[(.*?)\];/)?.[1] || "";
    const utilsRoles = utils.match(/const managementRoles = \[(.*?)\];/)?.[1] || "";
    const profileRoles = profile.match(/const managementRoles = \[(.*?)\];/)?.[1] || "";
    for (const roles of [adminRoles, utilsRoles, profileRoles]) {
      expect(roles).toContain("admin");
      expect(roles).toContain("great_zone_leader");
      expect(roles).toContain("zone_leader");
      expect(roles).not.toContain("group_leader");
    }
    expect(edge).toContain('return ["admin", "great_zone_leader", "zone_leader"].includes(profile?.role);');
  });

  it("defaults to stage one and lists only current or completed plans with current plans first", () => {
    expect(admin).toContain("getManagementPlanStageNo(plan) === 1");
    expect(admin).toContain("plans.find(plan => plan.managementStatus === 'ongoing') || stageOnePlan || plans[0]");
    expect(admin).toContain("!managementPlanSelectionInitialized");
    expect(admin).toContain("status === 'ongoing' || status === 'completed' || isStageOneBootstrap");
    expect(admin).toContain("const statusPriority = { ongoing: 0, upcoming: 1, completed: 2 }");
    expect(admin).toContain("sourcePlan.planKind === 'church_campaign'");
  });

  it("keeps the plan filter in the document flow", () => {
    const filterRule = css.slice(css.indexOf(".admin-plan-filter-card {"), css.indexOf("}", css.indexOf(".admin-plan-filter-card {")));
    expect(filterRule).not.toContain("position: sticky");
    expect(filterRule).not.toContain("top:");
  });

  it("renders both team divisions and reuses the existing participant and statistics views", () => {
    expect(admin).toContain("renderAdminTeamRegistrationStatus(false, 3, 'admin-team-status-content')");
    expect(admin).toContain("renderAdminTeamRegistrationStatus(false, 6, 'admin-team-status-content-6')");
    expect(admin).toContain("participantSlot.appendChild(memberList)");
    expect(admin).toContain("statisticsSlot.appendChild(statsSection)");
    expect(app).toContain("renderAdminPlanManagement");
  });

  it("applies organization filters to participants, statistics, and complete teams", () => {
    expect(plan).toContain("state.currentUser.managed_regions || state.currentUser.great_region");
    expect(plan).toContain("state.currentUser.managed_zones || state.currentUser.pastoral_zone");
    expect(plan).toContain("state.currentUser.managed_groups || state.currentUser.small_group");
    expect(plan).toContain('return "all_zones"');
    expect(plan).toContain('return "all_groups"');
    expect(plan).toContain("window.refreshAdminTeamRegistrationFilters");
    expect(admin).toContain("teamMatchesManagementOrgFilter");
    expect(admin).toContain("members.some(member =>");
    expect(admin).toContain(".filter(team => teamMatchesManagementOrgFilter(team, activeOrgFilter))");
  });
});
