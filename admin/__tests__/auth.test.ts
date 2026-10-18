// 後台登入（#555）：PKCE、token 只在記憶體、沒有 refresh token、登出結束 Logto 登入狀態。
import { describe, it, expect, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { FLOW_KEY, SIGNED_OUT_KEY, createAdminAuth, safeReturnHash } from "../src/auth.ts";

const ISSUER = "https://sso.example.test/oidc";
const ORIGIN = "https://bible-speed-reading-admin-staging.vercel.app";
const CONFIG = { issuer: ISSUER, clientId: "admin-client", resource: "https://platform.example.test", scopes: "openid profile email" };
const DISCOVERY = {
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  end_session_endpoint: `${ISSUER}/session/end`
};

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const fakeJwt = (claims: Record<string, unknown>) => `${b64url(JSON.stringify({ alg: "ES384" }))}.${b64url(JSON.stringify(claims))}.sig`;

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
}

function setup({ search = "", hash = "", tokenResponse }: { search?: string; hash?: string; tokenResponse?: (body: URLSearchParams, flow: any) => Response } = {}) {
  let clock = 5_000_000;
  const storage = new MemoryStorage();
  const location = { origin: ORIGIN, search, hash, assign: vi.fn() };
  const history = { replaceState: vi.fn() };
  const tokenBodies: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) return new Response(JSON.stringify(DISCOVERY), { status: 200 });
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init.body));
      tokenBodies.push(body);
      return tokenResponse ? tokenResponse(body, JSON.parse(storage.getItem(FLOW_KEY) || "null")) : new Response("{}", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  });
  const auth = createAdminAuth({
    config: CONFIG,
    location,
    history,
    storage,
    fetchImpl,
    crypto: webcrypto as unknown as Crypto,
    now: () => clock
  });
  return { auth, storage, location, history, fetchImpl, tokenBodies, advance: (ms: number) => { clock += ms; } };
}

/** 跑一次完整登入：init → 導去 Logto → 帶 code 回來 → 換 token */
async function signIn(options: { expiresIn?: number; hash?: string } = {}) {
  const first = setup({ hash: options.hash ?? "#/people/user/11111111-1111-4111-8111-111111111111?reason=x" });
  expect(await first.auth.init()).toEqual({ status: "redirecting" });
  const authorizeUrl = new URL(first.location.assign.mock.calls[0][0]);
  const flow = JSON.parse(first.storage.getItem(FLOW_KEY)!);

  // 回到 Redirect URI（網站根目錄）：新的頁面，同一個 sessionStorage
  const second = setup({
    search: `?code=the-code&state=${authorizeUrl.searchParams.get("state")}`,
    tokenResponse: () => new Response(JSON.stringify({
      access_token: "access-jwt",
      id_token: fakeJwt({ sub: "u1", nonce: flow.nonce }),
      expires_in: options.expiresIn ?? 3600,
      token_type: "Bearer"
    }), { status: 200 })
  });
  second.storage.data = first.storage.data;
  const result = await second.auth.init();
  return { first, second, authorizeUrl, flow, result };
}

