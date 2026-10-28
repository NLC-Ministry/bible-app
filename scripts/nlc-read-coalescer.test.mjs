// 同一瞬間的 nlc-data 讀取併成一支 batch（#631）
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  BATCHABLE_RPC_FUNCTIONS,
  createReadCoalescer,
  isCoalescableNlcRead
} from "../js/data/nlc-read-coalescer.mjs";

const edge = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");
const setLiteral = (name) => {
  const match = edge.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : null;
};

// 手動觸發時間窗，讓測試可以決定「同一瞬間」包含哪些請求
function setup({ batch, one, ...options } = {}) {
  let flush = null;
  const sendOne = vi.fn(one || (async (request) => ({ data: `one:${request.table || request.function}`, error: null })));
  const sendBatch = vi.fn(batch || (async (queries) => ({ data: queries.map(q => ({ data: `batch:${q.table || q.function}` })), error: null })));
  const coalescer = createReadCoalescer({ sendOne, sendBatch, schedule: (fn) => { flush = fn; }, ...options });
  return { coalescer, sendOne, sendBatch, flush: () => flush && flush() };
}

const select = (table) => ({ action: "select", table, filters: [] });
const rpc = (fn) => ({ action: "rpc", function: fn, args: {} });

describe("isCoalescableNlcRead", () => {
  it("takes selects and the allowlisted read-only RPCs only", () => {
    expect(isCoalescableNlcRead(select("verse_likes"))).toBe(true);
    expect(isCoalescableNlcRead({ table: "verse_likes", filters: [] })).toBe(true);
    expect(isCoalescableNlcRead(rpc("exam_home_exams"))).toBe(true);
    expect(isCoalescableNlcRead(rpc("start_lightning_quiz_attempt"))).toBe(false);
    expect(isCoalescableNlcRead({ action: "insert", table: "reading_logs" })).toBe(false);
    expect(isCoalescableNlcRead({ action: "batch", queries: [] })).toBe(false);
    expect(isCoalescableNlcRead({ action: "save_profile" })).toBe(false);
  });
});

describe("createReadCoalescer", () => {
  it("sends reads issued together as one batch and hands each caller its own slot, in order", async () => {
    const { coalescer, sendOne, sendBatch, flush } = setup();
    const results = [coalescer.send(select("verse_likes")), coalescer.send(rpc("exam_home_exams")), coalescer.send(select("church_announcements"))];
    flush();
    expect(await Promise.all(results)).toEqual([
      { data: "batch:verse_likes", error: null },
      { data: "batch:exam_home_exams", error: null },
      { data: "batch:church_announcements", error: null }
    ]);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendOne).not.toHaveBeenCalled();
  });

  it("sends a lone read as an ordinary single request", async () => {
    const { coalescer, sendOne, sendBatch, flush } = setup();
    const result = coalescer.send(select("verse_likes"));
    flush();
    expect(await result).toEqual({ data: "one:verse_likes", error: null });
    expect(sendBatch).not.toHaveBeenCalled();
    expect(sendOne).toHaveBeenCalledTimes(1);
  });

  it("never holds back writes or non-allowlisted RPCs", async () => {
    const { coalescer, sendOne, sendBatch } = setup();
    await coalescer.send({ action: "insert", table: "reading_logs", payload: {} });
    await coalescer.send(rpc("start_lightning_quiz_attempt"));
    expect(sendOne).toHaveBeenCalledTimes(2);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("returns a slot's own error in the same shape as a single request's error payload", async () => {
    const { coalescer, flush } = setup({
      batch: async () => ({ data: [{ data: [1] }, { error: "speed_reading_exam_feature_disabled", code: "x1" }], error: null })
    });
    const ok = coalescer.send(select("verse_likes"));
    const failed = coalescer.send(rpc("exam_home_exams"));
    flush();
    expect(await ok).toEqual({ data: [1], error: null });
    expect(await failed).toEqual({ data: null, error: { error: "speed_reading_exam_feature_disabled", code: "x1" } });
  });

  it("re-sends a slot singly when an older server refuses RPCs inside a batch", async () => {
    const { coalescer, sendOne, sendBatch, flush } = setup({
      batch: async () => ({ data: [{ data: "batched" }, { error: "batch_read_only" }], error: null })
    });
    const a = coalescer.send(select("verse_likes"));
    const b = coalescer.send(rpc("exam_home_banner"));
    flush();
    expect(await a).toEqual({ data: "batched", error: null });
    expect(await b).toEqual({ data: "one:exam_home_banner", error: null });
    expect(sendOne).toHaveBeenCalledTimes(1);

    // 之後的 RPC 不再放進 batch（每次都被退、多繞一趟），select 照樣合併
    const c = coalescer.send(rpc("exam_home_exams"));
    expect(await c).toEqual({ data: "one:exam_home_exams", error: null });
    const d = coalescer.send(select("church_announcements"));
    const e = coalescer.send(select("app_feature_settings"));
    flush();
    // 這個假伺服器每批都退第二格，所以第二格的 select 也單支補送
    expect(await Promise.all([d, e])).toEqual([{ data: "batched", error: null }, { data: "one:app_feature_settings", error: null }]);
    expect(sendOne).toHaveBeenCalledTimes(3);
    expect(sendBatch).toHaveBeenCalledTimes(2);
  });

  it("falls back to single requests when the whole batch fails or throws", async () => {
    for (const batch of [
      async () => ({ data: null, error: { error: "internal_error" } }),
      async () => { throw new TypeError("Failed to fetch"); }
    ]) {
      const { coalescer, sendOne, flush } = setup({ batch });
      const results = [coalescer.send(select("verse_likes")), coalescer.send(select("app_feature_settings"))];
      flush();
      expect(await Promise.all(results)).toEqual([
        { data: "one:verse_likes", error: null },
        { data: "one:app_feature_settings", error: null }
      ]);
      expect(sendOne).toHaveBeenCalledTimes(2);
    }
  });

  it("stops batching once the server shows it does not know action:'batch'", async () => {
    const { coalescer, sendOne, sendBatch, flush } = setup({
      batch: async () => ({ data: null, error: { error: "missing_table" } })
    });
    const first = [coalescer.send(select("verse_likes")), coalescer.send(select("app_feature_settings"))];
    flush();
    await Promise.all(first);
    await coalescer.send(select("church_announcements"));
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendOne).toHaveBeenCalledTimes(3);
  });

  it("splits more than 25 reads into several batches", async () => {
    const { coalescer, sendBatch, flush } = setup();
    const results = Array.from({ length: 27 }, (_, i) => coalescer.send(select(`t${i}`)));
    flush();
    const settled = await Promise.all(results);
    expect(settled[26]).toEqual({ data: "batch:t26", error: null });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(sendBatch.mock.calls.map(call => call[0].length)).toEqual([25, 2]);
  });

  it("snapshots the request when it is issued", async () => {
    const { coalescer, sendBatch, flush } = setup();
    const request = select("verse_likes");
    const pending = [coalescer.send(request), coalescer.send(select("app_feature_settings"))];
    request.table = "changed_later";
    flush();
    await Promise.all(pending);
    expect(sendBatch.mock.calls[0][0][0].table).toBe("verse_likes");
  });
});

