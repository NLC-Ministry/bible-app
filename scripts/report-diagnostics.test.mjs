// 回報診斷資訊與請求 id（#548）：前端收集／遮罩／大小上限、nlc-data 的請求 log 與 metadata 過濾。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ConsoleErrorLog,
  DIAGNOSTICS_MAX_BYTES,
  RequestLog,
  collectRecentErrors,
  collectReportDiagnostics,
  createRequestId,
  describeNlcRequest,
  fetchNlcTracked,
  fitDiagnostics,
  installConsoleErrorCapture,
  readOfflineQueueSummary,
  redactSensitive,
  startNlcRequest
} from "../js/diagnostics/report-diagnostics.mjs";
import {
  REPORT_DIAGNOSTICS_MAX_BYTES,
  buildRequestLogLine,
  requestLogTarget,
  sanitizeReportInsertPayload
} from "../supabase/functions/nlc-data/request-diagnostics.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SERVER_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/; // admin-audit.ts 的 resolveRequestId 只收這種格式
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("request ids", () => {
  it("are accepted by the server's request-id format, with or without crypto.randomUUID", () => {
    expect(createRequestId()).toMatch(SERVER_REQUEST_ID_RE);
    expect(createRequestId(null)).toMatch(SERVER_REQUEST_ID_RE);
    expect(createRequestId(() => { throw new Error("no crypto"); })).toMatch(SERVER_REQUEST_ID_RE);
  });

  it("labels requests by action and table / function, never by filters or payload", () => {
    expect(describeNlcRequest({ table: "reading_logs", filters: [{ column: "user_id", value: "u1" }] })).toBe("select:reading_logs");
    expect(describeNlcRequest({ action: "insert", table: "issue_reports", payload: { description: "x" } })).toBe("insert:issue_reports");
    expect(describeNlcRequest({ action: "rpc", function: "issue_thread_post", args: { body: "secret" } })).toBe("rpc:issue_thread_post");
    expect(describeNlcRequest({ action: "batch", queries: [{}, {}, {}] })).toBe("batch:3");
    expect(describeNlcRequest({ action: "mark_issue_report_reply_seen", report_id: "r1" })).toBe("mark_issue_report_reply_seen");
  });

  it("keeps only the newest requests", () => {
    const log = new RequestLog(3);
    for (let i = 0; i < 5; i += 1) log.record({ requestId: `req-0000${i}`, action: "select:x", status: 200, ms: i, at: 1000 + i });
    expect(log.items.map(item => item.request_id)).toEqual(["req-00002", "req-00003", "req-00004"]);
    expect(log.recent(2).map(item => item.request_id)).toEqual(["req-00003", "req-00004"]);
  });

  it("sends x-request-id and records status, including network failures as 0", async () => {
    const log = new RequestLog();
    const tracked = startNlcRequest({ action: "rpc", function: "fn" }, { log, now: () => 5000 });
    expect(tracked.headers["x-request-id"]).toBe(tracked.requestId);
    expect(tracked.done(403)).toMatchObject({ action: "rpc:fn", status: 403, request_id: tracked.requestId });

    const fetchImpl = vi.fn(async () => ({ status: 201 }));
    await fetchNlcTracked("https://x/functions/v1/nlc-data", { method: "POST", headers: { apikey: "k" } }, { action: "insert", table: "issue_reports" }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.apikey).toBe("k");
    expect(init.headers["x-request-id"]).toMatch(SERVER_REQUEST_ID_RE);

    const failing = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(fetchNlcTracked("https://x", {}, { table: "reading_logs" }, failing)).rejects.toThrow("Failed to fetch");
  });
});

describe("redaction", () => {
  it("masks bearer tokens, JWTs, token query parameters and emails", () => {
    const text = redactSensitive(`Authorization: Bearer abc.def-123 failed for member@example.org token ${JWT} at /cb?code=xyz&state=1#/home?access_token=qq`);
    expect(text).toContain("Bearer [redacted]");
    expect(text).not.toContain("abc.def-123");
    expect(text).not.toContain("eyJ");
    expect(text).not.toContain("member@example.org");
    expect(text).toContain("[email]");
    expect(text).toContain("code=[redacted]");
    expect(text).toContain("access_token=[redacted]");
    expect(text).toContain("state=1");
  });
});

