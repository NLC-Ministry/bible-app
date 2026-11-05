// #674：Edge Function 快取本身，以及 exam-write 暫存路徑實際發出的查詢。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFeatureFlagCache,
  createOrgPruneGate,
  createRequestCache,
  createTtlCache
} from "../supabase/functions/_shared/edge-cache.mjs";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__examWriteFakeDb.client()
}));

describe("createRequestCache", () => {
  it("並行呼叫共用同一個結果，只載入一次", async () => {
    const cache = createRequestCache();
    const load = vi.fn(async () => ["a"]);
    const [first, second] = await Promise.all([cache.once("k", load), cache.once("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("每個請求各一份，不同請求互不相通", async () => {
    const [a, b] = [createRequestCache(), createRequestCache()];
    expect(await a.once("k", async () => "A")).toBe("A");
    expect(await b.once("k", async () => "B")).toBe("B");
  });

  it("失敗也共用：同一個請求不重試，每個呼叫都收到同樣的錯", async () => {
    const cache = createRequestCache();
    const load = vi.fn(async () => { throw new Error("boom"); });
    await expect(cache.once("k", load)).rejects.toThrow("boom");
    await expect(cache.once("k", load)).rejects.toThrow("boom");
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("createTtlCache", () => {
  it("到期就拿不到，剛好到期也算過期", () => {
    let at = 1000;
    const cache = createTtlCache({ ttlMs: 100, now: () => at });
    cache.set("k", "v");
    at = 1099;
    expect(cache.get("k")).toBe("v");
    at = 1100;
    expect(cache.get("k")).toBeUndefined();
  });

  it("寫入時清掉過期項目，舊項目不會永遠留著（原本的 Map 只增不減）", () => {
    let at = 0;
    const cache = createTtlCache({ ttlMs: 100, now: () => at });
    cache.set("a", 1);
    cache.set("b", 2);
    at = 150;
    cache.set("c", 3);
    expect(cache.size).toBe(1);
  });

  it("重寫同一個鍵會重新計時，也不會擋住後面的過期清理", () => {
    let at = 0;
    const cache = createTtlCache({ ttlMs: 100, now: () => at });
    cache.set("a", 1);
    cache.set("b", 2);
    at = 90;
    cache.set("a", 3);
    at = 150;
    cache.set("c", 4);
    expect(cache.get("a")).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("有上限：超過就丟最舊的", () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });
});

describe("createFeatureFlagCache", () => {
  const clientOf = (rows) => {
    const client = {
      reads: 0,
      from: () => ({
        select: async () => {
          client.reads += 1;
          return typeof rows === "function" ? rows() : { data: rows, error: null };
        }
      })
    };
    return client;
  };

  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("並行只讀一次；只有 enabled === true 才算開", async () => {
    const client = clientOf([{ key: "a", enabled: true }, { key: "b", enabled: false }, { key: "c", enabled: "true" }]);
    const cache = createFeatureFlagCache({ ttlMs: 100 });
    const [flags] = await Promise.all([cache.snapshot(client), cache.snapshot(client)]);
    expect(client.reads).toBe(1);
    expect(flags.get("a")).toBe(true);
    expect(flags.get("b")).toBe(false);
    expect(flags.get("c")).toBe(false);
    expect(flags.get("missing") === true).toBe(false);
  });

  it("clear() 時正在讀的舊結果不會存進快取", async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    let enabled = true;
    const client = clientOf(() => {
      const row = [{ key: "a", enabled }];
      return client.reads === 1 ? pending.then(() => ({ data: row, error: null })) : { data: row, error: null };
    });
    const cache = createFeatureFlagCache({ ttlMs: 100 });
    const stale = cache.snapshot(client);
    enabled = false;
    cache.clear();
    finish();
    await stale;
    expect((await cache.snapshot(client)).get("a")).toBe(false);
    expect(client.reads).toBe(2);
  });
});

describe("createOrgPruneGate", () => {
  it("沒抽中不跑，也不算進間隔", () => {
    let at = 0;
    let roll = 0.5;
    const gate = createOrgPruneGate({ minIntervalMs: 100, probability: 0.05, now: () => at, random: () => roll });
    expect(gate.allow()).toBe(false);
    roll = 0;
    expect(gate.allow()).toBe(true);
    expect(gate.allow()).toBe(false);
    at = 100;
    expect(gate.allow()).toBe(true);
  });
});

describe("exam-write 暫存路徑（#674）", () => {
  const ATTEMPT = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";
  const SECRET = "exam-secret";
  let handler;
  let db;

  async function signToken() {
    const bytes = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      new TextEncoder().encode(`exam-write:v1:${ATTEMPT}:${USER}`)
    ));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return "v1." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function makeDb(flags) {
    const state = {
      flags,
      flagError: false,
      calls: [],
      rpcs: [],
      beforeAttempt: null,
      client: () => ({
        from: (table) => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            maybeSingle: () => builder,
            then: (resolve, reject) => (async () => {
              state.calls.push(table);
              if (table === "exam_attempts") {
                if (state.beforeAttempt) await state.beforeAttempt();
                return { data: { id: ATTEMPT, user_id: USER }, error: null };
              }
              if (state.flagError) return { data: null, error: { message: "boom" } };
              return { data: Object.entries(state.flags).map(([key, enabled]) => ({ key, enabled })), error: null };
            })().then(resolve, reject)
          };
          return builder;
        },
        rpc: async (fn, args) => {
          state.rpcs.push({ fn, args });
          return { data: { ok: true }, error: null };
        }
      })
    };
    return state;
  }

  const save = async (token) => {
    globalThis.__examWriteFakeDb = db;
    const response = await handler(new Request("https://edge.test/exam-write", {
      method: "POST",
      body: JSON.stringify({ action: "save", attemptId: ATTEMPT, token, answers: { q1: "a" } })
    }));
    return { status: response.status, body: await response.json() };
  };

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    vi.resetModules();
    vi.stubGlobal("Deno", {
      env: { get: (key) => ({ SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service-role", EXAM_WRITE_SECRET: SECRET })[key] },
      serve: (fn) => { handler = fn; }
    });
    await import("../supabase/functions/exam-write/index.ts");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete globalThis.__examWriteFakeDb;
  });

  it("連續暫存只讀一次開關，RPC 的 actor 固定是 attempt 主人", async () => {
    db = makeDb({ speed_reading_exam: true });
    const token = await signToken();
    expect((await save(token)).status).toBe(200);
    expect((await save(token)).status).toBe(200);
    expect(db.calls.filter((table) => table === "app_feature_settings")).toHaveLength(1);
    expect(db.rpcs).toHaveLength(2);
    expect(db.rpcs[0].args.p_actor_id).toBe(USER);
  });

  it("查 attempt 和讀開關同時開始", async () => {
    db = makeDb({ speed_reading_exam: true });
    db.beforeAttempt = () => vi.waitFor(() => expect(db.calls).toContain("app_feature_settings"));
    expect((await save(await signToken())).status).toBe(200);
  });

  it("憑證不符永遠先回 401，就算開關是關的", async () => {
    db = makeDb({ speed_reading_exam: false });
    const { status, body } = await save("v1.wrong");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_exam_write_token");
    expect(db.rpcs).toEqual([]);
  });

  it("開關關閉：不能寫入；後台關掉後 30 秒內一定生效", async () => {
    db = makeDb({ speed_reading_exam: true });
    const token = await signToken();
    expect((await save(token)).status).toBe(200);
    db.flags.speed_reading_exam = false;
    vi.setSystemTime(Date.now() + 29_000);
    expect((await save(token)).status).toBe(200);
    vi.setSystemTime(Date.now() + 2_000);
    const closed = await save(token);
    expect(closed.status).toBe(403);
    expect(closed.body.error).toBe("speed_reading_exam_feature_disabled");
    expect(db.rpcs).toHaveLength(2);
  });

  it("開關讀取失敗：這次擋下（fail closed），下次重讀", async () => {
    db = makeDb({ speed_reading_exam: true });
    db.flagError = true;
    const token = await signToken();
    expect((await save(token)).status).toBe(403);
    db.flagError = false;
    expect((await save(token)).status).toBe(200);
  });
});
