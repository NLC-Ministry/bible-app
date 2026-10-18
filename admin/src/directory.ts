// 使用者名單的篩選規則（#550）。純函式，測試直接測。
//
// 篩選在伺服器做（admin_api_directory_list），這裡只管：送什麼參數、組織篩選的選項怎麼串連、
// 畫面上的文字。規則和 App 管理分頁的使用者名單相同（js/modules/admin-user-directory-filter.mjs）：
// · 大區／牧區／小組可複選，「未設定」＝那一欄空白；
// · 選了大區，牧區只列那些大區底下的；選了牧區（或大區），小組只列底下的；上一層改了，下一層選不到的自動拿掉；
// · 計畫參與、組隊狀態跟著選的計畫；沒有計畫可選時這兩個條件停用。
// 和 App 不同：組織選項來自組織名單（bootstrap），不是從名單裡的人收集——歸屬寫錯字的人用搜尋框找。
import type { DirectoryTeam, OrgTreeNode } from "./types.ts";

export const ORG_UNASSIGNED = "__unassigned__";
export const ORG_UNASSIGNED_LABEL = "未設定";
export const DIRECTORY_PAGE_SIZE = 50;

export const PARTICIPATION_FILTERS = ["all", "joined", "not_joined"] as const;
export type PlanFilter = typeof PARTICIPATION_FILTERS[number];

export const PARTICIPATION_LABEL: Record<PlanFilter, string> = { all: "全部", joined: "已加入此計畫", not_joined: "未加入此計畫" };
export const TEAM_LABEL: Record<PlanFilter, string> = { all: "全部", joined: "已組隊", not_joined: "未組隊（個人速讀中）" };

export type OrgFilter = { regions: string[]; zones: string[]; groups: string[] };

export type DirectoryFilters = OrgFilter & {
  q: string;
  /** null＝讓伺服器挑預設計畫（第一頁回來後填入） */
  planId: string | null;
  participation: PlanFilter;
  team: PlanFilter;
  incomplete: boolean;
};

export const EMPTY_FILTERS: DirectoryFilters = {
  q: "",
  regions: [],
  zones: [],
  groups: [],
  planId: null,
  participation: "all",
  team: "all",
  incomplete: false
};

/** admin-api 參數（名單與匯出共用）。 */
export function directoryParams(filters: DirectoryFilters): Record<string, unknown> {
  const params: Record<string, unknown> = {
    regions: filters.regions,
    zones: filters.zones,
    groups: filters.groups,
    participation: filters.participation,
    team: filters.team,
    incomplete: filters.incomplete
  };
  const q = filters.q.trim();
  if (q) params.q = q.slice(0, 100);
  if (filters.planId) params.plan_id = filters.planId;
  return params;
}

/** 套用了幾項條件（不算搜尋字與計畫本身）。 */
export function activeFilterCount(filters: DirectoryFilters): number {
  return [filters.regions.length > 0, filters.zones.length > 0, filters.groups.length > 0,
    filters.participation !== "all", filters.team !== "all", filters.incomplete].filter(Boolean).length;
}

export function isFiltered(filters: DirectoryFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.q.trim() !== "";
}

// ── 組織篩選選項 ────────────────────────────────────────────────────────────

export type OrgOptionSection = { key: string; title: string | null; values: string[] };
export type OrgOptions = { regions: OrgOptionSection[]; zones: OrgOptionSection[]; groups: OrgOptionSection[] };

const UNASSIGNED_SECTION: OrgOptionSection = { key: ORG_UNASSIGNED, title: null, values: [ORG_UNASSIGNED] };

function names<T extends { name: string }>(items: readonly T[] | undefined): string[] {
  return (items || []).map((item) => String(item.name || "").trim()).filter(Boolean);
}

export function orgFilterOptions(org: readonly OrgTreeNode[], filter: OrgFilter): OrgOptions {
  const regions = filter.regions.length ? org.filter((region) => filter.regions.includes(region.name)) : org;
  const zoneSections: OrgOptionSection[] = regions
    .map((region) => ({ key: region.id, title: region.name, values: names(region.zones) }))
    .filter((section) => section.values.length > 0);
  const groupSections: OrgOptionSection[] = [];
  for (const region of regions) {
    for (const zone of region.zones || []) {
      if (filter.zones.length && !filter.zones.includes(zone.name)) continue;
      const values = names(zone.groups);
      if (values.length) groupSections.push({ key: zone.id, title: `${region.name}・${zone.name}`, values });
    }
  }
  return {
    regions: [{ key: "regions", title: null, values: names(org) }, UNASSIGNED_SECTION],
    zones: [...zoneSections, UNASSIGNED_SECTION],
    groups: [...groupSections, UNASSIGNED_SECTION]
  };
}

function offered(sections: readonly OrgOptionSection[]): Set<string> {
  return new Set(sections.flatMap((section) => section.values));
}

/** 上一層改了之後，拿掉下一層已經選不到的值。 */
export function pruneOrgFilter(org: readonly OrgTreeNode[], filter: OrgFilter): OrgFilter {
  const regionsOffered = offered(orgFilterOptions(org, { regions: [], zones: [], groups: [] }).regions);
  const regions = filter.regions.filter((value) => regionsOffered.has(value));
  const zonesOffered = offered(orgFilterOptions(org, { regions, zones: [], groups: [] }).zones);
  const zones = filter.zones.filter((value) => zonesOffered.has(value));
  const groupsOffered = offered(orgFilterOptions(org, { regions, zones, groups: [] }).groups);
  const groups = filter.groups.filter((value) => groupsOffered.has(value));
  return { regions, zones, groups };
}

export function orgValueLabel(value: string): string {
  return value === ORG_UNASSIGNED ? ORG_UNASSIGNED_LABEL : value;
}

/** 下拉摘要：全部大區／2 個大區／第一大區 */
export function orgPickerSummary(values: readonly string[], unit: string): string {
  if (values.length === 0) return `全部${unit}`;
  if (values.length === 1) return orgValueLabel(values[0]);
  return `${values.length} 個${unit}`;
}

// ── 顯示 ────────────────────────────────────────────────────────────────────

/** 隊名（隊長加「[隊長] 」），同 App 的 formatProfilePlanTeams 與 admin-api 匯出。 */
export function teamsText(teams: readonly DirectoryTeam[] | null | undefined): string {
  return (Array.isArray(teams) ? teams : [])
    .map((team) => `${team?.role === "captain" || team?.role === "leader" ? "[隊長] " : ""}${String(team?.name || "").trim() || "未命名隊伍"}`)
    .join("、");
}

/** 會員中心同步狀態，同 App 使用者名單。 */
export function syncLabel(status: string | null | undefined): string {
  const value = String(status || "").trim();
  if (value === "success") return "已同步";
  if (value === "degraded" || value === "failed") return "同步異常";
  return "尚未同步";
}
