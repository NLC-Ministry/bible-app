// 後台回報收件匣（#550 第一組）：admin-api 的 report_* action。
// SQL 的實際行為（分頁、未讀、稽核同交易、刪除留內容、授權只給 service_role）已在 staging 以回滾交易驗過；
// 這裡守住參數、能力、Storage 步驟（上傳失敗要清佔位、簽名網址不外流路徑）與 CSV。
import { describe, expect, it, vi } from "vitest";
import { migrationFiles, readMigration } from "./migration-sql.mjs";
import { ADMIN_ACTIONS, CAPABILITIES } from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest, MAX_BODY_BYTES } from "../supabase/functions/admin-api/handler.ts";
import { csvCell as serverCsvCell, reportsCsv, taipeiDateTime } from "../supabase/functions/admin-api/exports.ts";
import { ISSUE_SHOTS_BUCKET, validateReportImage } from "../supabase/functions/admin-api/reports.ts";
import { csvCell as appCsvCell } from "../js/modules/csv-cell.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_CLIENT = "admin-spa-client";
const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-12345678" };
const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

function setup({ results = {}, storage = {}, role = "admin" } = {}) {
  const calls = [];
  const logs = [];
  const files = { uploaded: [], removed: [] };
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: role, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (fn === "admin_api_record_event") return { data: 1, error: null };
      if (fn in results) return typeof results[fn] === "function" ? results[fn](args) : results[fn];
      return { data: { ok: fn }, error: null };
    }),
    storage: {
      upload: vi.fn(async (bucket, path, bytes, type) => { files.uploaded.push({ bucket, path, size: bytes.length, type }); return { error: null }; }),
      remove: vi.fn(async (bucket, paths) => { files.removed.push({ bucket, paths }); return { error: null }; }),
      signedUrls: vi.fn(async (_bucket, paths) => Object.fromEntries(paths.map((path) => [path, `https://signed.example/${path}?t=1`]))),
      ...storage
    },
    log: (line) => logs.push(JSON.parse(line)),
    randomId: () => "generated-request-id"
  };
  return { deps, calls, logs, files };
}

function post(body, headers = {}) {
  return new Request("https://example.supabase.co/functions/v1/admin-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://bible-speed-reading-admin.vercel.app",
      Authorization: "Bearer token-abc",
      "x-request-id": "req-from-client-1",
      ...headers
    },
    body: JSON.stringify(body)
  });
}
const json = async (response) => ({ status: response.status, body: await response.json() });
const sqlCalls = (calls) => calls.filter((call) => !["admin_api_actor", "admin_api_take_rate_limit", "admin_api_record_event"].includes(call.fn));

