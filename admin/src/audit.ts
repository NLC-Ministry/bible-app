// 稽核紀錄（#550 第四組）畫面用的純函式。動作的中文名稱由 admin-api 補好（label），這裡不另外維護。

export const AUDIT_PAGE_SIZE = 50;

export const AUDIT_DAY_OPTIONS = [
  { value: 1, label: "最近 24 小時" },
  { value: 7, label: "最近 7 天" },
  { value: 30, label: "最近 30 天" },
  { value: 90, label: "最近 90 天" },
  { value: 365, label: "最近 1 年" }
] as const;
export type AuditDays = typeof AUDIT_DAY_OPTIONS[number]["value"];

export type AuditResultFilter = "" | "ok" | "denied" | "error";
// legacy＝App 管理分頁與後台照搬區塊的補記（admin-api 對應到資料庫的來源值）
export type AuditSourceFilter = "" | "admin-api" | "legacy";

export const RESULT_OPTIONS: readonly { value: AuditResultFilter; label: string }[] = [
  { value: "", label: "全部" },
  { value: "ok", label: "成功" },
  { value: "denied", label: "被拒絕" },
  { value: "error", label: "失敗" }
];

export const SOURCE_OPTIONS: readonly { value: AuditSourceFilter; label: string }[] = [
  { value: "", label: "全部" },
  { value: "admin-api", label: "後台" },
  { value: "legacy", label: "舊管理畫面" }
];

export const RESULT_LABEL: Record<string, string> = { ok: "成功", denied: "被拒絕", error: "失敗" };

export type AuditFilterState = {
  days: AuditDays;
  action: string;
  result: AuditResultFilter;
  source: AuditSourceFilter;
  actorId: string | null;
  targetId: string | null;
};

export const DEFAULT_AUDIT_FILTERS: AuditFilterState = { days: 7, action: "", result: "", source: "", actorId: null, targetId: null };

/** 篩選條件 → admin-api 參數（沒設的不送）。清單和匯出共用。 */
export function auditParams(filters: AuditFilterState): Record<string, unknown> {
  const params: Record<string, unknown> = { days: filters.days };
  if (filters.action) params.action = filters.action;
  if (filters.result) params.result = filters.result;
  if (filters.source) params.source = filters.source;
  if (filters.actorId) params.actor_id = filters.actorId;
  if (filters.targetId) params.target_user_id = filters.targetId;
  return params;
}

export function activeAuditFilterCount(filters: AuditFilterState): number {
  return [filters.action, filters.result, filters.source, filters.actorId, filters.targetId].filter(Boolean).length;
}

/** 名字；帳號刪了（名字是 NULL）就顯示編號開頭。 */
export function personName(person: { id?: string | null; name?: string | null } | null | undefined): string {
  if (!person) return "—";
  const name = typeof person.name === "string" ? person.name.trim() : "";
  if (name) return name;
  return person.id ? `（已刪除的帳號 ${String(person.id).slice(0, 8)}）` : "—";
}

/** 變更內容裡的一個值 → 顯示文字。 */
export function formatAuditValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "（空）";
  if (typeof value === "string") return value === "" ? "（空字串）" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export type DiffRow = { field: string; before: string; after: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * 「{欄位: {before, after}}」（#549 只記有變動的欄位）→ 表格列；其他形狀（刪除前的整列、截斷標記）回 null，
 * 畫面改用原始 JSON 顯示。新增時沒有 before，顯示「—」。
 */
export function diffRows(changes: unknown): DiffRow[] | null {
  if (!isPlainObject(changes)) return null;
  const entries = Object.entries(changes);
  if (entries.length === 0) return null;
  const rows: DiffRow[] = [];
  for (const [field, value] of entries) {
    if (!isPlainObject(value)) return null;
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.some((key) => key !== "before" && key !== "after")) return null;
    rows.push({
      field,
      before: "before" in value ? formatAuditValue(value.before) : "—",
      after: "after" in value ? formatAuditValue(value.after) : "—"
    });
  }
  return rows;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}
