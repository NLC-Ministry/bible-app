// 後台專用 admin-api（#547）：能力表預設拒絕、參數驗證、請求流程（用假的相依跑 handler.ts）、
// SQL 函式只授權 service_role。SQL 的實際行為（分頁不重不漏、遮罩、稽核、限流、索引）已在 staging
// 以回滾交易驗過；這裡守住 migration 內容與 Edge Function 的流程。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { migrationFiles, readMigration } from "./migration-sql.mjs";
import {
  ADMIN_ACTIONS,
  CAPABILITIES,
  ROLE_CAPABILITIES,
  USER_SECTIONS,
  adminAllowOrigin,
  capabilitiesForRole,
  hasCapabilities,
  isAllowedClient,
  parseList,
  validateSearchQuery
} from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";

const migrationFile = migrationFiles().find(file => file.endsWith("_admin_api_support.sql"));
const sql = readMigration(migrationFile);
// admin-api 呼叫的函式分散在 #547 之後的幾支 *_admin_api_*.sql（#550 起每組一支）
const allAdminSql = migrationFiles().filter(file => /_admin_api_/.test(file)).map(readMigration).join("\n");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CLIENT = "admin-spa-client";

describe("capability table (deny by default)", () => {
  it("gives every capability to the system admin and nothing to any other role", () => {
    expect(capabilitiesForRole("admin")).toEqual([...CAPABILITIES]);
    for (const role of ["member", "group_leader", "zone_leader", "great_zone_leader", "pastor", "", null, undefined, "toString", "__proto__"]) {
      expect(capabilitiesForRole(role)).toEqual([]);
    }
    expect(Object.keys(ROLE_CAPABILITIES)).toEqual(["admin"]);
  });

  it("makes every action declare known capabilities, a rate limit and a service_role-only SQL function", () => {
    expect(Object.keys(ADMIN_ACTIONS).sort()).toEqual([
      "audit_event", "audit_export", "audit_list", "bootstrap", "care_remind",
      "directory_export", "directory_list", "legacy_export_audit", "org_export",
      "plan_options", "plan_quiz", "plan_roster", "plan_roster_export", "plan_summary",
      "report_attachment_delete", "report_delete", "report_diagnostics", "report_export", "report_list", "report_post", "report_set_status", "report_thread",
      "reveal_pii", "scope_overview", "scope_set", "user_search", "user_section", "user_summary", "user_timeline"
    ]);
    for (const [name, spec] of Object.entries(ADMIN_ACTIONS)) {
      expect(spec.capabilities.length, name).toBeGreaterThan(0);
      for (const cap of spec.capabilities) expect(CAPABILITIES, name).toContain(cap);
      expect(spec.rateLimit.limit, name).toBeGreaterThan(0);
      expect(spec.rateLimit.windowSeconds, name).toBeGreaterThan(0);
      expect(allAdminSql, name).toContain(`CREATE OR REPLACE FUNCTION public.${spec.rpc}(`);
    }
    expect(ADMIN_ACTIONS.reveal_pii.capabilities).toEqual(["support.pii"]);
    expect(ADMIN_ACTIONS.user_search.rateLimit).toMatchObject({ limit: 60, windowSeconds: 60 });
  });

  it("never treats an empty requirement as allowed", () => {
    expect(hasCapabilities(["support.read"], [])).toBe(false);
    expect(hasCapabilities(["support.read"], ["support.read", "support.pii"])).toBe(false);
    expect(hasCapabilities(["support.read", "support.pii"], ["support.pii"])).toBe(true);
  });
});