describe("report actions: capabilities and parameters", () => {
  it("reading needs support.read, changing needs support.write, export needs export too", () => {
    expect(CAPABILITIES).toContain("support.write");
    for (const name of ["report_list", "report_thread", "report_diagnostics"]) expect(ADMIN_ACTIONS[name].capabilities, name).toEqual(["support.read"]);
    for (const name of ["report_set_status", "report_post", "report_attachment_delete", "report_delete"]) expect(ADMIN_ACTIONS[name].capabilities, name).toEqual(["support.write"]);
    expect(ADMIN_ACTIONS.report_export.capabilities).toEqual(["support.read", "export"]);
  });

  it("builds list arguments with the open filter, unread flag and a uuid cursor", () => {
    const build = ADMIN_ACTIONS.report_list.buildArgs;
    expect(build({}, ctx)).toEqual({ ok: true, args: { p_status: null, p_unread_only: false, p_cursor_at: null, p_cursor_id: null, p_limit: 30 } });
    expect(build({ status: "all" }, ctx).args.p_status).toBeNull();
    expect(build({ status: "open", unread_only: true, cursor: { at: "2026-10-12T01:00:00Z", id: REPORT_ID }, limit: 10 }, ctx)).toEqual({ ok: true, args: {
      p_status: "open", p_unread_only: true, p_cursor_at: "2026-10-12T01:00:00Z", p_cursor_id: REPORT_ID, p_limit: 10
    } });
    expect(build({ status: "closed" }, ctx)).toEqual({ ok: false, error: "invalid_status" });
    expect(build({ cursor: { at: "2026-10-12T01:00:00Z", id: "not-a-uuid" } }, ctx)).toEqual({ ok: false, error: "invalid_cursor" });
  });

  it("records view_report only when the thread is opened, not on the 20-second refresh", () => {
    const build = ADMIN_ACTIONS.report_thread.buildArgs;
    expect(build({ report_id: REPORT_ID, reason: " 會友來電 " }, ctx)).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_report_id: REPORT_ID, p_audit: true, p_reason: "會友來電", p_request_id: "req-12345678"
    } });
    expect(build({ report_id: REPORT_ID, refresh: true }, ctx).args.p_audit).toBe(false);
    expect(build({ report_id: "x" }, ctx)).toEqual({ ok: false, error: "invalid_report_id" });
  });

  it("only allows the four real statuses when changing one", () => {
    const build = ADMIN_ACTIONS.report_set_status.buildArgs;
    for (const status of ["pending", "processing", "resolved", "ignored"]) expect(build({ report_id: REPORT_ID, status }, ctx).ok, status).toBe(true);
    for (const status of ["open", "closed", "", undefined]) expect(build({ report_id: REPORT_ID, status }, ctx), String(status)).toEqual({ ok: false, error: "invalid_status" });
  });

  it("checks reply length, emptiness and the screenshot before touching the database", () => {
    const build = ADMIN_ACTIONS.report_post.buildArgs;
    expect(build({ report_id: REPORT_ID, body: "  好的，已修正  ", is_internal: true }, ctx)).toEqual({ ok: true, args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_report_id: REPORT_ID, p_body: "  好的，已修正  ",
      p_is_internal: true, p_has_attachment: false, p_request_id: "req-12345678"
    } });
    expect(build({ report_id: REPORT_ID, body: "   " }, ctx)).toEqual({ ok: false, error: "empty_message" });
    expect(build({ report_id: REPORT_ID, body: "x".repeat(501) }, ctx)).toEqual({ ok: false, error: "body_too_long" });
    expect(build({ report_id: REPORT_ID, image: { mime: "image/png", base64: PNG_BASE64 } }, ctx).args.p_has_attachment).toBe(true);
    expect(build({ report_id: REPORT_ID, image: { mime: "image/gif", base64: PNG_BASE64 } }, ctx)).toEqual({ ok: false, error: "bad_mime" });
    expect(build({ report_id: REPORT_ID, image: { mime: "image/png", base64: "A".repeat(700_000) } }, ctx)).toEqual({ ok: false, error: "too_large" });
    expect(validateReportImage({ mime: "image/webp", base64: PNG_BASE64, w: 99999, h: 20 })).toEqual({ ok: true, image: { mime: "image/webp", base64: PNG_BASE64, w: null, h: 20 } });
  });
});

