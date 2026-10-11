// admin-api 的權限與參數規則（#547）：純資料＋純函式，handler.ts 用，scripts/admin-api.test.mjs 直接測。
//
// 能力式、預設拒絕：每個 action 宣告需要的能力，角色 → 能力對照表沒列到的角色什麼都沒有。
// 新增 action 一定要寫進 ADMIN_ACTIONS（沒列到的 action 一律 400 unknown_action），
// 測試會掃過整張表確認每個 action 都宣告了能力、限流與對應的 SQL 函式。

export const CAPABILITIES = [
  "console.access", // 進得了後台（bootstrap）
  "support.read",   // 使用者查詢
  "support.pii",    // 顯示完整 email／電話
  "audit.read",     // 稽核紀錄（之後的 action 用）
  "export"          // 匯出（之後的 action 用）
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

export type RateLimit = { bucket: string; limit: number; windowSeconds: number };
export type ActionContext = { actorId: string; actorRole: string; requestId: string };
export type ArgsResult = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
export type ActionSpec = {
  capabilities: readonly Capability[];
  rateLimit: RateLimit;
  rpc: string;
  buildArgs: (params: Record<string, unknown>, ctx: ActionContext) => ArgsResult;
  // 回 null 代表找不到（→ 404）
  notFoundOnNull?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CJK_RE = /[㐀-鿿豈-﫿]/;
const MAX_REASON_CHARS = 200;
const MAX_CURSOR_ID_CHARS = 100;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 搜尋字串：去頭尾空白後至少 1 個中日韓文字或 2 個英數字，最多 100 字。 */
export function validateSearchQuery(value: unknown): { ok: true; query: string } | { ok: false; error: string } {
  const query = typeof value === "string" ? value.trim() : "";
  if (query.length > 100) return { ok: false, error: "query_too_long" };
  const alnum = query.replace(/[^A-Za-z0-9]/g, "").length;
  if (!CJK_RE.test(query) && alnum < 2) return { ok: false, error: "query_too_short" };
  return { ok: true, query };
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

const READ_LIMIT: RateLimit = { bucket: "read", limit: 120, windowSeconds: 60 };

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
