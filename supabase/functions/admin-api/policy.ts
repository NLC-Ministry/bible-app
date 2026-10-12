// admin-api 的權限與參數規則（#547）：純資料＋純函式，handler.ts 用，scripts/admin-api.test.mjs 直接測。
//
// 能力式、預設拒絕：每個 action 宣告需要的能力，角色 → 能力對照表沒列到的角色什麼都沒有。
// 新增 action 一定要寫進 ADMIN_ACTIONS（沒列到的 action 一律 400 unknown_action），
// 測試會掃過整張表確認每個 action 都宣告了能力、限流與對應的 SQL 函式。
// 會改資料的 action，稽核寫在 SQL 函式裡、和資料變動同一個交易（#550）。
import {
  runReportDelete,
  runReportDropAttachment,
  runReportExport,
  runReportPost,
  runReportThread,
  validateReportImage
} from "./reports.ts";
import { directoryFilters, optionalOffset, orgValues, runDirectoryExport, runOrgExport } from "./accounts.ts";
import { auditEventId, auditFilters, runAuditEvent, runAuditExport, runAuditList, type AuditFilters } from "./audit.ts";
import { validateSearchQuery } from "./search-query.ts";
import type { ActionContext, ActionRunner } from "./types.ts";

export { validateSearchQuery };

export const CAPABILITIES = [
  "console.access", // 進得了後台（bootstrap）
  "support.read",   // 使用者查詢、回報收件匣
  "support.pii",    // 顯示完整 email／電話
  "support.write",  // 回覆回報、改回報狀態、刪截圖／回報（#550）
  "accounts.read",  // 使用者名單、管理範圍總覽（#550）
  "accounts.write", // 改管理範圍（#550）；角色由會員中心同步，後台不改
  "operations.manage", // 照搬的營運區塊：計畫管理、加入計畫狀況、組員總覽、組隊狀況、計畫統計、讀經使用率、報名註冊統計（#550）
  "content.manage", // 照搬的內容區塊：公告、經文注釋、小測驗、大測驗、雲柱測驗（#550）
  "settings.manage", // 照搬的功能開放設定（#550）
  "audit.read",     // 看、匯出稽核紀錄（#550）
  "export"          // 匯出
] as const;
export type Capability = typeof CAPABILITIES[number];

// 角色一律從資料庫讀（admin_api_actor → role_definitions.code）。系統管理員全部都有，其他角色先全部沒有。
export const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = Object.freeze({
  admin: CAPABILITIES
});

export function capabilitiesForRole(roleCode: unknown): Capability[] {
  const key = typeof roleCode === "string" ? roleCode : "";
  return Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, key) ? [...ROLE_CAPABILITIES[key]] : [];
}

export const USER_SECTIONS = ["reading_logs", "team_events", "tests", "vouchers", "reports"] as const;

export const REPORT_STATUSES = ["pending", "processing", "resolved", "ignored"] as const;
// 收件匣篩選多一個 open（待處理＋處理中）
export const REPORT_FILTERS = ["open", ...REPORT_STATUSES] as const;

export type RateLimit = { bucket: string; limit: number; windowSeconds: number };
export type { ActionContext };
export type ArgsResult = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
export type ActionSpec = {
  capabilities: readonly Capability[];
  // 依參數再多要的能力（例如匯出哪一區）；參數不認得就回 []，交給 buildArgs 回 400
  paramCapabilities?: (params: Record<string, unknown>) => readonly Capability[];
  rateLimit: RateLimit;
  // 這個 action 的主要 SQL 函式（只給 service_role）；有 run 時由 run 呼叫
  rpc: string;
  buildArgs: (params: Record<string, unknown>, ctx: ActionContext) => ArgsResult;
  // 回 null 代表找不到（→ 404，錯誤碼 notFoundError，預設 user_not_found）
  notFoundOnNull?: boolean;
  notFoundError?: string;
  // 需要 SQL 以外步驟（Storage、CSV）時用；沒有就是「呼叫 rpc、回傳結果」
  run?: ActionRunner;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_CHARS = 200;
const MAX_CURSOR_ID_CHARS = 100;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function optionalReason(value: unknown): { ok: true; reason: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, reason: null };
  if (typeof value !== "string") return { ok: false, error: "invalid_reason" };
  const reason = value.trim();
  if (reason.length > MAX_REASON_CHARS) return { ok: false, error: "reason_too_long" };
  return { ok: true, reason: reason || null };
}

