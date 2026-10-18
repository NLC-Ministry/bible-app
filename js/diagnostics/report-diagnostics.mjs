// 回報診斷資訊（#548）：每個 nlc-data 請求帶 x-request-id，並把最近的請求、
// 前端錯誤與裝置狀態在送出回報時打包進 issue_reports.metadata.diagnostics。
// 不收 token、cookie、localStorage；錯誤訊息先遮掉疑似 token 與 email。

export const DIAGNOSTICS_VERSION = 1;
export const DIAGNOSTICS_MAX_BYTES = 8 * 1024;
const REQUEST_CAPACITY = 20;
const CONSOLE_ERROR_CAPACITY = 20;
const REPORTED_REQUESTS = 5;
const REPORTED_ERRORS = 10;
const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_CHARS = 500;
const MAX_ROUTE_CHARS = 200;
// index.html 的 installRuntimeErrorDiagnostics 已把 window error／unhandledrejection
// 收進 window.__bibleRuntimeErrors，再印成這個前綴的 console.error；這裡不重複收。
const RUNTIME_ERROR_PREFIX = "[BibleApp Runtime Error]";

export function createRequestId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof randomUUID === "function") {
    try { return randomUUID(); } catch (_e) { /* fall through */ }
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function redactSensitive(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_\-.]{6,}/g, "[token]")
    .replace(/\b(access_token|id_token|refresh_token|token|code|apikey|api_key)=[^&#\s"']+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

function clip(value, max) {
  const text = redactSensitive(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Label for one nlc-data request body: select:reading_logs, rpc:fn, batch:3, mark_issue_report_reply_seen… */
export function describeNlcRequest(request = {}) {
  const action = typeof request.action === "string" && request.action ? request.action : "select";
  if (action === "batch") return `batch:${Array.isArray(request.queries) ? request.queries.length : "?"}`;
  if (action === "rpc") return `rpc:${typeof request.function === "string" ? request.function : "unknown"}`;
  if (typeof request.table === "string" && request.table) return `${action}:${request.table}`;
  return action;
}

export class RequestLog {
  constructor(capacity = REQUEST_CAPACITY) {
    this.capacity = Math.max(1, Number(capacity) || REQUEST_CAPACITY);
    this.items = [];
  }

  record({ requestId, action, status, ms, at } = {}) {
    const entry = {
      at: new Date(Number(at) || Date.now()).toISOString(),
      action: String(action || "unknown").slice(0, 80),
      status: Number(status) || 0,
      ms: Math.max(0, Math.round(Number(ms) || 0)),
      request_id: String(requestId || "").slice(0, 100)
    };
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return entry;
  }

  recent(count = REPORTED_REQUESTS) {
    return this.items.slice(-count);
  }
}

export const requestLog = new RequestLog();

/** Headers + bookkeeping for one nlc-data call; call done(status) when the response (or failure) is known. */
export function startNlcRequest(request, { log = requestLog, now = () => Date.now() } = {}) {
  const requestId = createRequestId();
  const startedAt = now();
  return {
    requestId,
    headers: { "x-request-id": requestId },
    done(status) {
      return log.record({ requestId, action: describeNlcRequest(request), status, ms: now() - startedAt, at: startedAt });
    }
  };
}

/** fetch() one nlc-data call with an x-request-id header and record it in the request log. */
export async function fetchNlcTracked(url, init = {}, request = {}, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const tracked = startNlcRequest(request);
  let response;
  try {
    response = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...tracked.headers } });
  } catch (error) {
    tracked.done(0);
    throw error;
  }
  tracked.done(response.status);
  return response;
}

function describeConsoleArg(arg) {
  if (arg instanceof Error) return arg.message || String(arg);
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    if (typeof arg.message === "string") return arg.message;
    try { return JSON.stringify(arg); } catch (_e) { return Object.prototype.toString.call(arg); }
  }
  return String(arg);
}

export class ConsoleErrorLog {
  constructor(capacity = CONSOLE_ERROR_CAPACITY) {
    this.capacity = Math.max(1, Number(capacity) || CONSOLE_ERROR_CAPACITY);
    this.items = [];
  }

  record(args, at = Date.now()) {
    if (!Array.isArray(args) || args.length === 0) return null;
    if (typeof args[0] === "string" && args[0].startsWith(RUNTIME_ERROR_PREFIX)) return null;
    const firstError = args.find(arg => arg instanceof Error);
    const entry = {
      kind: "console.error",
      message: clip(args.map(describeConsoleArg).join(" "), MAX_MESSAGE_CHARS),
      stack: firstError?.stack ? clip(String(firstError.stack).split("\n").slice(0, 4).join("\n"), MAX_STACK_CHARS) : "",
      at: new Date(at).toISOString()
    };
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return entry;
  }

  snapshot() {
    return this.items.slice();
  }
}