describe("parameters", () => {
  it("needs at least one CJK character or two letters/digits to search", () => {
    expect(validateSearchQuery("王")).toEqual({ ok: true, query: "王" });
    expect(validateSearchQuery("  ab ")).toEqual({ ok: true, query: "ab" });
    expect(validateSearchQuery("a")).toEqual({ ok: false, error: "query_too_short" });
    expect(validateSearchQuery("%_")).toEqual({ ok: false, error: "query_too_short" });
    expect(validateSearchQuery(42)).toEqual({ ok: false, error: "query_too_short" });
    expect(validateSearchQuery("x".repeat(101))).toEqual({ ok: false, error: "query_too_long" });
  });

  const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-12345678" };
  it("passes the actor, request id and reason to user_summary / reveal_pii", () => {
    expect(ADMIN_ACTIONS.user_summary.buildArgs({ user_id: USER_ID, reason: " 回報 #12 " }, ctx)).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_user_id: USER_ID, p_reason: "回報 #12", p_request_id: "req-12345678"
    } });
    expect(ADMIN_ACTIONS.reveal_pii.buildArgs({ user_id: "nope" }, ctx)).toEqual({ ok: false, error: "invalid_user_id" });
    expect(ADMIN_ACTIONS.user_summary.buildArgs({ user_id: USER_ID, reason: "x".repeat(201) }, ctx)).toEqual({ ok: false, error: "reason_too_long" });
  });

  it("validates sections, cursors and limits", () => {
    const build = ADMIN_ACTIONS.user_section.buildArgs;
    expect(build({ user_id: USER_ID, section: "reading_logs" }, ctx)).toEqual({ ok: true, args: {
      p_user_id: USER_ID, p_section: "reading_logs", p_cursor_at: null, p_cursor_id: null, p_limit: 20
    } });
    expect(build({ user_id: USER_ID, section: "profiles" }, ctx)).toEqual({ ok: false, error: "invalid_section" });
    expect(build({ user_id: USER_ID, section: "tests", cursor: { at: "2026-10-01T00:00:00Z" } }, ctx)).toEqual({ ok: false, error: "invalid_cursor" });
    expect(build({ user_id: USER_ID, section: "tests", cursor: { at: "yesterday-ish", id: "1" } }, ctx)).toEqual({ ok: false, error: "invalid_cursor" });
    expect(build({ user_id: USER_ID, section: "tests", limit: 51 }, ctx)).toEqual({ ok: false, error: "invalid_limit" });
    expect(ADMIN_ACTIONS.user_timeline.buildArgs({ user_id: USER_ID, cursor: { at: "2026-10-01T00:00:00Z", id: "abc" }, limit: 10 }, ctx)).toEqual({ ok: true, args: {
      p_user_id: USER_ID, p_cursor_at: "2026-10-01T00:00:00Z", p_cursor_id: "abc", p_limit: 10
    } });
    expect([...USER_SECTIONS]).toEqual(["reading_logs", "team_events", "tests", "vouchers", "reports"]);
  });
});

describe("client and origin checks", () => {
  it("only accepts tokens from the configured admin app, and nothing when unconfigured", () => {
    expect(isAllowedClient({ client_id: ADMIN_CLIENT }, [])).toBe(false);
    expect(isAllowedClient({ client_id: ADMIN_CLIENT }, [ADMIN_CLIENT])).toBe(true);
    expect(isAllowedClient({ client_id: "member-app" }, [ADMIN_CLIENT])).toBe(false);
    expect(isAllowedClient({}, [ADMIN_CLIENT])).toBe(false);
    expect(isAllowedClient({ azp: ADMIN_CLIENT }, [ADMIN_CLIENT], "azp")).toBe(true);
    expect(parseList(" a, ,b ")).toEqual(["a", "b"]);
  });

  it("allows only the admin sites (plus opt-in extras and localhost)", () => {
    expect(adminAllowOrigin("https://bible-speed-reading-admin.vercel.app")).toBe("https://bible-speed-reading-admin.vercel.app");
    expect(adminAllowOrigin("https://bible.newlife.org.tw")).toBeNull();
    expect(adminAllowOrigin("https://bible-speed-reading-staging.vercel.app")).toBeNull();
    expect(adminAllowOrigin("http://localhost:5173")).toBeNull();
    expect(adminAllowOrigin("http://localhost:5173", [], true)).toBe("http://localhost:5173");
    expect(adminAllowOrigin("https://x.example", ["https://x.example"])).toBe("https://x.example");
    expect(adminAllowOrigin(null)).toBeNull();
  });
});

