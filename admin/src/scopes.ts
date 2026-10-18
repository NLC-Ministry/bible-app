// 管理範圍的規則（#550）。純函式，測試直接測。
//
// 和 App 管理分頁相同（js/modules/admin.js 的 getManagedScopeConfig／getProfileDefaultManagedScopes、
// js/modules/admin-managed-scope-options.mjs 的 buildManagedScopeChoices）；後台不能 import js/，
// 所以這裡另寫一份，admin/__tests__/scopes.test.ts 拿兩邊比對結果：
// · 大區長設 managed_regions、區長設 managed_zones、小組長設 managed_groups；
// · 系統管理員、牧者固定全教會；其他角色只有本人；
// · 沒設定時用本人的牧養歸屬當有效範圍；
// · 編輯時只勾組織名單裡有的名稱，名單裡沒有的列出來、儲存後移除（set_profile_managed_scopes 會擋不認得的名稱）。
// 範圍以「名稱」記錄（不是 id），和 profiles.managed_* 一樣。
import type { OrgTreeNode } from "./types.ts";

export type ScopeLevel = "region" | "zone" | "group";

export const LEVEL_LABEL: Record<ScopeLevel, string> = { region: "大區", zone: "牧區", group: "小組" };

const ROLE_LEVEL: Record<string, ScopeLevel> = {
  great_zone_leader: "region",
  zone_leader: "zone",
  group_leader: "group"
};

export const WHOLE_CHURCH_ROLES = ["admin", "pastor"] as const;
export const WHOLE_CHURCH_ROLE_LABEL: Record<(typeof WHOLE_CHURCH_ROLES)[number], string> = { admin: "系統管理員", pastor: "牧者" };

export function scopeLevel(roleCode: string | null | undefined): ScopeLevel | null {
  return ROLE_LEVEL[String(roleCode || "")] || null;
}

export function isWholeChurch(roleCode: string | null | undefined): boolean {
  return (WHOLE_CHURCH_ROLES as readonly string[]).includes(String(roleCode || ""));
}

export type ScopePerson = {
  role_code: string;
  great_region: string | null;
  pastoral_zone: string | null;
  small_group: string | null;
  /** 陣列（scope_overview）或逗號分隔字串（directory_list） */
  managed_regions: readonly string[] | string | null;
  managed_zones: readonly string[] | string | null;
  managed_groups: readonly string[] | string | null;
};