export const consoleErrorLog = new ConsoleErrorLog();

/** Wrap console.error once so its calls also land in consoleErrorLog. Returns false if already installed. */
export function installConsoleErrorCapture(target = globalThis.console, log = consoleErrorLog) {
  if (!target || typeof target.error !== "function" || target.error.__reportDiagnostics) return false;
  const original = target.error;
  let capturing = false;
  const wrapped = function (...args) {
    if (!capturing) {
      capturing = true;
      try { log.record(args); } catch (_e) { /* never let diagnostics break logging */ }
      finally { capturing = false; }
    }
    return original.apply(this, args);
  };
  wrapped.__reportDiagnostics = true;
  target.error = wrapped;
  return true;
}

function normalizeRuntimeError(entry = {}) {
  return {
    kind: String(entry.kind || "error").slice(0, 40),
    message: clip(entry.message || "Unknown runtime error", MAX_MESSAGE_CHARS),
    stack: entry.stack ? clip(entry.stack, MAX_STACK_CHARS) : "",
    at: typeof entry.at === "string" ? entry.at : ""
  };
}

/** Latest frontend errors from window error/unhandledrejection and console.error, oldest first. */
export function collectRecentErrors(runtimeErrors = [], consoleErrors = [], limit = REPORTED_ERRORS) {
  const merged = [
    ...(Array.isArray(runtimeErrors) ? runtimeErrors : []).map(normalizeRuntimeError),
    ...(Array.isArray(consoleErrors) ? consoleErrors : [])
  ];
  merged.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return merged.slice(-limit);
}

/** pending/failed counts and the newest lastError from the PWA offline_operations store. */
export async function readOfflineQueueSummary(store) {
  if (!store || typeof store.getAll !== "function") return { available: false };
  try {
    const records = await store.getAll("offline_operations");
    const list = Array.isArray(records) ? records : [];
    const withError = list
      .filter(item => item && item.lastError)
      .sort((a, b) => String(a.updatedAt || a.createdAt || "").localeCompare(String(b.updatedAt || b.createdAt || "")));
    const latest = withError[withError.length - 1];
    return {
      available: true,
      pending: list.filter(item => item?.status === "pending").length,
      failed: list.filter(item => item?.status === "failed").length,
      last_error: latest ? clip(latest.lastError, MAX_MESSAGE_CHARS) : null
    };
  } catch (_e) {
    return { available: false };
  }
}

function byteLength(value) {
  const text = JSON.stringify(value);
  return typeof TextEncoder === "function" ? new TextEncoder().encode(text).byteLength : text.length * 3;
}

/** Keep the payload under maxBytes: drop the oldest errors first, then the oldest requests. */
export function fitDiagnostics(diagnostics, maxBytes = DIAGNOSTICS_MAX_BYTES) {
  const result = {
    ...diagnostics,
    recent_errors: [...(diagnostics.recent_errors || [])],
    recent_requests: [...(diagnostics.recent_requests || [])]
  };
  while (byteLength(result) > maxBytes && result.recent_errors.length > 0) result.recent_errors.shift();
  while (byteLength(result) > maxBytes && result.recent_requests.length > 0) result.recent_requests.shift();
  return result;
}

function isStandalone(win, nav) {
  try {
    if (win?.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  } catch (_e) { /* ignore */ }
  return nav?.standalone === true;
}

/** Snapshot sent with an issue report as metadata.diagnostics. */
export async function collectReportDiagnostics({
  win = globalThis.window,
  doc = globalThis.document,
  nav = globalThis.navigator,
  now = () => new Date(),
  requests = requestLog,
  consoleErrors = consoleErrorLog,
  offlineStore = win?.pwaDataStore
} = {}) {
  const dataset = doc?.documentElement?.dataset || {};
  const activePlan = win?.state?.activePlan;
  const activePlanId = win?.currentActivePlanId ?? activePlan?.id ?? null;
  const diagnostics = {
    v: DIAGNOSTICS_VERSION,
    build_id: win?.APP_BUILD_ID || null,
    submitted_at: now().toISOString(),
    standalone: isStandalone(win, nav),
    online: nav ? nav.onLine !== false : null,
    route: clip(win?.location?.hash || "", MAX_ROUTE_CHARS),
    active_plan_id: activePlanId ? String(activePlanId).slice(0, 100) : null,
    data_source: {
      reading_data_source: dataset.readingDataSource || null,
      reading_data_stale: dataset.readingDataStale || null,
      repository_error: dataset.repositoryError || null
    },
    offline_queue: await readOfflineQueueSummary(offlineStore),
    recent_requests: requests.recent(REPORTED_REQUESTS),
    recent_errors: collectRecentErrors(win?.__bibleRuntimeErrors, consoleErrors.snapshot(), REPORTED_ERRORS)
  };
  return fitDiagnostics(diagnostics);
}