describe("frontend errors", () => {
  it("captures console.error once, keeps logging, and skips the runtime-error echo from index.html", () => {
    const calls = [];
    const target = { error: (...args) => calls.push(args) };
    const log = new ConsoleErrorLog();
    expect(installConsoleErrorCapture(target, log)).toBe(true);
    expect(installConsoleErrorCapture(target, log)).toBe(false);

    target.error("[Repository:reading_logs] load failed", new Error(`token ${JWT}`));
    target.error("[BibleApp Runtime Error]", { message: "already in __bibleRuntimeErrors" });
    expect(calls).toHaveLength(2);
    expect(log.snapshot()).toHaveLength(1);
    expect(log.snapshot()[0].message).toContain("[Repository:reading_logs] load failed");
    expect(log.snapshot()[0].message).not.toContain("eyJ");
  });

  it("merges window errors and console errors, oldest first, at most 10, truncated", () => {
    const runtime = Array.from({ length: 8 }, (_, i) => ({
      kind: "error", message: "x".repeat(1000), stack: "s".repeat(2000), at: `2026-10-11T00:00:0${i}.000Z`
    }));
    const consoleErrors = Array.from({ length: 5 }, (_, i) => ({
      kind: "console.error", message: `c${i}`, stack: "", at: `2026-10-11T00:00:1${i}.000Z`
    }));
    const merged = collectRecentErrors(runtime, consoleErrors);
    expect(merged).toHaveLength(10);
    expect(merged[merged.length - 1].message).toBe("c4");
    expect(merged[0].message.length).toBeLessThanOrEqual(301);
    expect(merged[0].stack.length).toBeLessThanOrEqual(501);
  });
});

describe("offline queue summary", () => {
  it("counts pending / failed and reports the newest lastError, redacted", async () => {
    const store = {
      getAll: async (name) => {
        expect(name).toBe("offline_operations");
        return [
          { status: "pending", updatedAt: "2026-10-11T01:00:00Z", lastError: "old" },
          { status: "failed", updatedAt: "2026-10-11T02:00:00Z", lastError: "HTTP 500 for someone@example.com" },
          { status: "pending" }
        ];
      }
    };
    expect(await readOfflineQueueSummary(store)).toEqual({
      available: true, pending: 2, failed: 1, last_error: "HTTP 500 for [email]"
    });
    expect(await readOfflineQueueSummary(null)).toEqual({ available: false });
    expect(await readOfflineQueueSummary({ getAll: async () => { throw new Error("blocked"); } })).toEqual({ available: false });
  });
});