describe("sharing results of identical reads (#630 redraw)", () => {
  const clock = () => { let t = 1000; return { now: () => t, advance: (ms) => { t += ms; } }; };

  it("shares an in-flight or just-finished identical read instead of sending it again", async () => {
    const time = clock();
    const { coalescer, sendOne, sendBatch, flush } = setup({ now: time.now });
    const first = [coalescer.send(rpc("exam_home_exams")), coalescer.send(select("verse_likes"))];
    // 同一個時間窗內又發一次（首頁兩個區塊要同一份資料）
    const sameWindow = coalescer.send(rpc("exam_home_exams"));
    flush();
    expect(await Promise.all(first)).toEqual([{ data: "batch:exam_home_exams", error: null }, { data: "batch:verse_likes", error: null }]);
    expect(await sameWindow).toEqual({ data: "batch:exam_home_exams", error: null });
    time.advance(2999);
    // 網路資料回來重畫首頁：同樣的讀取直接拿上一次的結果
    expect(await coalescer.send(select("verse_likes"))).toEqual({ data: "batch:verse_likes", error: null });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][0]).toHaveLength(2);
    expect(sendOne).not.toHaveBeenCalled();
  });

  it("fetches again 3 seconds after the read came back", async () => {
    const time = clock();
    const { coalescer, sendOne, flush } = setup({ now: time.now });
    const first = coalescer.send(select("verse_likes"));
    flush();
    await first;
    time.advance(3000);
    const again = coalescer.send(select("verse_likes"));
    flush();
    await again;
    expect(sendOne).toHaveBeenCalledTimes(2);
  });

  it("only shares reads that are exactly the same", async () => {
    const { coalescer, sendOne, flush } = setup();
    const a = coalescer.send({ ...select("verse_likes"), filters: [{ type: "eq", column: "user_id", value: "u1" }] });
    flush();
    await a;
    const b = coalescer.send({ ...select("verse_likes"), filters: [{ type: "eq", column: "user_id", value: "u2" }] });
    flush();
    await b;
    expect(sendOne).toHaveBeenCalledTimes(2);
  });

  it("forgets everything when a write is sent and again when it finishes", async () => {
    let finishWrite;
    const { coalescer, sendOne, flush } = setup({
      one: (request) => request.action === "insert"
        ? new Promise(resolve => { finishWrite = () => resolve({ data: null, error: null }); })
        : Promise.resolve({ data: `one:${request.table}`, error: null })
    });
    const before = coalescer.send(select("reading_logs"));
    flush();
    await before;
    const write = coalescer.send({ action: "insert", table: "reading_logs", payload: {} });
    // 寫入還沒完成時發的讀取：重新抓，但結果不留給寫完之後的人
    const during = coalescer.send(select("reading_logs"));
    flush();
    await during;
    finishWrite();
    await write;
    await Promise.resolve();
    const after = coalescer.send(select("reading_logs"));
    flush();
    await after;
    expect(sendOne.mock.calls.filter(([r]) => r.action === "select")).toHaveLength(3);
  });

  it("treats non-allowlisted RPCs as writes unless their name says get/list", async () => {
    const { coalescer, sendOne, flush } = setup();
    const read = async () => { const p = coalescer.send(select("verse_likes")); flush(); return p; };
    await read();
    await coalescer.send(rpc("get_my_reading_log_digest"));
    await read();
    expect(sendOne.mock.calls.filter(([r]) => r.table === "verse_likes")).toHaveLength(1);
    await coalescer.send(rpc("submit_lightning_quiz_attempt"));
    await read();
    expect(sendOne.mock.calls.filter(([r]) => r.table === "verse_likes")).toHaveLength(2);
  });

  it("can be cleared by writes that bypass the client", async () => {
    const { coalescer, sendOne, flush } = setup();
    const read = async () => { const p = coalescer.send(select("care_reminders")); flush(); return p; };
    await read();
    coalescer.invalidate();
    await read();
    expect(sendOne).toHaveBeenCalledTimes(2);
  });

  it("never shares a failed read", async () => {
    let calls = 0;
    const { coalescer, flush } = setup({ one: async () => (++calls === 1 ? { data: null, error: { error: "timeout" } } : { data: [1], error: null }) });
    const a = coalescer.send(select("verse_likes"));
    flush();
    expect((await a).error).toBeTruthy();
    const b = coalescer.send(select("verse_likes"));
    flush();
    expect(await b).toEqual({ data: [1], error: null });
  });

  it("gives every caller its own copy", async () => {
    const { coalescer, flush } = setup({ one: async () => ({ data: [{ id: 2 }, { id: 1 }], error: null }) });
    const first = coalescer.send(select("verse_likes"));
    flush();
    const mine = await first;
    mine.data.sort((x, y) => x.id - y.id);
    mine.data.push({ id: 3 });
    expect(await coalescer.send(select("verse_likes"))).toEqual({ data: [{ id: 2 }, { id: 1 }], error: null });
  });
});

