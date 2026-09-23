// 大測驗寫入憑證：簽發 / 驗證（supabase/functions/_shared）＋ 前端 db.js 的路徑選擇與退回
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { signExamWriteToken, verifyExamWriteToken } from "../supabase/functions/_shared/exam-write-token.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";

describe("exam write token", () => {
  it("verifies only for the same secret, attempt and owner", async () => {
    const tok = await signExamWriteToken("s3cret", A, U);
    expect(tok.startsWith("v1.")).toBe(true);
    expect(await verifyExamWriteToken("s3cret", A, U, tok)).toBe(true);
    expect(await verifyExamWriteToken("other", A, U, tok)).toBe(false);   // 換密鑰
    expect(await verifyExamWriteToken("s3cret", B, U, tok)).toBe(false);  // 別份作答
    expect(await verifyExamWriteToken("s3cret", A, B, tok)).toBe(false);  // 別人
    expect(await verifyExamWriteToken("s3cret", A, U, tok + "x")).toBe(false);
    expect(await verifyExamWriteToken("s3cret", A, U, null)).toBe(false);
    expect(await verifyExamWriteToken("", A, U, tok)).toBe(false);
  });
});

describe("db exam write path", () => {
  let dom, db, rpc, fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    rpc = vi.fn(async () => ({ data: { via: "nlc-data" }, error: null }));
    fetchMock = vi.fn();
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabase: { rpc },
      supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
      currentUser: { id: U }
    });
    await import("../js/db.js?exam-write-path");
    db = dom.window.db || globalThis.db;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  const respond = (status, body) => fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300, status, json: async () => body
  });

  it("uses exam-write when a token is present, without touching nlc-data", async () => {
    respond(200, { data: { saved: true } });
    const res = await db.saveExamProgress(A, { q1: true }, "v1.tok");
    expect(res).toEqual({ success: true, data: { saved: true } });
    expect(rpc).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/functions/v1/exam-write");
    expect(init.headers.Authorization).toBeUndefined();   // 不帶登入 token
    expect(JSON.parse(init.body)).toEqual({ action: "save", attemptId: A, answers: { q1: true }, token: "v1.tok" });
  });

  it("returns business errors from exam-write as-is (no second write through nlc-data)", async () => {
    respond(400, { error: "exam_attempt_locked", code: "P0001" });
    const res = await db.submitExamAttempt(A, {}, "manual", "v1.tok");
    expect(res.success).toBe(false);
    expect(res.error.message).toBe("exam_attempt_locked");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected token", 401],
    ["function not deployed", 404],
    ["server error", 500]
  ])("falls back to nlc-data on %s", async (_label, status) => {
    respond(status, { error: "x" });
    const res = await db.saveExamProgress(A, { q1: true }, "v1.tok");
    expect(res).toEqual({ success: true, data: { via: "nlc-data" } });
    expect(rpc).toHaveBeenCalledWith("exam_save_progress", { p_attempt_id: A, p_answers: { q1: true } });
  });

  it("falls back to nlc-data on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await db.submitExamAttempt(A, { q1: true }, "timeout", "v1.tok");
    expect(res.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("exam_submit_attempt", { p_attempt_id: A, p_answers: { q1: true }, p_reason: "timeout" });
  });

  it("goes straight to nlc-data when there is no token", async () => {
    await db.saveExamProgress(A, { q1: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("flags a thrown 'session is dead' error from the auth layer as authExpired", async () => {
    rpc.mockRejectedValueOnce(new Error("登入狀態已失效，請重新登入。"));
    const res = await db.saveExamProgress(A, { q1: true });
    expect(res.authExpired).toBe(true);
  });
});