describe("collectReportDiagnostics", () => {
  const baseEnv = (overrides = {}) => ({
    win: {
      APP_BUILD_ID: "20261011090000",
      currentActivePlanId: "plan-1",
      location: { hash: `#/plan?access_token=${JWT}` },
      matchMedia: () => ({ matches: true }),
      __bibleRuntimeErrors: [{ kind: "unhandledrejection", message: "boom for a@b.co", at: "2026-10-11T00:00:00.000Z" }],
      localStorage: { nlc_access_token: JWT },
      ...overrides.win
    },
    doc: { documentElement: { dataset: { readingDataSource: "cache", readingDataStale: "true", repositoryError: "network" } }, cookie: "sid=secret" },
    nav: { onLine: false },
    now: () => new Date("2026-10-11T03:00:00.000Z"),
    requests: (() => { const log = new RequestLog(); log.record({ requestId: "req-abcdef01", action: "select:reading_logs", status: 503, ms: 12, at: 1 }); return log; })(),
    consoleErrors: new ConsoleErrorLog(),
    offlineStore: { getAll: async () => [{ status: "failed", lastError: "x" }] },
    ...overrides
  });

  it("collects the fields the admin view shows, without tokens, cookies, storage or emails", async () => {
    const diagnostics = await collectReportDiagnostics(baseEnv());
    expect(diagnostics).toMatchObject({
      v: 1,
      build_id: "20261011090000",
      submitted_at: "2026-10-11T03:00:00.000Z",
      standalone: true,
      online: false,
      active_plan_id: "plan-1",
      data_source: { reading_data_source: "cache", reading_data_stale: "true", repository_error: "network" },
      offline_queue: { available: true, pending: 0, failed: 1, last_error: "x" },
      recent_requests: [{ action: "select:reading_logs", status: 503, request_id: "req-abcdef01" }]
    });
    expect(diagnostics.recent_errors[0].message).toBe("boom for [email]");
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("eyJ");
    expect(serialized).not.toContain("sid=secret");
    expect(serialized).not.toContain("nlc_access_token");
    expect(serialized).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("stays under the size cap by dropping the oldest errors first", async () => {
    const consoleErrors = new ConsoleErrorLog();
    for (let i = 0; i < 20; i += 1) consoleErrors.record([`${i}:${"錯".repeat(400)}`], Date.UTC(2026, 9, 11, 0, 0, i));
    const diagnostics = await collectReportDiagnostics(baseEnv({ consoleErrors, win: { __bibleRuntimeErrors: [] } }));
    expect(byteLength(diagnostics)).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES);
    expect(diagnostics.recent_errors.length).toBeLessThan(10);
    expect(diagnostics.recent_errors.at(-1).message.startsWith("19:")).toBe(true);
    expect(diagnostics.recent_requests).toHaveLength(1);

    const tiny = fitDiagnostics({ v: 1, recent_errors: [{ message: "a" }], recent_requests: [{ action: "b" }] }, 20);
    expect(tiny.recent_errors).toEqual([]);
    expect(tiny.recent_requests).toEqual([]);
  });
});

describe("nlc-data request log and report metadata", () => {
  it("logs one JSON line per request with id, action, target, status and duration", () => {
    expect(requestLogTarget({ table: "reading_logs", filters: [{ value: "u1" }] })).toBe("reading_logs");
    expect(requestLogTarget({ action: "rpc", function: "issue_thread_get", args: { id: "x" } })).toBe("issue_thread_get");
    expect(requestLogTarget({ action: "batch", queries: [{}, {}] })).toBe("queries:2");
    expect(requestLogTarget(null)).toBe("");
    expect(JSON.parse(buildRequestLogLine({ requestId: "req-1234abcd", action: "select", target: "reading_logs", status: 200, ms: 12.6 })))
      .toEqual({ event: "nlc_data_request", request_id: "req-1234abcd", action: "select", target: "reading_logs", status: 200, ms: 13 });
  });

  it("keeps only metadata.diagnostics on new reports, and drops oversized ones", () => {
    const row = { category: "bug", description: "d", user_id: "spoof", metadata: { diagnostics: { v: 1 }, reply: "fake admin reply", reply_seen_at: "x" } };
    expect(sanitizeReportInsertPayload([row])).toEqual([{ category: "bug", description: "d", user_id: "spoof", metadata: { diagnostics: { v: 1 } } }]);
    expect(sanitizeReportInsertPayload({ category: "bug", metadata: { reply: "fake" } })).toEqual({ category: "bug" });
    expect(sanitizeReportInsertPayload({ category: "bug", metadata: { diagnostics: [1, 2] } })).toEqual({ category: "bug" });
    const huge = { diagnostics: { blob: "x".repeat(REPORT_DIAGNOSTICS_MAX_BYTES) } };
    expect(sanitizeReportInsertPayload({ category: "bug", metadata: huge })).toEqual({ category: "bug" });
  });

  it("is wired into nlc-data: request id echoed and exposed, log line written, insert payload sanitized", () => {
    const source = read("supabase/functions/nlc-data/index.ts");
    expect(source).toContain('from "./request-diagnostics.ts"');
    expect(source).toContain('"x-request-id": requestId');
    expect(source).toContain('"Access-Control-Expose-Headers": "Content-Length, Server-Timing, x-request-id"');
    expect(source).toContain("console.log(buildRequestLogLine(");
    expect(source).toContain("requestContext.target = requestLogTarget(body);");
    const sanitize = source.indexOf("body.payload = sanitizeReportInsertPayload(body.payload);");
    const insert = source.indexOf('query = supabaseAdmin.from(table).insert(forceUserPayload(');
    expect(sanitize).toBeGreaterThan(0);
    expect(sanitize).toBeLessThan(insert);
    // 瀏覽器要能送 x-request-id（CORS 預檢）
    expect(source).toMatch(/CORS_ALLOW_HEADERS = "[^"]*x-request-id/);
  });
});

describe("frontend wiring", () => {
  it("sends x-request-id on every direct nlc-data call", () => {
    const files = [
      "js/db.js",
      "js/read/read-commentary-client.mjs",
      "components/issue-report/IssueReportBlocks.ts",
      "components/issue-report/AdminReportView.tsx"
    ];
    for (const file of files) {
      const source = read(file);
      const calls = source.split("/functions/v1/nlc-data").length - 1;
      const tracked = source.split("fetchNlcTracked(").length - 1;
      expect({ file, calls }).toEqual({ file, calls: tracked });
    }
  });

  it("installs console.error capture from the main app entry", () => {
    expect(read("js/app.js")).toContain("installConsoleErrorCapture();");
  });

  it("tells members what the report includes", () => {
    expect(read("components/issue-report/ReportDrawer.tsx")).toContain("送出時會一併附上裝置與錯誤資訊，協助我們排查問題。");
  });
});