describe("batchable RPC allowlist stays in step with nlc-data", () => {
  it("matches the Edge Function's BATCH_RPC_FUNCTIONS exactly", () => {
    expect(setLiteral("BATCH_RPC_FUNCTIONS")?.sort()).toEqual([...BATCHABLE_RPC_FUNCTIONS].sort());
  });

  it("contains no admin, audited or write RPC", () => {
    const forbidden = new Set([
      ...(setLiteral("ADMIN_RPC_FUNCTIONS") || []),
      ...(setLiteral("EXAM_ADMIN_RPC_FUNCTIONS") || []),
      ...(setLiteral("ISSUE_ADMIN_RPC_FUNCTIONS") || []),
      ...(setLiteral("PLAN_MANAGEMENT_RPC_FUNCTIONS") || []),
      ...(setLiteral("AUDITED_ADMIN_RPCS") || [])
    ]);
    for (const fn of BATCHABLE_RPC_FUNCTIONS) {
      expect(forbidden.has(fn), fn).toBe(false);
      expect(fn, fn).toMatch(/^(get_|exam_home_)|^issue_thread_unread_summary$/);
    }
  });

  it("routes the data-layer shim's selects and RPCs through the coalescer", () => {
    const db = readFileSync(new URL("../js/db.js", import.meta.url), "utf8");
    expect(db).toContain("return readCoalescer.send(this.request);");
    expect(db).toContain('execute: () => readCoalescer.send({ action: "rpc", function: functionName, args })');
  });

  it("clears shared reads after writes that bypass the coalescer", () => {
    const db = readFileSync(new URL("../js/db.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const saveProfile = db.slice(db.indexOf("      async saveProfile(payload) {"), db.indexOf("      invalidateReads() {"));
    expect(saveProfile.match(/readCoalescer\.invalidate\(\)/g)).toHaveLength(2);
    const examWrite = db.slice(db.indexOf("  async _callExamWrite("), db.indexOf("if (response.ok) return { success: true", db.indexOf("  async _callExamWrite(")));
    expect(examWrite).toContain("state.supabase?.invalidateReads?.();");
    const care = db.slice(db.indexOf('action: "send_care_reminder",'), db.indexOf("if (!response.ok)", db.indexOf('action: "send_care_reminder",')));
    expect(care).toContain("state.supabase?.invalidateReads?.();");
  });
});