export function splitScope(value: readonly string[] | string | null | undefined): string[] {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

const FIELD: Record<ScopeLevel, "managed_regions" | "managed_zones" | "managed_groups"> = {
  region: "managed_regions",
  zone: "managed_zones",
  group: "managed_groups"
};

const PLACEMENT: Record<ScopeLevel, "great_region" | "pastoral_zone" | "small_group"> = {
  region: "great_region",
  zone: "pastoral_zone",
  group: "small_group"
};

/** 有效範圍：有設定用設定的，沒設定用本人歸屬；不適用的角色回空陣列。 */
export function effectiveScopes(person: ScopePerson): string[] {
  const level = scopeLevel(person.role_code);
  if (!level) return [];
  const explicit = splitScope(person[FIELD[level]]);
  if (explicit.length > 0) return explicit;
  const placement = String(person[PLACEMENT[level]] || "").trim();
  return placement ? [placement] : [];
}

/** 範圍是不是用本人歸屬補的（沒有另外設定）。 */
export function usesPlacementFallback(person: ScopePerson): boolean {
  const level = scopeLevel(person.role_code);
  return !!level && splitScope(person[FIELD[level]]).length === 0 && effectiveScopes(person).length > 0;
}

/** 畫面上一句話：全教會／名稱以「、」相接／僅本人。 */
export function scopeText(person: ScopePerson): string {
  if (isWholeChurch(person.role_code)) return "全教會";
  return effectiveScopes(person).join("、") || "僅本人";
}

// ── 組織名單 ────────────────────────────────────────────────────────────────

export type OrgTree = readonly OrgTreeNode[];

/** 某一層的所有名稱（去重複）。 */
export function orgNames(org: OrgTree, level: ScopeLevel): string[] {
  const names: string[] = [];
  const add = (name: unknown) => {
    const trimmed = String(name || "").trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  };
  for (const region of org) {
    if (level === "region") add(region.name);
    for (const zone of region.zones || []) {
      if (level === "zone") add(zone.name);
      if (level === "group") for (const group of zone.groups || []) add(group.name);
    }
  }
  return names;
}

export type ChoiceSection = { key: string; title: string; names: string[] };

export type ScopeChoices = {
  /** 依上一層分段（大區一段；牧區依大區分；小組依「大區・牧區」分），順序同組織名單 */
  sections: ChoiceSection[];
  /** 預先勾選：目前有效範圍中、組織名單裡有的 */
  selected: string[];
  /** 名單裡沒有的名稱（不勾，儲存後會移除） */
  dropped: string[];
};

export function scopeChoices(org: OrgTree, level: ScopeLevel, current: readonly string[]): ScopeChoices {
  const sections: ChoiceSection[] = [];
  if (level === "region") {
    sections.push({ key: "regions", title: "大區", names: orgNames(org, "region") });
  } else {
    for (const region of org) {
      if (level === "zone") {
        const names = (region.zones || []).map((zone) => String(zone.name || "").trim()).filter(Boolean);
        if (names.length) sections.push({ key: region.id, title: region.name, names });
      } else {
        for (const zone of region.zones || []) {
          const names = (zone.groups || []).map((group) => String(group.name || "").trim()).filter(Boolean);
          if (names.length) sections.push({ key: zone.id, title: `${region.name}・${zone.name}`, names });
        }
      }
    }
  }
  const known = new Set(orgNames(org, level));
  const trimmed = current.map((name) => String(name).trim());
  return {
    sections,
    selected: trimmed.filter((name) => known.has(name)),
    dropped: trimmed.filter((name) => name && !known.has(name))
  };
}

// ── 權限總覽 ────────────────────────────────────────────────────────────────

export type ScopeAssignment<T extends ScopePerson> = {
  wholeChurch: Record<(typeof WHOLE_CHURCH_ROLES)[number], T[]>;
  byLevel: Record<ScopeLevel, Map<string, T[]>>;
};

/** 每個單位由誰負責（用有效範圍，和 App 的權限總覽一樣）。 */
export function assignLeaders<T extends ScopePerson>(people: readonly T[]): ScopeAssignment<T> {
  const result: ScopeAssignment<T> = {
    wholeChurch: { admin: [], pastor: [] },
    byLevel: { region: new Map(), zone: new Map(), group: new Map() }
  };
  for (const person of people) {
    if (isWholeChurch(person.role_code)) {
      result.wholeChurch[person.role_code as (typeof WHOLE_CHURCH_ROLES)[number]].push(person);
      continue;
    }
    const level = scopeLevel(person.role_code);
    if (!level) continue;
    const bucket = result.byLevel[level];
    for (const name of effectiveScopes(person)) {
      const list = bucket.get(name);
      if (list) list.push(person);
      else bucket.set(name, [person]);
    }
  }
  return result;
}

/** 沒有人負責的單位數（大區＋牧區＋小組，逐個單位算；負責人和 App 一樣以名稱比對）。 */
export function unassignedCount<T extends ScopePerson>(org: OrgTree, assignment: ScopeAssignment<T>): number {
  const { region, zone, group } = assignment.byLevel;
  let count = 0;
  for (const r of org) {
    if (!region.has(r.name)) count += 1;
    for (const z of r.zones || []) {
      if (!zone.has(z.name)) count += 1;
      for (const g of z.groups || []) if (!group.has(g.name)) count += 1;
    }
  }
  return count;
}
