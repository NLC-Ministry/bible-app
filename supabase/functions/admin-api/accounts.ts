// 後台帳號與權限（#550 第二組）：參數檢查與匯出。
//
// 名單篩選、管理範圍修改的規則在 SQL（20261012053123_admin_api_accounts.sql）；稽核也在 SQL、
// 和資料同一個交易。這裡只檢查前端送來的篩選條件，以及把匯出資料轉成 CSV。
// 人區名單是查人用的，不篩計畫（#694）：計畫條件一律不限，舊版後台送來的 plan_id／participation／team 直接忽略。
// 某計畫的參加者、組隊狀況看計畫區的名單（plan_roster）。
import { directoryCsv, orgCsv, taipeiDate, withExportTime, type DirectoryExportRow } from "./exports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner } from "./types.ts";

export const ORG_UNASSIGNED = "__unassigned__";
const MAX_ORG_VALUES = 200;
const MAX_ORG_VALUE_CHARS = 100;
const MAX_QUERY_CHARS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DirectoryFilters = {
  p_q: string | null;
  p_regions: string[];
  p_zones: string[];
  p_groups: string[];
  /** SQL 的參數簽名還留著計畫條件；這裡固定送「不限」（#694） */
  p_plan_id: null;
  p_participation: "all";
  p_team: "all";
  p_incomplete: boolean;
};

/** 組織篩選：字串陣列，去空白、去重複；空陣列＝不篩。 */
export function orgValues(value: unknown): { ok: true; values: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, values: [] };
  if (!Array.isArray(value) || value.length > MAX_ORG_VALUES) return { ok: false, error: "invalid_org_filter" };
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, error: "invalid_org_filter" };
    const trimmed = item.trim();
    if (trimmed.length > MAX_ORG_VALUE_CHARS) return { ok: false, error: "invalid_org_filter" };
    if (trimmed && !values.includes(trimmed)) values.push(trimmed);
  }
  return { ok: true, values };
}

/** 名單與匯出共用的篩選條件。 */
export function directoryFilters(params: Record<string, unknown>): { ok: true; filters: DirectoryFilters } | { ok: false; error: string } {
  if (params.q !== undefined && params.q !== null && typeof params.q !== "string") return { ok: false, error: "invalid_query" };
  const q = typeof params.q === "string" ? params.q.trim() : "";
  if (q.length > MAX_QUERY_CHARS) return { ok: false, error: "query_too_long" };
  const regions = orgValues(params.regions);
  if (!regions.ok) return regions;
  const zones = orgValues(params.zones);
  if (!zones.ok) return zones;
  const groups = orgValues(params.groups);
  if (!groups.ok) return groups;
  if (params.incomplete !== undefined && typeof params.incomplete !== "boolean") return { ok: false, error: "invalid_incomplete" };
  return {
    ok: true,
    filters: {
      p_q: q || null,
      p_regions: regions.values,
      p_zones: zones.values,
      p_groups: groups.values,
      p_plan_id: null,
      p_participation: "all",
      p_team: "all",
      p_incomplete: params.incomplete === true
    }
  };
}

/**
 * 名單的游標（#567）：上一頁最後一人的排序鍵 [大區排序, 大區, 牧區排序, 牧區, 姓名, id]，原樣是 admin_api_directory_list
 * 回的 next_cursor。排序欄位可以是 null；id 一定要有。沒給＝第一頁。
 */
export function directoryCursor(value: unknown): { ok: true; cursor: unknown[] | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, cursor: null };
  if (!Array.isArray(value) || value.length !== 6) return { ok: false, error: "invalid_cursor" };
  const [region, regionName, zone, zoneName, name, id] = value;
  const intOrNull = (item: unknown) => item === null || (Number.isInteger(item) && Math.abs(item as number) <= 2147483647);
  const textOrNull = (item: unknown) => item === null || (typeof item === "string" && item.length <= 200);
  if (!intOrNull(region) || !intOrNull(zone) || !textOrNull(regionName) || !textOrNull(zoneName) || !textOrNull(name)) {
    return { ok: false, error: "invalid_cursor" };
  }
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "invalid_cursor" };
  return { ok: true, cursor: value };
}

export const runDirectoryExport: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_directory_export", args);
  if (result.error) return sqlFailure("admin_api_directory_export", result.error);
  const data = (result.data || {}) as { rows?: DirectoryExportRow[]; total?: number; truncated?: boolean };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const now = new Date();
  return {
    ok: true,
    data: {
      filename: `使用者名單_${taipeiDate(now)}.csv`,
      csv: withExportTime(directoryCsv(rows), now),
      rows: rows.length,
      total: typeof data.total === "number" ? data.total : rows.length,
      truncated: data.truncated === true
    }
  };
};

export const runOrgExport: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_org_export", args);
  if (result.error) return sqlFailure("admin_api_org_export", result.error);
  const data = (result.data || {}) as { rows?: unknown[][] };
  const rows = Array.isArray(data.rows) ? data.rows.filter((row) => Array.isArray(row)) : [];
  const now = new Date();
  return {
    ok: true,
    data: {
      filename: `組織架構_${taipeiDate(now)}.csv`,
      csv: withExportTime(orgCsv(rows), now),
      rows: rows.length,
      total: rows.length,
      truncated: false
    }
  };
};
