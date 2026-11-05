// #664：實際跑 recover-plan 的 handler（真的 ES384 金鑰簽 token、假的資料庫），
// 斷言回應與傳給 RPC 的內容，不比對原始碼字串。合併條件本身在 scripts/db-behavior.test.mjs 實際跑 SQL。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ISSUER = "https://sso.test/oidc";
const CLIENT = "member-app";
const PLATFORM = "https://platform.test";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    rpc: async (name, args) => {
      const state = globalThis.__recoverPlan;
      state.rpc.push({ name, args });
      if (state.rpcThrows) throw state.rpcThrows;
      return state.rpcResult ?? { data: { ok: true }, error: null };
    }
  })
}));
vi.mock("https://esm.sh/jose@5.9.6", async () => {
  const real = await vi.importActual("jose");
  return {
    ...real,
    createRemoteJWKSet: () => async (...args) => {
      if (globalThis.__recoverPlan.jwksDown) throw new TypeError("error sending request for url");
      return globalThis.__recoverPlan.jwks(...args);
    }
  };
});

import * as jose from "jose";

let handler;
let keys;
let otherKeys;
let logs;
const spies = [];
const env = {
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  NLC_LOGTO_ISSUER: ISSUER,
  RECOVER_PLAN_ALLOWED_CLIENT_IDS: CLIENT
};

const sign = (claims, { key = keys.privateKey, exp = "10m", issuer = ISSUER } = {}) =>
  new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "ES384", kid: "k1" })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