function optionalCursor(value: unknown): { ok: true; at: string | null; id: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, at: null, id: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_cursor" };
  const { at, id } = value as Record<string, unknown>;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return { ok: false, error: "invalid_cursor" };
  if (typeof id !== "string" || !id || id.length > MAX_CURSOR_ID_CHARS) return { ok: false, error: "invalid_cursor" };
  return { ok: true, at, id };
}

function optionalLimit(value: unknown, fallback: number): { ok: true; limit: number } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, limit: fallback };
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 50) return { ok: false, error: "invalid_limit" };
  return { ok: true, limit: value as number };
}

function optionalReportFilter(value: unknown): { ok: true; status: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "" || value === "all") return { ok: true, status: null };
  if (typeof value !== "string" || !(REPORT_FILTERS as readonly string[]).includes(value)) return { ok: false, error: "invalid_status" };
  return { ok: true, status: value };
}

const READ_LIMIT: RateLimit = { bucket: "read", limit: 120, windowSeconds: 60 };
const WRITE_LIMIT: RateLimit = { bucket: "write", limit: 30, windowSeconds: 60 };
const EXPORT_LIMIT: RateLimit = { bucket: "export", limit: 20, windowSeconds: 3600 };
const MAX_REPLY_CHARS = 500;

const actorArgs = (ctx: ActionContext) => ({ p_actor_id: ctx.actorId, p_actor_role: ctx.actorRole });

// 稽核紀錄的條件 → SQL 參數（清單的 p_actor_id 是「篩選的操作者」；匯出的 p_actor_id 是匯出的人，篩選的另外叫 p_filter_actor_id）
const auditFilterArgs = (filters: AuditFilters) => ({
  p_days: filters.days,
  p_action: filters.action,
  p_result: filters.result,
  p_source: filters.source,
  p_target_user_id: filters.targetUserId
});

// ── 照搬的舊管理區塊（#550）──────────────────────────────────────────────────
// 區塊 id → 需要的能力。舊區塊的資料仍走 nlc-data（那邊自己檢查角色、寫稽核）；
// admin-api 只管它們的匯出：檔案由舊程式在瀏覽器產生，下載前先記一筆，記不成就不下載。
// 同一份清單另外兩處：admin-legacy/sections.mjs、admin/src/legacy.ts（scripts/admin-legacy.test.mjs 比對）。
export const LEGACY_EXPORT_SECTIONS: Readonly<Record<string, Capability>> = Object.freeze({
  announcements: "content.manage",
  commentary: "content.manage",
  quizzes: "content.manage",
  exam: "content.manage",
  "lightning-quiz": "content.manage",
  plans: "operations.manage",
  "join-status": "operations.manage",
  members: "operations.manage",
  teams: "operations.manage",
  statistics: "operations.manage",
  "reading-activity": "operations.manage",
  registrations: "operations.manage",
  settings: "settings.manage"
});
export const LEGACY_EXPORT_FORMATS = ["csv", "txt"] as const;
const MAX_LEGACY_FILENAME_CHARS = 200;
const MAX_LEGACY_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_LEGACY_EXPORT_ROWS = 10_000_000;

export function legacySectionCapability(section: unknown): Capability | null {
  const key = typeof section === "string" ? section : "";
  return Object.prototype.hasOwnProperty.call(LEGACY_EXPORT_SECTIONS, key) ? LEGACY_EXPORT_SECTIONS[key] : null;
}

