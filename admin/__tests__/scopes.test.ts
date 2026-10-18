// 帳號與權限（#550 第二組）的純規則：管理範圍、名單篩選。和 App、admin-api 比對結果一致。
import { describe, it, expect } from "vitest";
import { buildManagedScopeChoices } from "../../js/modules/admin-managed-scope-options.mjs";
import { ADMIN_ORG_UNASSIGNED } from "../../js/modules/admin-user-directory-filter.mjs";
import { ORG_UNASSIGNED as SERVER_UNASSIGNED, PLAN_FILTERS, directoryFilters } from "../../supabase/functions/admin-api/accounts.ts";
import { formatTeams } from "../../supabase/functions/admin-api/exports.ts";
import {
  assignLeaders,
  effectiveScopes,
  orgNames,
  scopeChoices,
  scopeText,
  unassignedCount,
  usesPlacementFallback,
  type ScopePerson
} from "../src/scopes.ts";
import {
  EMPTY_FILTERS,
  ORG_UNASSIGNED,
  PARTICIPATION_FILTERS,
  activeFilterCount,
  directoryParams,
  orgFilterOptions,
  orgPickerSummary,
  pruneOrgFilter,
  syncLabel,
  teamsText
} from "../src/directory.ts";
import type { OrgTreeNode } from "../src/types.ts";

const ORG: OrgTreeNode[] = [
  { id: "r1", name: "北區", zones: [
    { id: "z1", name: "一牧區", groups: [{ id: "g1", name: "喜樂小組" }, { id: "g2", name: "平安小組" }] },
    { id: "z2", name: "二牧區", groups: [{ id: "g3", name: "恩典小組" }] }
  ] },
  { id: "r2", name: "南區", zones: [{ id: "z3", name: "三牧區", groups: [{ id: "g4", name: "信心小組" }] }] },
  { id: "r3", name: "東區", zones: [] }
];

function person(role: string, extra: Partial<ScopePerson> = {}): ScopePerson {
  return {
    role_code: role, great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組",
    managed_regions: [], managed_zones: [], managed_groups: [], ...extra
  };
}

describe("管理範圍規則（同 App 管理分頁）", () => {
  it("uses the role's own field, else the person's placement", () => {
    expect(effectiveScopes(person("great_zone_leader"))).toEqual(["北區"]);
    expect(effectiveScopes(person("zone_leader"))).toEqual(["一牧區"]);
    expect(effectiveScopes(person("group_leader"))).toEqual(["喜樂小組"]);
    expect(effectiveScopes(person("zone_leader", { managed_zones: " 二牧區, 三牧區 ,", managed_regions: "南區" }))).toEqual(["二牧區", "三牧區"]);
    expect(effectiveScopes(person("zone_leader", { pastoral_zone: null }))).toEqual([]);
    expect(usesPlacementFallback(person("zone_leader"))).toBe(true);
    expect(usesPlacementFallback(person("zone_leader", { managed_zones: ["二牧區"] }))).toBe(false);
  });

  it("whole church for admin and pastor, self only for the rest", () => {
    expect(scopeText(person("admin"))).toBe("全教會");
    expect(scopeText(person("pastor", { managed_regions: ["北區"] }))).toBe("全教會");
    expect(scopeText(person("member"))).toBe("僅本人");
    expect(scopeText(person("zone_leader", { pastoral_zone: null }))).toBe("僅本人");
    expect(scopeText(person("group_leader", { managed_groups: ["喜樂小組", "平安小組"] }))).toBe("喜樂小組、平安小組");
  });

  it("pre-checks and drops the same names as App's buildManagedScopeChoices", () => {
    const cases: [ "region" | "zone" | "group", string[]][] = [
      ["region", ["北區", "舊大區", " 南區 "]],
      ["zone", ["一牧區", "不存在"]],
      ["group", ["信心小組", "", "喜樂小組"]],
      ["group", []]
    ];
    for (const [level, current] of cases) {
      const ours = scopeChoices(ORG, level, current);
      const app = buildManagedScopeChoices(orgNames(ORG, level).map((name) => ({ id: name, name })), current);
      expect(ours.selected, level).toEqual(app.selected);
      expect(ours.dropped, level).toEqual(app.dropped);
      expect([...new Set(ours.sections.flatMap((s) => s.names))].sort((a, b) => a.localeCompare(b, "zh-Hant"))).toEqual(app.optionNames);
    }
  });

  it("groups choices under their parent unit, in org order", () => {
    expect(scopeChoices(ORG, "zone", []).sections.map((s) => [s.title, s.names])).toEqual([["北區", ["一牧區", "二牧區"]], ["南區", ["三牧區"]]]);
    expect(scopeChoices(ORG, "group", []).sections.map((s) => s.title)).toEqual(["北區・一牧區", "北區・二牧區", "南區・三牧區"]);
  });

  it("assigns leaders to units by their effective scope and counts the rest", () => {
    const leaders = [
      { ...person("zone_leader"), id: "a" },
      { ...person("great_zone_leader", { managed_regions: ["北區", "舊大區"] }), id: "b" },
      { ...person("pastor"), id: "c" },
      { ...person("group_leader", { managed_groups: ["喜樂小組", "平安小組"] }), id: "d" },
      { ...person("member"), id: "e" }
    ];
    const assignment = assignLeaders(leaders);
    expect(assignment.wholeChurch.pastor.map((p) => p.id)).toEqual(["c"]);
    expect(assignment.byLevel.zone.get("一牧區")?.map((p) => p.id)).toEqual(["a"]);
    expect(assignment.byLevel.region.get("舊大區")?.map((p) => p.id)).toEqual(["b"]);
    // 大區：南區、東區；牧區：二、三；小組：恩典、信心
    expect(unassignedCount(ORG, assignment)).toBe(6);
  });
});