const access = (sub, overrides = {}, options) => sign({ sub, client_id: CLIENT, aud: PLATFORM, ...overrides }, options);
const AUTH_TIME = 1_800_000_000;
const idToken = (sub, nonce = "server-nonce", overrides = {}, options) => sign({ sub, aud: CLIENT, nonce, auth_time: AUTH_TIME, ...overrides }, options);
const forge = (claims) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "ES384", kid: "k1" })}.${enc({ iss: ISSUER, exp: 9999999999, client_id: CLIENT, aud: CLIENT, ...claims })}.${Buffer.from("x").toString("base64url")}`;
};

const post = async (body, { origin = "https://bible-speed-reading-staging.vercel.app", method = "POST" } = {}) => {
  const response = await handler(new Request("https://edge.test/recover-plan", {
    method,
    headers: origin ? { origin, "content-type": "application/json" } : { "content-type": "application/json" },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
  }));
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
};
const complete = async (overrides = {}) => post({
  action: "complete",
  source_token: await access("sub-new"),
  target_access_token: await access("sub-old"),
  target_id_token: await idToken("sub-old"),
  ...overrides
});
const sha256 = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

beforeAll(async () => {
  keys = await jose.generateKeyPair("ES384");
  otherKeys = await jose.generateKeyPair("ES384");
  const pub = await jose.exportJWK(keys.publicKey);
  globalThis.__recoverPlan = { jwks: jose.createLocalJWKSet({ keys: [{ ...pub, kid: "k1", alg: "ES384", use: "sig" }] }), rpc: [] };
  logs = [];
  for (const level of ["log", "info", "warn", "error"]) {
    spies.push(vi.spyOn(console, level).mockImplementation((...args) => logs.push(args.join(" "))));
  }
  vi.stubGlobal("Deno", { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } });
  await import("../supabase/functions/recover-plan/index.ts");
});

afterAll(() => {
  spies.forEach((spy) => spy.mockRestore());
  vi.unstubAllGlobals();
  delete globalThis.__recoverPlan;
});

beforeEach(() => {
  Object.assign(globalThis.__recoverPlan, { rpc: [], rpcResult: null, rpcThrows: null, jwksDown: false });
  env.RECOVER_PLAN_ALLOWED_CLIENT_IDS = CLIENT;
  delete env.NLC_JWT_VERIFY_MODE;
  delete env.NLC_LOGTO_AUDIENCE;
  logs.length = 0;
});

describe("recover-plan：start", () => {
  it("驗過 token 後發一次性 nonce，DB 只收雜湊和 sub", async () => {
    const res = await post({ action: "start", source_token: await access("sub-new") });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [{ name, args }] = globalThis.__recoverPlan.rpc;
    expect(name).toBe("account_recovery_start");
    expect(args).toEqual({ p_source_sub: "sub-new", p_nonce_hash: await sha256(res.body.nonce) });
  });

  it("每次的 nonce 都不同", async () => {
    const token = await access("sub-new");
    const a = await post({ action: "start", source_token: token });
    const b = await post({ action: "start", source_token: token });
    expect(a.body.nonce).not.toBe(b.body.nonce);
  });

  it.each([
    ["not_eligible", 403],
    ["rate_limited", 429]
  ])("SQL 拒絕（%s）：只回固定代碼，不發 nonce", async (code, status) => {
    globalThis.__recoverPlan.rpcResult = { data: { ok: false, code }, error: null };
    const res = await post({ action: "start", source_token: await access("sub-new") });
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: code, request_id: expect.any(String) });
  });
});

describe("recover-plan：complete", () => {
  it("通過：sub 只取自驗過的 token，nonce 取自舊帳號的 id_token，呼叫一次合併", async () => {
    const res = await complete({ source_sub: "attacker-a", target_sub: "attacker-b", nonce: "attacker-nonce" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, request_id: expect.any(String) });
    expect(globalThis.__recoverPlan.rpc).toEqual([{
      name: "account_recovery_merge",
      args: {
        p_source_sub: "sub-new",
        p_target_sub: "sub-old",
        p_nonce_hash: await sha256("server-nonce"),
        p_target_auth_time: new Date(AUTH_TIME * 1000).toISOString(),
        p_request_id: res.body.request_id
      }
    }]);
  });

  it.each([
    ["沒有", undefined],
    ["不是數字", "1800000000"],
    ["是 null", null]
  ])("id_token 的 auth_time %s：拒絕，不碰資料庫，原因記在 log", async (_label, authTime) => {
    const res = await complete({ target_id_token: await idToken("sub-old", "server-nonce", { auth_time: authTime }) });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "not_eligible", request_id: expect.any(String) });
    expect(globalThis.__recoverPlan.rpc).toEqual([]);
    expect(logs.join("\n")).toContain("auth_time_missing");
  });

  it.each([
    ["same_account", 409],
    ["challenge_invalid", 409],
    ["not_eligible", 403],
    ["rate_limited", 429],
    ["busy", 503],
    ["merge_failed", 500]
  ])("SQL 拒絕（%s）：只回固定代碼", async (code, status) => {
    globalThis.__recoverPlan.rpcResult = { data: { ok: false, code }, error: null };
    const res = await complete();
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: code, request_id: expect.any(String) });
  });

  it("兩個 token 同一個帳號：一樣交給 SQL 用掉 challenge，回 same_account", async () => {
    globalThis.__recoverPlan.rpcResult = { data: { ok: false, code: "same_account" }, error: null };
    const res = await complete({ target_access_token: await access("sub-new"), target_id_token: await idToken("sub-new") });
    expect(res.status).toBe(409);
    expect(globalThis.__recoverPlan.rpc[0].args).toMatchObject({ p_source_sub: "sub-new", p_target_sub: "sub-new" });
  });
});

describe("recover-plan：token 沒驗過一律不碰資料庫", () => {
  const rejected = async (overrides, status = 401, error = "invalid_token") => {
    const res = await complete(await overrides());
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
    expect(globalThis.__recoverPlan.rpc).toEqual([]);
  };

  it.each([
    ["來源是偽造的", async () => ({ source_token: forge({ sub: "victim" }) })],
    ["目標是偽造的", async () => ({ target_access_token: forge({ sub: "victim" }) })],
    ["id_token 是偽造的", async () => ({ target_id_token: forge({ sub: "sub-old", nonce: "server-nonce" }) })],
    ["別人的金鑰簽的", async () => ({ target_access_token: await access("victim", {}, { key: otherKeys.privateKey }) })],
    ["來源過期", async () => ({ source_token: await access("sub-new", {}, { exp: Math.floor(Date.now() / 1000) - 600 }) })],
    ["目標過期", async () => ({ target_access_token: await access("sub-old", {}, { exp: Math.floor(Date.now() / 1000) - 600 }) })],
    ["別的發行者", async () => ({ target_access_token: await access("sub-old", {}, { issuer: "https://evil.test/oidc" }) })],
    ["不透明 token", async () => ({ source_token: "opaque-token" })],
    ["別的 App 發的 access token", async () => ({ target_access_token: await access("sub-old", { client_id: "other-app" }) })],
    ["沒有 client_id 的 access token", async () => ({ source_token: await access("sub-new", { client_id: undefined }) })],
    ["id_token 給別的 App", async () => ({ target_id_token: await idToken("sub-old", "server-nonce", { aud: "other-app" }) })],
    ["id_token 的 sub 和 access token 不同", async () => ({ target_id_token: await idToken("victim") })],
    ["id_token 沒有 nonce", async () => ({ target_id_token: await sign({ sub: "sub-old", aud: CLIENT }) })]
  ])("%s", async (_label, overrides) => {
    await rejected(overrides);
  });

  // 其他函式在模式模組載入時就決定，所以這裡用該模式重新載入一份 handler，才測得到「不看模式」。
  it.each(["off", "report"])("NLC_JWT_VERIFY_MODE=%s 也不放行偽造的 token", async (mode) => {
    const enforcing = handler;
    env.NLC_JWT_VERIFY_MODE = mode;
    vi.resetModules();
    await import("../supabase/functions/recover-plan/index.ts");
    expect(handler).not.toBe(enforcing);
    try {
      for (const overrides of [
        { source_token: forge({ sub: "victim" }) },
        { target_access_token: forge({ sub: "victim" }) },
        { target_id_token: forge({ sub: "sub-old", nonce: "server-nonce" }) }
      ]) {
        const res = await complete(overrides);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("invalid_token");
      }
      expect(globalThis.__recoverPlan.rpc).toEqual([]);
    } finally {
      handler = enforcing;
    }
  });

  it("缺 token：400", async () => {
    await rejected(async () => ({ target_id_token: "" }), 400, "missing_token");
    expect((await post({ action: "start" })).status).toBe(400);
  });

  it("access token 的 audience 不符設定：擋", async () => {
    env.NLC_LOGTO_AUDIENCE = "https://other-resource.test";
    await rejected(async () => ({}));
  });

  it("JWKS 連不上：回 503 讓前端重試，不當成 token 錯", async () => {
    globalThis.__recoverPlan.jwksDown = true;
    const res = await complete();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("auth_verification_unavailable");
    expect(globalThis.__recoverPlan.rpc).toEqual([]);
  });
});

describe("recover-plan：請求本身", () => {
  it("沒設定 RECOVER_PLAN_ALLOWED_CLIENT_IDS：全部拒絕（fail closed）", async () => {
    env.RECOVER_PLAN_ALLOWED_CLIENT_IDS = "";
    const res = await complete();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("recovery_not_configured");
    expect(globalThis.__recoverPlan.rpc).toEqual([]);
  });

  it.each([
    ["白名單外的網站", "https://evil.example"],
    ["沒有 Origin", null]
  ])("%s：連處理都不處理（CSRF）", async (_label, origin) => {
    const res = await post({ action: "start", source_token: await access("sub-new") }, { origin });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("origin_not_allowed");
    expect(globalThis.__recoverPlan.rpc).toEqual([]);
  });

  it("白名單內的網站：CORS 標頭照既有函式，回應不快取", async () => {
    const res = await post({ action: "start", source_token: await access("sub-new") });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bible-speed-reading-staging.vercel.app");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe(res.body.request_id);
  });

  it("OPTIONS 預檢通過，GET 不行", async () => {
    const preflight = await handler(new Request("https://edge.test/recover-plan", {
      method: "OPTIONS", headers: { origin: "https://bible.newlife.org.tw" }
    }));
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://bible.newlife.org.tw");
    expect((await post(null, { method: "GET" })).status).toBe(405);
  });

  it("壞 JSON、不認得的動作、太大的內容都擋", async () => {
    expect((await post("{oops")).status).toBe(400);
    expect((await post({ action: "drop_everything" })).body.error).toBe("unknown_action");
    expect((await post({ action: "start", source_token: "x".repeat(70 * 1024) })).status).toBe(413);
  });

  it("資料庫出錯：回固定錯誤，不洩漏內部訊息", async () => {
    globalThis.__recoverPlan.rpcResult = { data: null, error: { code: "XX000", message: "internal detail about profiles" } };
    const res = await complete();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "recover_plan_failed", request_id: expect.any(String) });
  });

  it("任何情況都不把 token、sub、nonce 寫進 log，也不放進回應", async () => {
    const sourceToken = await access("sub-new");
    const targetToken = await access("sub-old");
    const targetIdToken = await idToken("sub-old");
    const bad = forge({ sub: "victim-sub" });

    const responses = [
      await post({ action: "start", source_token: sourceToken }),
      await post({ action: "complete", source_token: sourceToken, target_access_token: targetToken, target_id_token: targetIdToken }),
      await post({ action: "complete", source_token: bad, target_access_token: targetToken, target_id_token: targetIdToken })
    ];
    globalThis.__recoverPlan.rpcThrows = new Error("connection refused");
    responses.push(await post({ action: "complete", source_token: sourceToken, target_access_token: targetToken, target_id_token: targetIdToken }));

    const output = logs.join("\n");
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [sourceToken, targetToken, targetIdToken, bad, "sub-new", "sub-old", "victim-sub", "server-nonce"]) {
      expect(output).not.toContain(secret);
      for (const response of responses) expect(JSON.stringify(response.body)).not.toContain(secret);
    }
  });
});