function buildLegacyExportArgs(params: Record<string, unknown>, ctx: ActionContext): ArgsResult {
  const section = typeof params.section === "string" ? params.section : "";
  if (!legacySectionCapability(section)) return { ok: false, error: "invalid_section" };
  const filename = typeof params.filename === "string" ? params.filename.trim() : "";
  if (!filename || filename.length > MAX_LEGACY_FILENAME_CHARS || /[\u0000-\u001f\u007f]/.test(filename)) {
    return { ok: false, error: "invalid_export" };
  }
  if (!(LEGACY_EXPORT_FORMATS as readonly unknown[]).includes(params.format)) return { ok: false, error: "invalid_export" };
  const rows = params.rows ?? null;
  if (rows !== null && !(Number.isInteger(rows) && (rows as number) >= 0 && (rows as number) <= MAX_LEGACY_EXPORT_ROWS)) {
    return { ok: false, error: "invalid_export" };
  }
  const bytes = params.bytes;
  if (!Number.isInteger(bytes) || (bytes as number) < 0 || (bytes as number) > MAX_LEGACY_EXPORT_BYTES) {
    return { ok: false, error: "invalid_export" };
  }
  return { ok: true, args: {
    p_action: "export",
    p_result: "ok",
    ...actorArgs(ctx),
    p_resource: `legacy:${section}`,
    p_target_user_id: null,
    p_reason: null,
    p_request_id: ctx.requestId,
    p_detail: { kind: "legacy", section, filename, format: params.format, rows, bytes }
  } };
}

