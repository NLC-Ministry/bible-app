// admin-api（#547）的前端呼叫（#555）。後台只打這一支，不載入會友 App 的 state/db。
//
// · 每個請求帶 x-request-id（伺服器記 log、稽核用同一個 id），錯誤畫面會顯示，方便對照。
// · 記憶體快取 60 秒：同一個人切換區塊、回到剛看過的頁面不重抓。只放記憶體，重新整理就沒了。
//   快取鍵不含查看理由：同一個人 60 秒內換個理由重開不會再記一筆查看。
// · 同一個請求還在路上時再要一次，共用同一個（沒帶 AbortSignal 的才共用）。
// · 顯示個資（reveal_pii）、bootstrap、會改資料的、回報清單與對話（會一直變）不快取。
// · 401 → onUnauthorized（重新導向 SSO）；其他錯誤丟 AdminApiError，畫面用 describeAdminError 轉成中文。

export type AdminAction =
  | "bootstrap" | "user_search" | "user_summary" | "user_section" | "user_timeline" | "reveal_pii"
  // 回報收件匣（#550）
  | "report_list" | "report_thread" | "report_diagnostics" | "report_set_status" | "report_post"
  | "report_attachment_delete" | "report_delete" | "report_export"
  // 帳號與權限（#550）
  | "directory_list" | "directory_export" | "scope_overview" | "scope_set" | "org_export"
  // 照搬的舊管理區塊：下載前記一筆匯出稽核（#550）
  | "legacy_export_audit"
  // 稽核紀錄（#550）
  | "audit_list" | "audit_event" | "audit_export";

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfter: number | null;

  constructor(status: number, code: string, requestId: string | null, retryAfter: number | null = null) {
    super(code);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

export const CACHE_TTL_MS = 60_000;
const CACHEABLE: ReadonlySet<AdminAction> = new Set<AdminAction>([
  "user_search", "user_summary", "user_section", "user_timeline",
  "report_diagnostics", // 診斷資訊是回報當下的快照，不會變
  "directory_list", "scope_overview", // 改管理範圍後 invalidate
  "audit_list", // 切到功能開放設定再回來不重抓；重新整理鈕用 fresh
  "audit_event" // 稽核紀錄不會改
]);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AdminApiOptions = {
  url: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
  now?: () => number;
  newRequestId?: () => string;
  cacheTtlMs?: number;
};

export type CallOptions = { signal?: AbortSignal; fresh?: boolean };

export type AdminApi = {
  call<T = unknown>(action: AdminAction, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  peek<T = unknown>(action: AdminAction, params?: Record<string, unknown>): T | undefined;
  /** 改了資料之後，丟掉這幾種 action 的快取（例如改回報狀態 → 某人頁面的回報區塊要重抓）。 */
  invalidate(actions: readonly AdminAction[]): void;
  clear(): void;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function cacheKey(action: AdminAction, params: Record<string, unknown> = {}): string {
  const { reason: _reason, ...rest } = params;
  return `${action}:${stableStringify(rest)}`;
}

export function newAdminRequestId(): string {
  const cryptoObj: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return `adm-${cryptoObj.randomUUID()}`;
  const bytes = new Uint8Array(16);
  cryptoObj?.getRandomValues(bytes);
  return `adm-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

export function createAdminApi(options: AdminApiOptions): AdminApi {
  const fetchImpl: FetchLike = options.fetchImpl || ((input, init) => fetch(input, init));
  const now = options.now || (() => Date.now());
  const newRequestId = options.newRequestId || newAdminRequestId;
  const ttl = options.cacheTtlMs ?? CACHE_TTL_MS;
  const cache = new Map<string, { at: number; data: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();

  async function send(action: AdminAction, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const token = options.getToken();
    if (!token) {
      options.onUnauthorized?.();
      throw new AdminApiError(401, "session_expired", null);
    }
    const requestId = newRequestId();
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-request-id": requestId
        },
        body: JSON.stringify({ action, params }),
        signal,
        credentials: "omit",
        cache: "no-store"
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new AdminApiError(0, "network_error", requestId);
    }
    let body: { data?: unknown; error?: unknown; request_id?: unknown; retry_after?: unknown } | null = null;
    try {
      body = await response.json();
    } catch (_err) {
      body = null;
    }
    const serverRequestId = response.headers.get("x-request-id")
      || (typeof body?.request_id === "string" ? body.request_id : null)
      || requestId;
    if (!response.ok) {
      const code = typeof body?.error === "string" ? body.error : `http_${response.status}`;
      const retryAfter = Number(response.headers.get("Retry-After") || body?.retry_after) || null;
      if (response.status === 401) options.onUnauthorized?.();
      throw new AdminApiError(response.status, code, serverRequestId, retryAfter);
    }
    return body?.data ?? null;
  }

  return {
    call<T = unknown>(action: AdminAction, params: Record<string, unknown> = {}, callOptions: CallOptions = {}): Promise<T> {
      const cacheable = CACHEABLE.has(action);
      const key = cacheable ? cacheKey(action, params) : "";
      if (cacheable && !callOptions.fresh) {
        const hit = cache.get(key);
        if (hit && now() - hit.at < ttl) return Promise.resolve(hit.data as T);
        const pending = callOptions.signal ? undefined : inflight.get(key);
        if (pending) return pending as Promise<T>;
      }
      const promise = send(action, params, callOptions.signal).then((data) => {
        if (cacheable) cache.set(key, { at: now(), data });
        return data;
      });
      if (cacheable && !callOptions.signal) {
        inflight.set(key, promise);
        promise.finally(() => inflight.delete(key)).catch(() => {});
      }
      return promise as Promise<T>;
    },
    peek<T = unknown>(action: AdminAction, params: Record<string, unknown> = {}): T | undefined {
      if (!CACHEABLE.has(action)) return undefined;
      const hit = cache.get(cacheKey(action, params));
      return hit && now() - hit.at < ttl ? hit.data as T : undefined;
    },
    invalidate(actions: readonly AdminAction[]) {
      const prefixes = actions.map((action) => `${action}:`);
      for (const key of [...cache.keys()]) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) cache.delete(key);
      }
    },
    clear() {
      cache.clear();
      inflight.clear();
    }
  };
}

function waitText(seconds: number): string {
  return seconds >= 120 ? `${Math.ceil(seconds / 60)} 分鐘` : `${seconds} 秒`;
}

/** 錯誤 → 給管理員看的一句話（請求編號另外顯示）。 */
export function describeAdminError(err: unknown): string {
  if (!(err instanceof AdminApiError)) return "發生未預期的錯誤，請重新整理後再試。";
  switch (err.code) {
    case "network_error": return "連不上後台服務，請檢查網路後再試。";
    case "session_expired":
    case "invalid_token":
    case "missing_authorization": return "登入已過期，正在重新登入…";
    case "auth_verification_unavailable": return "登入驗證服務暫時無法使用，請稍後再試。";
    case "admin_client_not_configured": return "後台服務還沒設定好（admin-api 缺少後台應用程式設定），請聯絡開發者。";
    case "client_not_allowed": return "這個登入不是後台應用程式發的，請重新整理再登入一次。";
    case "origin_not_allowed": return "後台服務不接受這個網址來的請求，請從書籤裡的後台網址進入。";
    case "forbidden": return "你的帳號沒有這項後台權限。";
    case "rate_limited": return `操作太頻繁，請 ${waitText(err.retryAfter || 60)}後再試。`;
    case "user_not_found": return "找不到這位使用者。";
    case "query_too_short": return "請輸入至少 1 個中文字或 2 個英文字母／數字。";
    case "query_too_long": return "搜尋字太長（最多 100 字）。";
    case "reason_too_long": return "查看理由最多 200 字。";
    case "report_not_found": return "找不到這張回報（可能已經被刪除）。";
    case "message_not_found": return "找不到這則訊息（可能已經被刪除）。";
    case "thread_full": return "這串對話已經有 200 則，不能再回覆。";
    case "empty_message": return "請輸入回覆內容或附上截圖。";
    case "body_too_long": return "回覆最多 500 字。";
    case "bad_mime": return "截圖只接受 PNG、JPEG、WebP。";
    case "bad_image": return "這張截圖無法處理，請換一張。";
    case "too_large": return "截圖太大（最多 500 KB）。";
    case "payload_too_large": return "送出的資料太大。";
    case "invalid_status": return "不正確的處理狀態。";
    case "invalid_org_filter": return "大區／牧區／小組的篩選條件不正確，請清除篩選再試。";
    case "invalid_plan_id":
    case "invalid_plan_filter": return "計畫的篩選條件不正確，請清除篩選再試。";
    case "invalid_incomplete":
    case "invalid_offset": return "名單的篩選條件不正確，請重新整理後再試。";
    case "plan_not_found": return "找不到這個計畫（可能已經被刪除），請重新整理。";
    case "scope_not_applicable": return "這個角色不用設定管理範圍（系統管理員、牧者是全教會，其他角色只有本人）。";
    // 和 App 管理分頁同一句（js/modules/admin-managed-scope-options.mjs）
    case "managed_scope_unknown_region": return "有大區名稱不在組織名單中，請重新整理後再選一次。";
    case "managed_scope_unknown_zone": return "有牧區名稱不在組織名單中，請重新整理後再選一次。";
    case "managed_scope_unknown_group": return "有小組名稱不在組織名單中，請重新整理後再選一次。";
    case "invalid_section": return "認不得這個管理區塊，請重新整理後再試。";
    case "invalid_export": return "認不得要下載的檔案，請重新整理後再試。";
    case "invalid_days":
    case "invalid_result":
    case "invalid_source":
    case "invalid_action_filter":
    case "invalid_cursor": return "稽核紀錄的篩選條件不正確，請清除篩選再試。";
    case "invalid_user_id": return "不正確的使用者編號，請重新整理後再試。";
    case "invalid_event_id":
    case "audit_event_not_found": return "找不到這筆稽核紀錄（可能已超過保存期限被清除）。";
    case "admin_api_failed": return "後台服務發生錯誤，請稍後再試。";
    default:
      if (err.status === 400) return `請求格式不正確（${err.code}）。`;
      if (err.status >= 500) return "後台服務發生錯誤，請稍後再試。";
      return `請求失敗（${err.code}）。`;
  }
}
