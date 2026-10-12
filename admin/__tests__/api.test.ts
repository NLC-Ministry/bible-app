// admin-api 前端呼叫（#555）：請求格式、60 秒記憶體快取、取消、錯誤轉換。
import { describe, it, expect, vi } from "vitest";
import { AdminApiError, cacheKey, createAdminApi, describeAdminError } from "../src/api.ts";

const URL = "https://example.supabase.co/functions/v1/admin-api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function setup({ token = "tok", respond }: { token?: string | null; respond?: (body: any) => Response } = {}) {
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return respond ? respond(body) : jsonResponse(200, { data: { action: body.action, params: body.params }, request_id: "srv-1" });
  });
  const onUnauthorized = vi.fn();
  const api = createAdminApi({
    url: URL,
    getToken: () => token,
    onUnauthorized,
    fetchImpl,
    now: () => clock,
    newRequestId: () => "adm-test-request"
  });
  return { api, calls, fetchImpl, onUnauthorized, advance: (ms: number) => { clock += ms; } };
}

describe("request format", () => {
  it("POSTs { action, params } with the bearer token and a request id", async () => {
    const { api, calls } = setup();
    await api.call("user_summary", { user_id: "u1", reason: "因回報 #1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer tok", "x-request-id": "adm-test-request" });
    expect(calls[0].body).toEqual({ action: "user_summary", params: { user_id: "u1", reason: "因回報 #1" } });
  });

  it("does not call the API without a token, and asks to sign in again", async () => {
    const { api, calls, onUnauthorized } = setup({ token: null });
    await expect(api.call("bootstrap")).rejects.toMatchObject({ status: 401, code: "session_expired" });
    expect(calls).toHaveLength(0);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("60-second memory cache", () => {
  it("reuses the same person's data within 60 s, then refetches", async () => {
    const { api, calls, advance } = setup();
    await api.call("user_summary", { user_id: "u1", reason: "a" });
    await api.call("user_summary", { user_id: "u1", reason: "b" }); // 換理由不重抓（不再多記一筆查看）
    await api.call("user_section", { user_id: "u1", section: "tests", cursor: { at: "2026-10-01T00:00:00Z", id: "x" }, limit: 20 });
    await api.call("user_section", { limit: 20, cursor: { id: "x", at: "2026-10-01T00:00:00Z" }, section: "tests", user_id: "u1" });
    expect(calls.map((c) => c.body.action)).toEqual(["user_summary", "user_section"]);
    advance(59_000);
    await api.call("user_summary", { user_id: "u1" });
    expect(calls).toHaveLength(2);
    advance(2_000);
    await api.call("user_summary", { user_id: "u1" });
    expect(calls).toHaveLength(3);
  });

  it("peek returns cached data synchronously", async () => {
    const { api } = setup();
    expect(api.peek("user_summary", { user_id: "u1" })).toBeUndefined();
    await api.call("user_summary", { user_id: "u1" });
    expect(api.peek("user_summary", { user_id: "u1", reason: "x" })).toMatchObject({ action: "user_summary" });
  });

  it("never caches bootstrap or reveal_pii", async () => {
    const { api, calls } = setup();
    await api.call("reveal_pii", { user_id: "u1" });
    await api.call("reveal_pii", { user_id: "u1" });
    await api.call("bootstrap");
    await api.call("bootstrap");
    expect(calls).toHaveLength(4);
    expect(api.peek("reveal_pii", { user_id: "u1" })).toBeUndefined();
  });

  it("shares one in-flight request for the same key", async () => {
    const { api, calls } = setup();
    const [a, b] = await Promise.all([api.call("user_timeline", { user_id: "u1" }), api.call("user_timeline", { user_id: "u1" })]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it("fresh: true bypasses the cache", async () => {
    const { api, calls } = setup();
    await api.call("user_summary", { user_id: "u1" });
    await api.call("user_summary", { user_id: "u1" }, { fresh: true });
    expect(calls).toHaveLength(2);
  });

  it("cache keys ignore the view reason and parameter order", () => {
    expect(cacheKey("user_summary", { user_id: "u1", reason: "x" })).toBe(cacheKey("user_summary", { user_id: "u1" }));
    expect(cacheKey("user_section", { a: 1, b: { d: 2, c: 3 } })).toBe(cacheKey("user_section", { b: { c: 3, d: 2 }, a: 1 }));
  });
});

describe("cancellation", () => {
  it("passes the AbortSignal through and rejects with AbortError", async () => {
    const { api, fetchImpl } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(api.call("user_search", { q: "王" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe("errors", () => {
  it("turns error bodies into AdminApiError with the server request id", async () => {
    const { api } = setup({ respond: () => jsonResponse(429, { error: "rate_limited", retry_after: 42, request_id: "srv-9" }, { "Retry-After": "42", "x-request-id": "srv-9" }) });
    const err = await api.call("user_search", { q: "王" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", requestId: "srv-9", retryAfter: 42 });
    expect(describeAdminError(err)).toBe("操作太頻繁，請 42 秒後再試。");
  });

  it("a 401 from the server sends the admin back through SSO", async () => {
    const { api, onUnauthorized } = setup({ respond: () => jsonResponse(401, { error: "invalid_token" }) });
    await expect(api.call("bootstrap")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    let fail = true;
    const { api, calls } = setup({ respond: (body) => (fail ? jsonResponse(500, { error: "admin_api_failed" }) : jsonResponse(200, { data: body.action })) });
    await expect(api.call("user_summary", { user_id: "u1" })).rejects.toMatchObject({ status: 500 });
    fail = false;
    await expect(api.call("user_summary", { user_id: "u1" })).resolves.toBe("user_summary");
    expect(calls).toHaveLength(2);
  });

  it("maps network failures and known codes to Chinese messages", () => {
    expect(describeAdminError(new AdminApiError(0, "network_error", null))).toContain("連不上");
    expect(describeAdminError(new AdminApiError(403, "forbidden", null))).toContain("沒有");
    expect(describeAdminError(new AdminApiError(429, "rate_limited", null, 1800))).toContain("30 分鐘");
    expect(describeAdminError(new AdminApiError(404, "user_not_found", null))).toBe("找不到這位使用者。");
    expect(describeAdminError(new Error("boom"))).toContain("未預期");
  });
});