export const ADMIN_ACTIONS: Readonly<Record<string, ActionSpec>> = Object.freeze({
  bootstrap: {
    capabilities: ["console.access"],
    rateLimit: { bucket: "bootstrap", limit: 30, windowSeconds: 60 },
    rpc: "admin_api_bootstrap",
    buildArgs: (_params, ctx) => ({ ok: true, args: { p_actor_id: ctx.actorId } })
  },
  user_search: {
    capabilities: ["support.read"],
    rateLimit: { bucket: "search", limit: 60, windowSeconds: 60 },
    rpc: "admin_api_user_search",
    buildArgs: (params) => {
      const q = validateSearchQuery(params.q);
      return q.ok ? { ok: true, args: { p_query: q.query, p_limit: 20 } } : q;
    }
  },
  user_summary: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_user_summary",
    notFoundOnNull: true,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.user_id)) return { ok: false, error: "invalid_user_id" };
      const reason = optionalReason(params.reason);
      if (!reason.ok) return reason;
      return { ok: true, args: {
        p_actor_id: ctx.actorId, p_actor_role: ctx.actorRole, p_user_id: params.user_id,
        p_reason: reason.reason, p_request_id: ctx.requestId
      } };
    }
  },
  user_section: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_user_section",
    buildArgs: (params) => {
      if (!isUuid(params.user_id)) return { ok: false, error: "invalid_user_id" };
      if (typeof params.section !== "string" || !(USER_SECTIONS as readonly string[]).includes(params.section)) {
        return { ok: false, error: "invalid_section" };
      }
      const cursor = optionalCursor(params.cursor);
      if (!cursor.ok) return cursor;
      const limit = optionalLimit(params.limit, 20);
      if (!limit.ok) return limit;
      return { ok: true, args: {
        p_user_id: params.user_id, p_section: params.section,
        p_cursor_at: cursor.at, p_cursor_id: cursor.id, p_limit: limit.limit
      } };
    }
  },
  user_timeline: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_user_timeline",
    buildArgs: (params) => {
      if (!isUuid(params.user_id)) return { ok: false, error: "invalid_user_id" };
      const cursor = optionalCursor(params.cursor);
      if (!cursor.ok) return cursor;
      const limit = optionalLimit(params.limit, 30);
      if (!limit.ok) return limit;
      return { ok: true, args: {
        p_user_id: params.user_id, p_cursor_at: cursor.at, p_cursor_id: cursor.id, p_limit: limit.limit
      } };
    }
  },
  reveal_pii: {
    capabilities: ["support.pii"],
    rateLimit: { bucket: "pii", limit: 30, windowSeconds: 3600 },
    rpc: "admin_api_reveal_pii",
    notFoundOnNull: true,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.user_id)) return { ok: false, error: "invalid_user_id" };
      const reason = optionalReason(params.reason);
      if (!reason.ok) return reason;
      return { ok: true, args: {
        p_actor_id: ctx.actorId, p_actor_role: ctx.actorRole, p_user_id: params.user_id,
        p_reason: reason.reason, p_request_id: ctx.requestId
      } };
    }
  },

  // ── 回報收件匣（#550 第一組）──────────────────────────────────────────────
  report_list: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_report_list",
    buildArgs: (params) => {
      const status = optionalReportFilter(params.status);
      if (!status.ok) return status;
      const cursor = optionalCursor(params.cursor);
      if (!cursor.ok) return cursor;
      if (cursor.id !== null && !isUuid(cursor.id)) return { ok: false, error: "invalid_cursor" };
      const limit = optionalLimit(params.limit, 30);
      if (!limit.ok) return limit;
      return { ok: true, args: {
        p_status: status.status, p_unread_only: params.unread_only === true,
        p_cursor_at: cursor.at, p_cursor_id: cursor.id, p_limit: limit.limit
      } };
    }
  },
  report_thread: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_report_thread",
    run: runReportThread,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.report_id)) return { ok: false, error: "invalid_report_id" };
      const reason = optionalReason(params.reason);
      if (!reason.ok) return reason;
      // refresh＝畫面自動更新：不重複記 view_report
      return { ok: true, args: {
        ...actorArgs(ctx), p_report_id: params.report_id, p_audit: params.refresh !== true,
        p_reason: reason.reason, p_request_id: ctx.requestId
      } };
    }
  },
  report_diagnostics: {
    capabilities: ["support.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_report_diagnostics",
    notFoundOnNull: true,
    notFoundError: "report_not_found",
    buildArgs: (params) => isUuid(params.report_id)
      ? { ok: true, args: { p_report_id: params.report_id } }
      : { ok: false, error: "invalid_report_id" }
  },
  report_set_status: {
    capabilities: ["support.write"],
    rateLimit: WRITE_LIMIT,
    rpc: "admin_api_report_set_status",
    notFoundOnNull: true,
    notFoundError: "report_not_found",
    buildArgs: (params, ctx) => {
      if (!isUuid(params.report_id)) return { ok: false, error: "invalid_report_id" };
      if (typeof params.status !== "string" || !(REPORT_STATUSES as readonly string[]).includes(params.status)) {
        return { ok: false, error: "invalid_status" };
      }
      return { ok: true, args: { ...actorArgs(ctx), p_report_id: params.report_id, p_status: params.status, p_request_id: ctx.requestId } };
    }
  },
  report_post: {
    capabilities: ["support.write"],
    rateLimit: WRITE_LIMIT,
    rpc: "admin_api_report_post",
    run: runReportPost,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.report_id)) return { ok: false, error: "invalid_report_id" };
      if (params.body !== undefined && typeof params.body !== "string") return { ok: false, error: "invalid_body" };
      const body = typeof params.body === "string" ? params.body : "";
      if (body.trim().length > MAX_REPLY_CHARS) return { ok: false, error: "body_too_long" };
      const image = validateReportImage(params.image);
      if (!image.ok) return image;
      if (!body.trim() && !image.image) return { ok: false, error: "empty_message" };
      return { ok: true, args: {
        ...actorArgs(ctx), p_report_id: params.report_id, p_body: body,
        p_is_internal: params.is_internal === true, p_has_attachment: !!image.image, p_request_id: ctx.requestId
      } };
    }
  },
  report_attachment_delete: {
    capabilities: ["support.write"],
    rateLimit: WRITE_LIMIT,
    rpc: "admin_api_report_drop_attachment",
    run: runReportDropAttachment,
    buildArgs: (params, ctx) => isUuid(params.message_id)
      ? { ok: true, args: { ...actorArgs(ctx), p_message_id: params.message_id, p_audit: true, p_request_id: ctx.requestId } }
      : { ok: false, error: "invalid_message_id" }
  },
  report_delete: {
    capabilities: ["support.write"],
    rateLimit: { bucket: "delete", limit: 20, windowSeconds: 3600 },
    rpc: "admin_api_report_delete",
    run: runReportDelete,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.report_id)) return { ok: false, error: "invalid_report_id" };
      const reason = optionalReason(params.reason);
      if (!reason.ok) return reason;
      return { ok: true, args: { ...actorArgs(ctx), p_report_id: params.report_id, p_reason: reason.reason, p_request_id: ctx.requestId } };
    }
  },
  directory_list: {
    capabilities: ["accounts.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_directory_list",
    buildArgs: (params, ctx) => {
      const filters = directoryFilters(params);
      if (!filters.ok) return filters;
      const offset = optionalOffset(params.offset);
      if (!offset.ok) return offset;
      const limit = optionalLimit(params.limit, 50);
      if (!limit.ok) return limit;
      return { ok: true, args: { p_actor_id: ctx.actorId, ...filters.filters, p_offset: offset.offset, p_limit: limit.limit } };
    }
  },
  // 名單匯出含完整 email：要 support.pii
  directory_export: {
    capabilities: ["accounts.read", "export", "support.pii"],
    rateLimit: EXPORT_LIMIT,
    rpc: "admin_api_directory_export",
    run: runDirectoryExport,
    buildArgs: (params, ctx) => {
      const filters = directoryFilters(params);
      if (!filters.ok) return filters;
      return { ok: true, args: { ...actorArgs(ctx), ...filters.filters, p_request_id: ctx.requestId } };
    }
  },
  scope_overview: {
    capabilities: ["accounts.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_scope_overview",
    buildArgs: () => ({ ok: true, args: {} })
  },
  scope_set: {
    capabilities: ["accounts.write"],
    rateLimit: WRITE_LIMIT,
    rpc: "admin_api_scope_set",
    notFoundOnNull: true,
    buildArgs: (params, ctx) => {
      if (!isUuid(params.profile_id)) return { ok: false, error: "invalid_user_id" };
      const regions = orgValues(params.regions);
      if (!regions.ok) return regions;
      const zones = orgValues(params.zones);
      if (!zones.ok) return zones;
      const groups = orgValues(params.groups);
      if (!groups.ok) return groups;
      const reason = optionalReason(params.reason);
      if (!reason.ok) return reason;
      return { ok: true, args: {
        ...actorArgs(ctx), p_profile_id: params.profile_id, p_regions: regions.values, p_zones: zones.values, p_groups: groups.values,
        p_reason: reason.reason, p_request_id: ctx.requestId
      } };
    }
  },
  org_export: {
    capabilities: ["accounts.read", "export"],
    rateLimit: EXPORT_LIMIT,
    rpc: "admin_api_org_export",
    run: runOrgExport,
    buildArgs: (_params, ctx) => ({ ok: true, args: { ...actorArgs(ctx), p_request_id: ctx.requestId } })
  },
  // 照搬區塊的匯出（#550）：只記稽核（admin_api_record_event 回稽核編號），記成功前端才存檔
  legacy_export_audit: {
    capabilities: ["export"],
    paramCapabilities: (params) => {
      const capability = legacySectionCapability(params.section);
      return capability ? [capability] : [];
    },
    rateLimit: EXPORT_LIMIT,
    rpc: "admin_api_record_event",
    buildArgs: buildLegacyExportArgs
  },
  report_export: {
    capabilities: ["support.read", "export"],
    rateLimit: EXPORT_LIMIT,
    rpc: "admin_api_report_export",
    run: runReportExport,
    buildArgs: (params, ctx) => {
      const status = optionalReportFilter(params.status);
      if (!status.ok) return status;
      return { ok: true, args: { ...actorArgs(ctx), p_status: status.status, p_request_id: ctx.requestId } };
    }
  },

  // ── 稽核紀錄（#550 第四組）────────────────────────────────────────────────
  // 看清單不記稽核（見 migration 說明）；動作的中文名稱由 run 補上（audit.ts）
  audit_list: {
    capabilities: ["audit.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_audit_list",
    run: runAuditList,
    buildArgs: (params) => {
      const filters = auditFilters(params);
      if (!filters.ok) return filters;
      let cursor: number | null = null;
      if (params.cursor !== undefined && params.cursor !== null) {
        const id = auditEventId(params.cursor);
        if (!id.ok) return { ok: false, error: "invalid_cursor" };
        cursor = id.value;
      }
      const limit = optionalLimit(params.limit, 50);
      if (!limit.ok) return limit;
      return { ok: true, args: {
        ...auditFilterArgs(filters.value), p_actor_id: filters.value.actorId, p_cursor_id: cursor, p_limit: limit.limit
      } };
    }
  },
  audit_event: {
    capabilities: ["audit.read"],
    rateLimit: READ_LIMIT,
    rpc: "admin_api_audit_event",
    run: runAuditEvent,
    buildArgs: (params) => {
      const id = auditEventId(params.id);
      return id.ok ? { ok: true, args: { p_id: id.value } } : id;
    }
  },
  audit_export: {
    capabilities: ["audit.read", "export"],
    rateLimit: EXPORT_LIMIT,
    rpc: "admin_api_audit_export",
    run: runAuditExport,
    buildArgs: (params, ctx) => {
      const filters = auditFilters(params);
      if (!filters.ok) return filters;
      return { ok: true, args: {
        ...actorArgs(ctx), ...auditFilterArgs(filters.value), p_filter_actor_id: filters.value.actorId, p_request_id: ctx.requestId
      } };
    }
  }
});

export function getAdminAction(name: unknown): ActionSpec | null {
  const key = typeof name === "string" ? name : "";
  return Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, key) ? ADMIN_ACTIONS[key] : null;
}