describe("login redirect", () => {
  it("sends the admin to Logto with PKCE (S256), the admin client, no refresh-token scope", async () => {
    const { authorizeUrl, flow } = await signIn();
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(`${ISSUER}/auth`);
    const params = authorizeUrl.searchParams;
    expect(params.get("client_id")).toBe("admin-client");
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/`);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid profile email");
    expect(params.get("scope")).not.toContain("offline_access");
    expect(params.get("resource")).toBe("https://platform.example.test");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(flow.verifier).digest("base64url"));
    expect(params.get("state")).toBe(flow.state);
    expect(params.get("nonce")).toBe(flow.nonce);
    expect(params.has("code_verifier")).toBe(false);
  });

  it("remembers only an in-app return route", async () => {
    const { flow } = await signIn({ hash: "#/people/user/11111111-1111-4111-8111-111111111111?reason=x" });
    expect(flow.returnHash).toBe("#/people/user/11111111-1111-4111-8111-111111111111?reason=x");
    expect(safeReturnHash("https://evil.test")).toBe("");
    expect(safeReturnHash("#javascript:alert(1)")).toBe("");
    expect(safeReturnHash("#/support")).toBe("#/support");
  });
});

describe("callback", () => {
  it("exchanges the code with the verifier and keeps the token in memory only", async () => {
    const { second, flow, result } = await signIn();
    expect(result).toEqual({ status: "signed_in" });
    const body = second.tokenBodies[0];
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe(flow.verifier);
    expect(body.get("client_id")).toBe("admin-client");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/`);
    expect(body.get("resource")).toBe("https://platform.example.test");
    expect(second.auth.getToken()).toBe("access-jwt");
    // 一次性資料已刪；storage 裡沒有任何 token
    expect(second.storage.getItem(FLOW_KEY)).toBeNull();
    expect([...second.storage.data.values()].join(" ")).not.toContain("access-jwt");
    // code 從網址拿掉，回到原本要去的頁面
    expect(second.history.replaceState).toHaveBeenCalledWith(null, "", "/#/people/user/11111111-1111-4111-8111-111111111111?reason=x");
  });

  it("treats the token as expired 30 s early and then returns null (no refresh token)", async () => {
    const { second } = await signIn({ expiresIn: 600 });
    second.advance(569_000);
    expect(second.auth.getToken()).toBe("access-jwt");
    second.advance(2_000);
    expect(second.auth.getToken()).toBeNull();
  });

  it("rejects a state mismatch without calling the token endpoint", async () => {
    const first = setup();
    await first.auth.init();
    const attack = setup({ search: "?code=stolen&state=forged" });
    attack.storage.data = first.storage.data;
    const result = await attack.auth.init();
    expect(result.status).toBe("error");
    expect(attack.tokenBodies).toHaveLength(0);
    expect(attack.auth.getToken()).toBeNull();
  });

  it("rejects an id_token whose nonce does not match", async () => {
    const first = setup();
    await first.auth.init();
    const state = new URL(first.location.assign.mock.calls[0][0]).searchParams.get("state");
    const second = setup({
      search: `?code=c&state=${state}`,
      tokenResponse: () => new Response(JSON.stringify({ access_token: "a", id_token: fakeJwt({ nonce: "other" }), expires_in: 3600 }), { status: 200 })
    });
    second.storage.data = first.storage.data;
    expect((await second.auth.init()).status).toBe("error");
    expect(second.auth.getToken()).toBeNull();
  });

  it("rejects a stale login flow (older than 10 minutes)", async () => {
    const first = setup();
    await first.auth.init();
    const state = new URL(first.location.assign.mock.calls[0][0]).searchParams.get("state");
    const second = setup({ search: `?code=c&state=${state}` });
    second.storage.data = first.storage.data;
    second.advance(11 * 60 * 1000);
    expect((await second.auth.init()).status).toBe("error");
    expect(second.tokenBodies).toHaveLength(0);
  });

  it("reports a Logto error instead of looping back to login", async () => {
    const { auth, location } = setup({ search: "?error=access_denied&error_description=user%20cancelled" });
    const result = await auth.init();
    expect(result).toEqual({ status: "error", message: "登入沒有完成（user cancelled）。" });
    expect(location.assign).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("ends the Logto session and returns to the registered redirect URI", async () => {
    const { second } = await signIn();
    await second.auth.logout("idle");
    expect(second.auth.getToken()).toBeNull();
    expect(second.storage.getItem(SIGNED_OUT_KEY)).toBe("idle");
    const url = new URL(second.location.assign.mock.calls.at(-1)![0]);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/session/end`);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/`);
    expect(url.searchParams.get("client_id")).toBe("admin-client");
  });

  it("shows the signed-out screen once after coming back, instead of logging straight back in", async () => {
    const back = setup();
    back.storage.setItem(SIGNED_OUT_KEY, "idle");
    expect(await back.auth.init()).toEqual({ status: "signed_out", reason: "idle" });
    expect(back.location.assign).not.toHaveBeenCalled();
    expect(back.storage.getItem(SIGNED_OUT_KEY)).toBeNull();
    expect(await back.auth.init()).toEqual({ status: "redirecting" });
  });
});