// ── 請求流程 ─────────────────────────────────────────────────────────────────
function setup({
  env = {},
  token = { ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } },
  actor = { id: ADMIN_ID, name: "管理員", role_code: "admin", is_active: true },
  rateLimit = { allowed: true, hits: 1, limit: 60, retry_after: 30 },
  results = {}
} = {}) {
  const calls = [];
  const logs = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT, ...env })[key],
    verifyToken: vi.fn(async () => token),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: actor, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: rateLimit, error: null };
      if (fn === "admin_api_record_event") return { data: 1, error: null };
      if (fn in results) return results[fn];
      return { data: { ok: fn }, error: null };
    }),
    log: (line) => logs.push(JSON.parse(line)),
    randomId: () => "generated-request-id"
  };
  return { deps, calls, logs };
}

function post(body, { origin = "https://bible-speed-reading-admin.vercel.app", auth = "Bearer token-abc", requestId = "req-from-client-1" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = auth;
  if (requestId) headers["x-request-id"] = requestId;
  return new Request("https://example.supabase.co/functions/v1/admin-api", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

const json = async (response) => ({ status: response.status, body: await response.json(), headers: response.headers });
const denied = (calls) => calls.filter(call => call.fn === "admin_api_record_event").map(call => call.args);

describe("handleAdminRequest", () => {
  it("answers an admin's search with no-store, CORS and the client's request id", async () => {
    const { deps, calls, logs } = setup({ results: { admin_api_user_search: { data: [{ id: USER_ID }], error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "user_search", params: { q: "王小明" } }), deps));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: USER_ID }], request_id: "req-from-client-1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe("req-from-client-1");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bible-speed-reading-admin.vercel.app");
    expect(calls.map(call => call.fn)).toEqual(["admin_api_actor", "admin_api_take_rate_limit", "admin_api_user_search"]);
    expect(calls[0].args).toEqual({ p_provider_user_id: "logto-sub-1" });
    expect(calls[1].args).toEqual({ p_actor_id: ADMIN_ID, p_bucket: "search", p_limit: 60, p_window_seconds: 60 });
    expect(calls[2].args).toEqual({ p_query: "王小明", p_limit: 20 });
    expect(logs.at(-1)).toMatchObject({ event: "admin_api_request", request_id: "req-from-client-1", action: "user_search", actor_id: ADMIN_ID, status: 200 });
  });

  it("adds the capability list to bootstrap", async () => {
    const { deps } = setup({ results: { admin_api_bootstrap: { data: { me: { id: ADMIN_ID } }, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "bootstrap" }), deps));
    expect(res.body.data).toEqual({ me: { id: ADMIN_ID }, capabilities: [...CAPABILITIES] });
  });

  it("passes the actor, reason and request id to user_summary and returns 404 for unknown users", async () => {
    const { deps, calls } = setup({ results: { admin_api_user_summary: { data: null, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "user_summary", params: { user_id: USER_ID, reason: "回報 #9" } }), deps));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("user_not_found");
    expect(calls.at(-1)).toEqual({ fn: "admin_api_user_summary", args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_user_id: USER_ID, p_reason: "回報 #9", p_request_id: "req-from-client-1"
    } });
  });

  it("generates a request id when the client sends none or a malformed one", async () => {
    const { deps } = setup();
    const res = await handleAdminRequest(post({ action: "bootstrap" }, { requestId: "bad id!" }), deps);
    expect(res.headers.get("x-request-id")).toBe("generated-request-id");
  });

  it("rejects other origins before doing anything", async () => {
    const { deps, calls } = setup();
    const res = await json(await handleAdminRequest(post({ action: "bootstrap" }, { origin: "https://bible.newlife.org.tw" }), deps));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("origin_not_allowed");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(deps.verifyToken).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("answers the CORS preflight for the admin site", async () => {
    const { deps } = setup();
    const req = new Request("https://example.supabase.co/functions/v1/admin-api", {
      method: "OPTIONS", headers: { Origin: "https://bible-speed-reading-admin-staging.vercel.app" }
    });
    const res = await handleAdminRequest(req, deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-request-id");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("requires a token, a configured admin app and a valid signature", async () => {
    let { deps } = setup();
    expect((await json(await handleAdminRequest(post({ action: "bootstrap" }, { auth: null }), deps))).body.error).toBe("missing_authorization");

    ({ deps } = setup({ env: { ADMIN_API_ALLOWED_CLIENT_IDS: "" } }));
    let res = await json(await handleAdminRequest(post({ action: "bootstrap" }), deps));
    expect(res).toMatchObject({ status: 403, body: { error: "admin_client_not_configured" } });
    expect(deps.verifyToken).not.toHaveBeenCalled();

    ({ deps } = setup({ token: { ok: false, reason: "bad_signature" } }));
    res = await json(await handleAdminRequest(post({ action: "bootstrap" }), deps));
    expect(res).toMatchObject({ status: 401, body: { error: "invalid_token" } });

    ({ deps } = setup({ token: { ok: false, reason: "jwks_unavailable" } }));
    res = await json(await handleAdminRequest(post({ action: "bootstrap" }), deps));
    expect(res).toMatchObject({ status: 503, body: { error: "auth_verification_unavailable" } });
  });

  it("refuses member-app tokens and records the attempt", async () => {
    const { deps, calls } = setup({ token: { ok: true, payload: { sub: "logto-sub-1", client_id: "member-app" } } });
    const res = await json(await handleAdminRequest(post({ action: "user_search", params: { q: "王" } }), deps));
    expect(res).toMatchObject({ status: 403, body: { error: "client_not_allowed" } });
    expect(denied(calls)).toEqual([expect.objectContaining({
      p_action: "user_search", p_result: "denied", p_actor_id: ADMIN_ID, p_request_id: "req-from-client-1",
      p_detail: { error: "client_not_allowed", client_id: "member-app" }
    })]);
    expect(calls.map(call => call.fn)).not.toContain("admin_api_user_search");
  });

  it("refuses roles without capabilities, inactive accounts and unknown people", async () => {
    for (const role of ["member", "group_leader", "zone_leader", "great_zone_leader", "pastor"]) {
      const { deps, calls } = setup({ actor: { id: USER_ID, role_code: role, is_active: true } });
      const res = await json(await handleAdminRequest(post({ action: "bootstrap" }), deps));
      expect(res.status, role).toBe(403);
      expect(denied(calls)[0].p_detail, role).toEqual({ error: "no_capabilities" });
      expect(calls.map(call => call.fn), role).not.toContain("admin_api_bootstrap");
    }
    let { deps, calls } = setup({ actor: { id: ADMIN_ID, role_code: "admin", is_active: false } });
    expect((await handleAdminRequest(post({ action: "bootstrap" }), deps)).status).toBe(403);
    expect(denied(calls)[0].p_detail).toEqual({ error: "inactive_account" });

    ({ deps, calls } = setup({ actor: null }));
    expect((await handleAdminRequest(post({ action: "bootstrap" }), deps)).status).toBe(403);
    expect(denied(calls)).toEqual([]);
  });

  it("refuses unknown actions without calling any query", async () => {
    const { deps, calls } = setup();
    const res = await json(await handleAdminRequest(post({ action: "delete_everything" }), deps));
    expect(res).toMatchObject({ status: 400, body: { error: "unknown_action" } });
    expect(calls.map(call => call.fn)).toEqual(["admin_api_actor"]);
  });

  it("returns 429 with Retry-After when the actor is over the limit, and records it", async () => {
    const { deps, calls } = setup({ rateLimit: { allowed: false, hits: 61, limit: 60, retry_after: 17 } });
    const res = await json(await handleAdminRequest(post({ action: "user_search", params: { q: "王" } }), deps));
    expect(res).toMatchObject({ status: 429, body: { error: "rate_limited", retry_after: 17 } });
    expect(res.headers.get("retry-after")).toBe("17");
    expect(denied(calls)[0].p_detail).toEqual({ error: "rate_limited", bucket: "search" });
    expect(calls.map(call => call.fn)).not.toContain("admin_api_user_search");
  });

  it("rejects bad parameters before the query and maps SQL parameter errors to 400", async () => {
    let { deps, calls } = setup();
    let res = await json(await handleAdminRequest(post({ action: "user_search", params: { q: "a" } }), deps));
    expect(res).toMatchObject({ status: 400, body: { error: "query_too_short" } });
    expect(calls.map(call => call.fn)).not.toContain("admin_api_user_search");

    ({ deps } = setup({ results: { admin_api_user_section: { data: null, error: { code: "22023", message: "invalid_cursor" } } } }));
    res = await json(await handleAdminRequest(post({ action: "user_section", params: { user_id: USER_ID, section: "tests" } }), deps));
    expect(res).toMatchObject({ status: 400, body: { error: "invalid_cursor" } });

    ({ deps } = setup());
    res = await json(await handleAdminRequest(post("not json"), deps));
    expect(res).toMatchObject({ status: 400, body: { error: "invalid_body" } });
  });

  it("hides database error details from the caller", async () => {
    const { deps, logs } = setup({ results: { admin_api_user_timeline: { data: null, error: { code: "42P01", message: "relation secret_table does not exist" } } } });
    const res = await json(await handleAdminRequest(post({ action: "user_timeline", params: { user_id: USER_ID } }), deps));
    expect(res).toMatchObject({ status: 500, body: { error: "admin_api_failed" } });
    expect(JSON.stringify(res.body)).not.toContain("secret_table");
    expect(logs.find(line => line.event === "admin_api_error")).toMatchObject({ stage: "admin_api_user_timeline", code: "42P01" });
  });
});

// ── migration ───────────────────────────────────────────────────────────────
describe("admin-api migration", () => {
  const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)].map(match => match[1]);

  it("grants every function to service_role only", () => {
    expect(functions.length).toBeGreaterThanOrEqual(12);
    for (const fn of functions) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) TO service_role;`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*authenticated/);
  });

  it("keeps the rate-limit table away from every API role", () => {
    expect(sql).toContain("ALTER TABLE public.admin_api_rate_limits ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.admin_api_rate_limits FROM PUBLIC, anon, authenticated, service_role;");
  });

  it("records view_user and reveal_pii inside the same function call", () => {
    const summary = sql.slice(sql.indexOf("FUNCTION public.admin_api_user_summary("), sql.indexOf("$admin_api_user_summary$;"));
    expect(summary).toContain("PERFORM audit.record('admin-api', 'view_user', 'ok'");
    const reveal = sql.slice(sql.indexOf("FUNCTION public.admin_api_reveal_pii("), sql.indexOf("$admin_api_reveal_pii$;"));
    expect(reveal).toContain("PERFORM audit.record('admin-api', 'reveal_pii'");
  });

  it("masks other people's email and phone everywhere except reveal_pii", () => {
    // bootstrap 的 me 是管理員自己，不遮；其他人的資料只在 reveal_pii 給完整值
    const others = sql.slice(sql.indexOf("FUNCTION public.admin_api_user_search("), sql.indexOf("FUNCTION public.admin_api_reveal_pii("));
    expect(others).not.toMatch(/'email',/);
    expect(others).not.toMatch(/'phone',/);
    expect(others).toContain("'email_masked', public.admin_api_mask_email(profile.email)");
    expect(others).toContain("'email_masked', public.admin_api_mask_email(identity.email)");
    expect(others).toContain("'phone_masked', public.admin_api_mask_phone(v_profile.phone)");
  });

  it("adds (user_id, time) indexes for opening a person and paging", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_reading_logs_user_read_at ON public.reading_logs (user_id, read_at DESC);");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_issue_reports_user_created ON public.issue_reports (user_id, created_at DESC);");
  });

  it("runs after the audit schema migration it depends on", () => {
    const auditFile = migrationFiles().find(file => file.endsWith("_admin_audit_events.sql"));
    expect(auditFile < migrationFile).toBe(true);
  });
});

describe("deployment config", () => {
  it("lets Logto tokens through the gateway (verify_jwt = false)", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.admin-api\]\nverify_jwt = false/);
  });
});
