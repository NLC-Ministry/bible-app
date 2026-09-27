import { describe, expect, it } from "vitest";
import {
  churchStagePresetKeyToPlanId,
  formatProfilePlanTeams,
  getProfilePlanStatus,
  matchesAdminUserDirectoryPlanFilters,
  resolveEnrollmentPlanId
} from "../js/modules/admin-user-directory-filter.mjs";

const PLAN_A = "00000000-0000-0000-c026-000000000001";
const PLAN_B = "11111111-2222-3333-4444-555555555555";

const profiles = {
  // 加入 A 計畫且在 A 組隊（3 人組隊長 + 6 人組隊員）
  teamed: {
    id: "u1", is_active: true, joined_plan_ids: [PLAN_A],
    teams_by_plan: { [PLAN_A]: [{ name: "光照", role: "captain" }, { name: "恩典", role: "member" }] }
  },
  // 加入 A 但沒組隊；在 B 有組隊
  soloInA: {
    id: "u2", is_active: true, joined_plan_ids: [PLAN_A, PLAN_B],
    teams_by_plan: { [PLAN_B]: [{ name: "喜樂", role: "member" }] }
  },
  // 沒加入 A
  notJoined: { id: "u3", is_active: true, joined_plan_ids: [PLAN_B], teams_by_plan: {} },
  inactive: { id: "u4", is_active: false, joined_plan_ids: [], teams_by_plan: {} },
  self: { id: "admin", is_active: true, joined_plan_ids: [], teams_by_plan: {} }
};

const pick = filters => Object.entries(profiles)
  .filter(([, profile]) => matchesAdminUserDirectoryPlanFilters(profile, { planId: PLAN_A, currentProfileId: "admin", ...filters }))
  .map(([key]) => key);

describe("admin user directory plan filters", () => {
  it("keeps everyone when both plan conditions are 全部", () => {
    expect(pick({})).toEqual(Object.keys(profiles));
  });

  it("filters by participation in the selected plan, not a hard-coded stage", () => {
    expect(pick({ participation: "joined" })).toEqual(["teamed", "soloInA"]);
    // 未加入：沿用邀請名單規則，排除停用帳號與管理員本人
    expect(pick({ participation: "not_joined" })).toEqual(["notJoined"]);
    expect(matchesAdminUserDirectoryPlanFilters(profiles.notJoined, { planId: PLAN_B, participation: "joined" })).toBe(true);
  });

  it("judges team status per plan — a team in another plan does not count", () => {
    expect(pick({ team: "joined" })).toEqual(["teamed"]);
    expect(pick({ team: "not_joined" })).toEqual(["soloInA", "notJoined", "inactive", "self"]);
    expect(pick({ participation: "joined", team: "not_joined" })).toEqual(["soloInA"]);
  });

  it("formats every team in the plan and marks captains", () => {
    expect(formatProfilePlanTeams(getProfilePlanStatus(profiles.teamed, PLAN_A).teams)).toBe("[隊長] 光照、恩典");
    expect(formatProfilePlanTeams(getProfilePlanStatus(profiles.teamed, PLAN_B).teams)).toBe("");
    expect(getProfilePlanStatus(profiles.teamed, "").joined).toBe(false);
  });

  it("resolves enrollments that only carry a church stage preset key", () => {
    expect(churchStagePresetKeyToPlanId("church_stage_01")).toBe(PLAN_A);
    expect(churchStagePresetKeyToPlanId("church_stage_12")).toBe("00000000-0000-0000-c026-000000000012");
    expect(churchStagePresetKeyToPlanId("custom")).toBe("");
    expect(resolveEnrollmentPlanId({ global_plan_id: PLAN_B, preset_key: "church_stage_01" })).toBe(PLAN_B);
    expect(resolveEnrollmentPlanId({ global_plan_id: null, preset_key: "church_stage_01" })).toBe(PLAN_A);
    expect(resolveEnrollmentPlanId({ preset_key: "stage_x" }, new Map([["stage_x", PLAN_B]]))).toBe(PLAN_B);
    expect(resolveEnrollmentPlanId({ preset_key: "unknown" })).toBe("");
  });
});