describe("使用者名單篩選", () => {
  it("shares the unassigned value and plan filters with App and admin-api", () => {
    expect(ORG_UNASSIGNED).toBe(ADMIN_ORG_UNASSIGNED);
    expect(ORG_UNASSIGNED).toBe(SERVER_UNASSIGNED);
    expect([...PARTICIPATION_FILTERS]).toEqual([...PLAN_FILTERS]);
  });

  it("sends params admin-api accepts", () => {
    const filters = { ...EMPTY_FILTERS, q: "  王 ", regions: ["北區", ORG_UNASSIGNED], planId: "00000000-0000-0000-c026-000000000004", team: "joined" as const };
    expect(directoryParams(filters)).toEqual({
      q: "王", regions: ["北區", ORG_UNASSIGNED], zones: [], groups: [],
      plan_id: "00000000-0000-0000-c026-000000000004", participation: "all", team: "joined", incomplete: false
    });
    const server = directoryFilters(directoryParams(filters));
    expect(server.ok && server.filters).toMatchObject({ p_q: "王", p_regions: ["北區", ORG_UNASSIGNED], p_team: "joined" });
    expect(directoryParams(EMPTY_FILTERS)).not.toHaveProperty("plan_id");
    expect(directoryFilters(directoryParams(EMPTY_FILTERS)).ok).toBe(true);
    expect(activeFilterCount(filters)).toBe(2);
  });

  it("narrows zone and group options to the chosen parents, always offering 未設定", () => {
    const all = orgFilterOptions(ORG, { regions: [], zones: [], groups: [] });
    expect(all.regions.flatMap((s) => s.values)).toEqual(["北區", "南區", "東區", ORG_UNASSIGNED]);
    const south = orgFilterOptions(ORG, { regions: ["南區"], zones: [], groups: [] });
    expect(south.zones.flatMap((s) => s.values)).toEqual(["三牧區", ORG_UNASSIGNED]);
    expect(south.groups.flatMap((s) => s.values)).toEqual(["信心小組", ORG_UNASSIGNED]);
    const zone = orgFilterOptions(ORG, { regions: [], zones: ["一牧區"], groups: [] });
    expect(zone.groups.map((s) => s.title)).toEqual(["北區・一牧區", null]);
  });

  it("drops child choices the new parents no longer offer", () => {
    expect(pruneOrgFilter(ORG, { regions: ["南區"], zones: ["一牧區", ORG_UNASSIGNED], groups: ["喜樂小組", "信心小組"] }))
      .toEqual({ regions: ["南區"], zones: [ORG_UNASSIGNED], groups: [] });
    expect(pruneOrgFilter(ORG, { regions: [], zones: ["一牧區"], groups: ["喜樂小組", "恩典小組"] }))
      .toEqual({ regions: [], zones: ["一牧區"], groups: ["喜樂小組"] });
  });

  it("formats labels like App and the export", () => {
    expect(orgPickerSummary([], "大區")).toBe("全部大區");
    expect(orgPickerSummary([ORG_UNASSIGNED], "大區")).toBe("未設定");
    expect(orgPickerSummary(["北區", "南區"], "大區")).toBe("2 個大區");
    const teams = [{ name: "晨光隊", role: "captain" }, { name: null, role: "member" }, { name: "六人組", role: "leader" }];
    expect(teamsText(teams)).toBe("[隊長] 晨光隊、未命名隊伍、[隊長] 六人組");
    expect(teamsText(teams)).toBe(formatTeams(teams));
    expect(syncLabel("success")).toBe("已同步");
    expect(syncLabel("failed")).toBe("同步異常");
    expect(syncLabel(null)).toBe("尚未同步");
  });
});
