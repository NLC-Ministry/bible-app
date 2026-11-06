// #683：每日 Email 摘要。實際跑 issue-report-maintenance 的 handler（假的資料庫與 Apps Script），
// 斷言有沒有寄、寄了什麼，以及摘要這條路不會順便跑自動結案。信裡只能有數字和連結。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDigestEmail, shouldSendDigest } from "../supabase/functions/issue-report-maintenance/digest.ts";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__digestFakeClient
}));

const SECRET = "maintenance-secret";
const HOOK = "https://script.test/exec";
const HOOK_SECRET = "digest-secret";
const COUNTS = { new_24h: 2, pending: 3, processing: 1, unread: 1, oldest_pending_at: "2026-11-01T00:00:00Z" };
const EMPTY = { new_24h: 0, pending: 0, processing: 2, unread: 0, oldest_pending_at: null };

describe("buildDigestEmail", () => {
  const now = new Date("2026-11-06T00:00:00Z");

  it("只有數字和後台連結", () => {
    const mail = buildDigestEmail(COUNTS, now, "https://admin.test/#/support");
    expect(mail.subject).toBe("回報摘要：待回覆 3 則");
    expect(mail.text).toContain("過去 24 小時新回報：2 則");
    expect(mail.text).toContain("待回覆：3 則（最久已等 5 天）");
    expect(mail.text).toContain("有新訊息：1 則");
    expect(mail.text).toContain("等開發：1 則");
    expect(mail.text).toContain("https://admin.test/#/support");
  });

  it("沒有待回覆時不寫等待時間", () => {
    const mail = buildDigestEmail({ ...COUNTS, pending: 0, oldest_pending_at: null }, now, "https://admin.test/");
    expect(mail.subject).toBe("回報摘要：有新訊息 1 則");
    expect(mail.text).toContain("待回覆：0 則\n");
  });

  it("多的欄位不會寫進信裡", () => {
    const mail = buildDigestEmail({ ...COUNTS, name: "王小明", description: "看不到進度" }, now, "https://admin.test/");
    expect(mail.text).not.toContain("王小明");
    expect(mail.text).not.toContain("看不到進度");
  });
});

describe("shouldSendDigest", () => {
  it("有待回覆或新訊息才寄；只有等開發不寄", () => {
    expect(shouldSendDigest(COUNTS)).toBe(true);
    expect(shouldSendDigest({ ...EMPTY, unread: 1 })).toBe(true);
    expect(shouldSendDigest(EMPTY)).toBe(false);
  });
});

describe("issue-report-maintenance handler", () => {
  let handler;
  let env;
  const rpcCalls = [];
  let digestResult;
  const fetchMock = vi.fn();

  const call = async (body) => {
    const response = await handler(new Request("https://fn.test/issue-report-maintenance", {
      method: "POST",
      headers: { "x-maintenance-secret": SECRET, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }));
    return { status: response.status, json: await response.json() };
  };

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.__digestFakeClient = {
      rpc: async (name) => {
        rpcCalls.push(name);
        if (name === "issue_report_digest_counts") return digestResult;
        return { data: 0, error: null };
      }
    };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", {
      env: { get: (name) => env[name] },
      serve: (fn) => { handler = fn; }
    });
    await import("../supabase/functions/issue-report-maintenance/index.ts");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.__digestFakeClient;
  });

  beforeEach(() => {
    rpcCalls.length = 0;
    fetchMock.mockReset();
    digestResult = { data: COUNTS, error: null };
    env = {
      ISSUE_REPORT_MAINTENANCE_SECRET: SECRET,
      SUPABASE_URL: "https://db.test",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      ISSUE_REPORT_DIGEST_WEBHOOK_URL: HOOK,
      ISSUE_REPORT_DIGEST_WEBHOOK_SECRET: HOOK_SECRET,
      ISSUE_REPORT_DIGEST_ADMIN_URL: "https://admin.test/#/support"
    };
  });

  it("摘要送到 Apps Script，帶共用密鑰，而且不跑自動結案", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const res = await call({ digest: true });
    expect(res).toEqual({ status: 200, json: { ok: true, digest: "sent" } });
    expect(rpcCalls).toEqual(["issue_report_digest_counts"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(HOOK);
    const sent = JSON.parse(init.body);
    expect(sent.secret).toBe(HOOK_SECRET);
    expect(sent.subject).toBe("回報摘要：待回覆 3 則");
    expect(sent.text).toContain("https://admin.test/#/support");
  });

  it("沒有要處理的就不寄", async () => {
    digestResult = { data: EMPTY, error: null };
    const res = await call({ digest: true });
    expect(res.json).toEqual({ ok: true, digest: "nothing_to_send" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("沒設定寄信網址時不寄也不算失敗（staging 預設）", async () => {
    delete env.ISSUE_REPORT_DIGEST_WEBHOOK_URL;
    const res = await call({ digest: true });
    expect(res).toEqual({ status: 200, json: { ok: true, digest: "not_configured" } });
    expect(rpcCalls).toEqual([]);
  });

  it("Apps Script 回錯誤要算失敗，排程紀錄才查得到", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" })));
    const res = await call({ digest: true });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe("digest_send_failed");
    expect(JSON.stringify(res.json)).not.toContain(HOOK_SECRET);
  });

  it("連不上 Apps Script 也算失敗；讀不到數字回 500", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect((await call({ digest: true })).status).toBe(502);
    digestResult = { data: null, error: { message: "boom" } };
    expect((await call({ digest: true })).status).toBe(500);
  });

  it("一般排程照舊跑自動結案，不寄摘要", async () => {
    const res = await call({});
    expect(res.json).toEqual({ ok: true, autoclosed: 0 });
    expect(rpcCalls).toEqual(["issue_threads_autoclose"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("沒有維護密鑰就擋下", async () => {
    const response = await handler(new Request("https://fn.test/x", { method: "POST", body: JSON.stringify({ digest: true }) }));
    expect(response.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });
});