export function hasCapabilities(granted: readonly string[], required: readonly string[]): boolean {
  return required.length > 0 && required.every(cap => granted.includes(cap));
}

// ── 後台 Logto 應用程式（#554）──────────────────────────────────────────────
/** 逗號分隔的 client id 清單；空的就是「沒設定」，handler 會全部拒絕（fail closed）。 */
export function parseList(raw: unknown): string[] {
  return String(raw ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

export function isAllowedClient(payload: Record<string, unknown>, allowedClientIds: readonly string[], claim = "client_id"): boolean {
  if (allowedClientIds.length === 0) return false;
  const value = payload[claim];
  return typeof value === "string" && allowedClientIds.includes(value);
}

// ── CORS：只允許後台網域 ────────────────────────────────────────────────────
export const DEFAULT_ADMIN_ORIGINS = [
  "https://bible-speed-reading-admin.vercel.app",
  "https://bible-speed-reading-admin-staging.vercel.app"
];
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function adminAllowOrigin(origin: string | null, extraOrigins: readonly string[] = [], allowLocalhost = false): string | null {
  if (!origin) return null;
  if (DEFAULT_ADMIN_ORIGINS.includes(origin) || extraOrigins.includes(origin)) return origin;
  if (allowLocalhost && LOCAL_ORIGIN_RE.test(origin)) return origin;
  return null;
}

// 同 nlc-data 的 resolveRequestId：只收看起來像 id 的值，其他就自己產生。
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;
export function resolveRequestId(header: string | null | undefined, generate: () => string): string {
  const value = String(header || "").trim();
  return REQUEST_ID_RE.test(value) ? value : generate();
}