describe("report actions through the handler", () => {
  it("signs screenshot URLs for the thread and never returns the storage path", async () => {
    const { deps, files } = setup({ results: { admin_api_report_thread: { data: {
      report: { id: REPORT_ID },
      messages: [
        { id: "m1", body: "看圖", attachment_path: `${REPORT_ID}/m1.webp` },
        { id: "m2", body: "沒有圖", attachment_path: null }
      ]
    }, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "report_thread", params: { report_id: REPORT_ID } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data.messages).toEqual([
      { id: "m1", body: "看圖", has_attachment: true, attachment_url: `https://signed.example/${REPORT_ID}/m1.webp?t=1` },
      { id: "m2", body: "沒有圖", has_attachment: false, attachment_url: null }
    ]);
    expect(JSON.stringify(res.body)).not.toContain("attachment_path");
    expect(deps.storage.signedUrls).toHaveBeenCalledWith(ISSUE_SHOTS_BUCKET, [`${REPORT_ID}/m1.webp`], 300);
    expect(files.uploaded).toEqual([]);
  });

  it("returns report_not_found (404) for a missing report", async () => {
    const { deps } = setup({ results: {
      admin_api_report_thread: { data: null, error: null },
      admin_api_report_set_status: { data: null, error: null }
    } });
    expect(await json(await handleAdminRequest(post({ action: "report_thread", params: { report_id: REPORT_ID } }), deps)))
      .toMatchObject({ status: 404, body: { error: "report_not_found" } });
    expect(await json(await handleAdminRequest(post({ action: "report_set_status", params: { report_id: REPORT_ID, status: "resolved" } }), deps)))
      .toMatchObject({ status: 404, body: { error: "report_not_found" } });
  });

  it("posts a reply with a screenshot: message first (audited in SQL), then upload, then fill in", async () => {
    const { deps, calls, files } = setup({ results: { admin_api_report_post: { data: { id: MESSAGE_ID, report_id: REPORT_ID }, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "report_post", params: {
      report_id: REPORT_ID, body: "請看截圖", image: { mime: "image/png", base64: PNG_BASE64, w: 300, h: 200 }
    } }), deps));
    expect(res).toMatchObject({ status: 200, body: { data: { id: MESSAGE_ID, report_id: REPORT_ID, has_attachment: true } } });
    expect(sqlCalls(calls).map((call) => call.fn)).toEqual(["admin_api_report_post", "admin_api_report_set_attachment"]);
    expect(files.uploaded).toEqual([{ bucket: ISSUE_SHOTS_BUCKET, path: `${REPORT_ID}/${MESSAGE_ID}.png`, size: 14, type: "image/png" }]);
    expect(sqlCalls(calls)[1].args).toEqual({ p_message_id: MESSAGE_ID, p_path: `${REPORT_ID}/${MESSAGE_ID}.png`, p_mime: "image/png", p_bytes: 14, p_w: 300, p_h: 200 });
  });

  it("clears the placeholder (without auditing it) when the upload fails", async () => {
    const { deps, calls, logs } = setup({
      results: { admin_api_report_post: { data: { id: MESSAGE_ID, report_id: REPORT_ID }, error: null } },
      storage: { upload: vi.fn(async () => ({ error: "bucket offline" })) }
    });
    const res = await json(await handleAdminRequest(post({ action: "report_post", params: {
      report_id: REPORT_ID, image: { mime: "image/webp", base64: PNG_BASE64 }
    } }), deps));
    expect(res).toMatchObject({ status: 500, body: { error: "admin_api_failed" } });
    const drop = sqlCalls(calls).find((call) => call.fn === "admin_api_report_drop_attachment");
    expect(drop.args).toMatchObject({ p_message_id: MESSAGE_ID, p_audit: false });
    expect(sqlCalls(calls).map((call) => call.fn)).not.toContain("admin_api_report_set_attachment");
    expect(logs.find((line) => line.event === "admin_api_upload_failed")).toMatchObject({ message_id: MESSAGE_ID });
  });

  it("passes SQL parameter errors (thread_full, empty_message) through as 400", async () => {
    const { deps, files } = setup({ results: { admin_api_report_post: { data: null, error: { code: "22023", message: "thread_full" } } } });
    expect(await json(await handleAdminRequest(post({ action: "report_post", params: { report_id: REPORT_ID, body: "hi" } }), deps)))
      .toMatchObject({ status: 400, body: { error: "thread_full" } });
    expect(files.uploaded).toEqual([]);
  });

  it("deletes the stored screenshots after deleting an attachment or a whole report", async () => {
    const { deps, files } = setup({ results: {
      admin_api_report_drop_attachment: { data: { report_id: REPORT_ID, old_path: `${REPORT_ID}/m1.webp` }, error: null },
      admin_api_report_delete: { data: { id: REPORT_ID, paths: [`${REPORT_ID}/a.webp`, `${REPORT_ID}/b.png`] }, error: null }
    } });
    expect((await handleAdminRequest(post({ action: "report_attachment_delete", params: { message_id: MESSAGE_ID } }), deps)).status).toBe(200);
    expect((await handleAdminRequest(post({ action: "report_delete", params: { report_id: REPORT_ID, reason: "重複" } }), deps)).status).toBe(200);
    expect(files.removed).toEqual([
      { bucket: ISSUE_SHOTS_BUCKET, paths: [`${REPORT_ID}/m1.webp`] },
      { bucket: ISSUE_SHOTS_BUCKET, paths: [`${REPORT_ID}/a.webp`, `${REPORT_ID}/b.png`] }
    ]);
  });

  it("generates the export CSV on the server with formula protection and Taipei times", async () => {
    const { deps, calls } = setup({ results: { admin_api_report_export: { data: { total: 1, truncated: false, rows: [{
      id: REPORT_ID, created_at: "2026-10-12T01:05:00Z", category: "bug", status: "pending", message_count: 3,
      last_message_at: null, description: "=HYPERLINK(\"http://evil\")", url: "/#/plan", reporter_name: "+王小明", reporter_zone: "信義", reporter_group: null
    }] }, error: null } } });
    const res = await json(await handleAdminRequest(post({ action: "report_export", params: { status: "open" } }), deps));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rows: 1, total: 1, truncated: false });
    expect(res.body.data.filename).toMatch(/^回報匯出_\d{4}-\d{2}-\d{2}\.csv$/);
    const [header, line] = res.body.data.csv.split("\r\n");
    expect(header).toBe('"ID","建立時間","分類","處理狀況","訊息數","最後訊息時間","問題描述","頁面網址","回報者姓名","回報者牧區","回報者小組"');
    expect(line).toBe(`"${REPORT_ID}","2026-10-12 09:05","Bug 錯誤","待處理","3","","'=HYPERLINK(""http://evil"")","/#/plan","'+王小明","信義",""`);
    expect(sqlCalls(calls)[0].args).toEqual({ p_actor_id: ADMIN_ID, p_actor_role: "admin", p_status: "open", p_request_id: "req-from-client-1" });
  });

  it("refuses roles without support.write before any change", async () => {
    const { deps, calls } = setup({ role: "member" });
    const res = await handleAdminRequest(post({ action: "report_delete", params: { report_id: REPORT_ID } }), deps);
    expect(res.status).toBe(403);
    expect(sqlCalls(calls)).toEqual([]);
    expect(deps.storage.remove).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before verifying the token", async () => {
    const { deps } = setup();
    const res = await json(await handleAdminRequest(post({ action: "report_list" }, { "content-length": String(MAX_BODY_BYTES + 1) }), deps));
    expect(res).toMatchObject({ status: 413, body: { error: "payload_too_large" } });
    expect(deps.verifyToken).not.toHaveBeenCalled();
  });
});

describe("server CSV cells match the member app's rule (#553)", () => {
  it("escapes the same way for every kind of value", () => {
    for (const value of ["=SUM(A1)", "+1", "-", "-12.5", "50%", "@me", "\tx", "\nline", 'a"b', "王小明", 42, 0, null, undefined, "-a", ".5", "1e5"]) {
      expect(serverCsvCell(value), String(value)).toBe(appCsvCell(value));
    }
  });

  it("writes Taipei local times and blanks for missing ones", () => {
    expect(taipeiDateTime("2026-12-31T16:30:00Z")).toBe("2027-01-01 00:30");
    expect(taipeiDateTime(null)).toBe("");
    expect(taipeiDateTime("not a date")).toBe("");
    expect(reportsCsv([]).split("\r\n")).toHaveLength(1);
  });
});

describe("report migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_reports.sql"));
  const sql = readMigration(file);
  const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)].map((match) => match[1]);
  const body = (name) => sql.slice(sql.indexOf(`FUNCTION public.${name}(`), sql.indexOf(`$${name}$;`));

  it("grants every function to service_role only", () => {
    expect(functions).toHaveLength(9);
    for (const fn of functions) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) TO service_role;`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*authenticated/);
  });

  it("audits every change inside the same function as the change", () => {
    expect(body("admin_api_report_set_status")).toContain("PERFORM audit.record('admin-api', 'report.set_status'");
    expect(body("admin_api_report_post")).toMatch(/PERFORM audit\.record\('admin-api', CASE WHEN COALESCE\(p_is_internal, FALSE\) THEN 'report\.note' ELSE 'report\.reply' END/);
    expect(body("admin_api_report_drop_attachment")).toContain("PERFORM audit.record('admin-api', 'report.attachment_delete'");
    expect(body("admin_api_report_delete")).toContain("PERFORM audit.record('admin-api', 'report.delete'");
    expect(body("admin_api_report_export")).toContain("PERFORM audit.record('admin-api', 'export'");
    expect(body("admin_api_report_thread")).toContain("PERFORM audit.record('admin-api', 'view_report'");
  });

  it("keeps what was deleted in the audit record", () => {
    expect(body("admin_api_report_delete")).toContain("'description', left(v_report.description, 500)");
  });

  it("runs after the audit schema and the first admin-api migration", () => {
    const audit = migrationFiles().find((name) => name.endsWith("_admin_audit_events.sql"));
    const support = migrationFiles().find((name) => name.endsWith("_admin_api_support.sql"));
    expect(audit < file && support < file).toBe(true);
  });
});
