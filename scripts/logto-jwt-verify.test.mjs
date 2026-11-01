// Logto JWT 驗證（內嵌在 nlc-data 與 nlc-session 的 index.ts）：用真的 ES384 金鑰簽 token 跑內嵌程式碼。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import * as realJose from "jose";

const ISSUER = "https://sso.example.test/oidc";
const read = (name) => readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
const block = (src) => {
  const m = src.match(/\/\/ >>> logto-jwt-verify[\s\S]*?\/\/ <<< logto-jwt-verify/);
  return m ? m[0].replace(/\r\n/g, "\n") : null;
};
const nlcDataSrc = read("nlc-data");
const nlcSessionSrc = read("nlc-session");
const adminApiSrc = read("admin-api");
const code = transformSync(
  `${block(nlcDataSrc)}\nreturn { LOGTO_JWT_MODE, verifyLogtoJwt, recordLogtoJwt, pickSessionUserinfo };`,
  { loader: "ts" }
).code;

let keys, otherKeys, jwks;
beforeAll(async () => {
  keys = await realJose.generateKeyPair("ES384");
  otherKeys = await realJose.generateKeyPair("ES384");
  const pub = await realJose.exportJWK(keys.publicKey);
  jwks = { keys: [{ ...pub, kid: "k1", alg: "ES384", use: "sig" }] };
});

// 內嵌程式碼 = Deno 版；這裡注入 Deno.env 與「JWKS 不走網路」的 jose
function load(mode = "report", { jwksUnavailable = false } = {}) {
  const Deno = { env: { get: (k) => (k === "NLC_JWT_VERIFY_MODE" ? mode : undefined) } };
  const jose = {
    ...realJose,
    createRemoteJWKSet: (url) => {
      expect(String(url)).toBe(`${ISSUER}/jwks`);
      if (jwksUnavailable) return async () => { throw new TypeError("error sending request for url"); };
      return realJose.createLocalJWKSet(jwks);
    }
  };
  return new Function("Deno", "jose", code)(Deno, jose);
}

const sign = (claims, { key, exp = "10m", issuer = ISSUER, kid = "k1" } = {}) =>
  new realJose.SignJWT(claims)
    .setProtectedHeader({ alg: "ES384", kid })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key || keys.privateKey);

// 攻擊者自己做的 token：不需要任何金鑰，alg 隨便填
const forge = (claims) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "ES384", kid: "k1" })}.${enc({ iss: ISSUER, exp: 9999999999, ...claims })}.${Buffer.from("x").toString("base64url")}`;
};

describe("both functions embed the same verification code", () => {
  it("nlc-data, nlc-session and admin-api blocks are identical", () => {
    expect(block(nlcDataSrc)).toBeTruthy();
    expect(block(nlcDataSrc)).toBe(block(nlcSessionSrc));
    expect(block(nlcDataSrc)).toBe(block(adminApiSrc));
  });
  it("admin-api always requires a verified token, whatever NLC_JWT_VERIFY_MODE says", () => {
    const serve = adminApiSrc.slice(adminApiSrc.indexOf("Deno.serve("));
    expect(serve).toContain("const result = await verifyLogtoJwt(");
    expect(serve).toContain("return result;");
    expect(serve).not.toContain("LOGTO_JWT_MODE");
  });
  it("nlc-data verifies before trusting the Logto JWT payload", () => {
    const fn = nlcDataSrc.slice(nlcDataSrc.indexOf("async function resolveProfile"));
    expect(fn.indexOf("verifyLogtoJwt(accessToken")).toBeGreaterThan(-1);
    expect(fn.indexOf("verifyLogtoJwt(accessToken")).toBeLessThan(fn.indexOf("let sub: string | null = isLogtoJwt"));
  });
  it("nlc-session no longer seeds userinfo from the raw id_token", () => {
    expect(nlcSessionSrc).not.toMatch(/userinfo\s*=\s*parseJwt\(idToken\)/);
    expect(nlcSessionSrc).toMatch(/pickSessionUserinfo\(accessTokenResult, freshUserinfo, idTokenResult, unverifiedIdTokenClaims\)/);
  });
  // #646：Logto UserInfo 不收帶 resource 的 JWT access token（每次都失敗），身分改以驗過的 access token 為準。
  it("nlc-session verifies the access token itself and asks UserInfo only for opaque tokens", () => {
    const serve = nlcSessionSrc.slice(nlcSessionSrc.indexOf("Deno.serve("));
    expect(serve).toContain('verifyLogtoJwt(accessToken, issuer, Deno.env.get("NLC_LOGTO_AUDIENCE") || undefined)');
    expect(serve).toContain('recordLogtoJwt("nlc-session:access_token"');
    const userinfoCall = serve.indexOf(".well-known/openid-configuration");
    expect(userinfoCall).toBeGreaterThan(serve.indexOf("if (!accessIsJwt) {"));
    expect(serve.indexOf("verifyLogtoJwt(accessToken")).toBeLessThan(serve.indexOf("pickSessionUserinfo("));
  });
});

describe("verifyLogtoJwt", () => {
  it("accepts a correctly signed, unexpired token from the issuer", async () => {
    const { verifyLogtoJwt } = load();
    const res = await verifyLogtoJwt(await sign({ sub: "u1" }), ISSUER);
    expect(res.ok).toBe(true);
    expect(res.payload.sub).toBe("u1");
  });

  it.each([
    ["a forged token (no valid signature)", async () => forge({ sub: "victim" }), "bad_signature"],
    ["a token signed by someone else's key", async () => sign({ sub: "u1" }, { key: otherKeys.privateKey }), "bad_signature"],
    ["an expired token", async () => sign({ sub: "u1" }, { exp: Math.floor(Date.now() / 1000) - 600 }), "expired"],
    ["a token from another issuer", async () => sign({ sub: "u1" }, { issuer: "https://evil.test/oidc" }), "claim_iss"],
    ["an unknown signing key id", async () => sign({ sub: "u1" }, { kid: "nope" }), "unknown_key"],
    ["garbage", async () => "not-a-jwt", "malformed"]
  ])("rejects %s", async (_label, make, reason) => {
    const { verifyLogtoJwt } = load();
    const res = await verifyLogtoJwt(await make(), ISSUER);
    expect(res).toEqual({ ok: false, reason });
  });

  it("tolerates small clock skew (expired 30s ago still passes)", async () => {
    const { verifyLogtoJwt } = load();
    const res = await verifyLogtoJwt(await sign({ sub: "u1" }, { exp: Math.floor(Date.now() / 1000) - 30 }), ISSUER);
    expect(res.ok).toBe(true);
  });

  it("checks aud only when an audience is configured", async () => {
    const { verifyLogtoJwt } = load();
    const tok = await sign({ sub: "u1", aud: "https://platform.example.test" });
    expect((await verifyLogtoJwt(tok, ISSUER)).ok).toBe(true);
    expect((await verifyLogtoJwt(tok, ISSUER, "https://platform.example.test")).ok).toBe(true);
    expect(await verifyLogtoJwt(tok, ISSUER, "https://other.test")).toEqual({ ok: false, reason: "claim_aud" });
  });

  it("reports an unreachable JWKS as jwks_unavailable (not as a bad token)", async () => {
    const { verifyLogtoJwt } = load("enforce", { jwksUnavailable: true });
    expect(await verifyLogtoJwt(await sign({ sub: "u1" }), ISSUER)).toEqual({ ok: false, reason: "jwks_unavailable" });
  });
});

describe("modes", () => {
  // null＝沒設 secret（undefined 會被 load() 的預設參數換掉）。沒設、空字串、設錯都要是 enforce（#564）
  it.each([["report", "report"], ["enforce", "enforce"], ["off", "off"], ["ENFORCE", "enforce"], ["bogus", "enforce"], ["", "enforce"], [null, "enforce"]])(
    "NLC_JWT_VERIFY_MODE=%s → %s", (raw, expected) => {
      expect(load(raw).LOGTO_JWT_MODE).toBe(expected);
    }
  );

  it("logs failures without the token or sub, and caps detail lines", async () => {
    const { verifyLogtoJwt, recordLogtoJwt } = load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tok = forge({ sub: "victim-sub", email: "victim@example.test", aud: "aud-x" });
    const res = await verifyLogtoJwt(tok, ISSUER);
    for (let i = 0; i < 25; i++) recordLogtoJwt("nlc-data", res, tok);
    expect(warn).toHaveBeenCalledTimes(20);
    const line = warn.mock.calls[0][0];
    expect(JSON.parse(line)).toMatchObject({ event: "logto_jwt_verify_failed", source: "nlc-data", reason: "bad_signature", aud: "aud-x", alg: "ES384" });
    expect(line).not.toContain("victim");
    expect(line).not.toContain(tok);
    warn.mockRestore();
  });
});

describe("pickSessionUserinfo (nlc-session account-linking)", () => {
  // pickSessionUserinfo(accessTokenResult, fresh, idTokenResult, unverifiedIdTokenClaims)
  //   accessTokenResult：nlc-session 驗 JWT access token 的結果（不透明 token 為 null）
  //   fresh：只有不透明 access token 才會去查 Logto UserInfo
  const access = async (sub, mode) => (mode || load()).verifyLogtoJwt(await sign({ sub, aud: "https://platform.example.test" }), ISSUER);

  it("a verified access token alone is enough (id_token missing or expired)", async () => {
    const { pickSessionUserinfo } = load();
    expect(pickSessionUserinfo(await access("u1"), null, null, null)).toEqual({ userinfo: { sub: "u1" } });
    const { verifyLogtoJwt } = load();
    const expiredId = await verifyLogtoJwt(await sign({ sub: "u1", email: "u1@example.test" }, { exp: Math.floor(Date.now() / 1000) - 600 }), ISSUER);
    expect(pickSessionUserinfo(await access("u1"), null, expiredId, { sub: "u1", email: "u1@example.test" })).toEqual({ userinfo: { sub: "u1" } });
  });

  it("fills email/name from a verified id_token only when its sub matches the access token", async () => {
    const { verifyLogtoJwt, pickSessionUserinfo } = load();
    const same = await verifyLogtoJwt(await sign({ sub: "u1", email: "u1@example.test", name: "U1" }), ISSUER);
    expect(pickSessionUserinfo(await access("u1"), null, same, null).userinfo).toMatchObject({ sub: "u1", email: "u1@example.test", name: "U1" });

    const other = await verifyLogtoJwt(await sign({ sub: "victim", email: "victim@example.test" }), ISSUER);
    expect(pickSessionUserinfo(await access("attacker"), null, other, null)).toEqual({ userinfo: { sub: "attacker" } });
  });

  it("ignores a forged id_token's email (the takeover path)", async () => {
    const { verifyLogtoJwt, pickSessionUserinfo } = load();
    const forged = forge({ sub: "attacker", email: "victim@example.test" });
    const res = pickSessionUserinfo(await access("attacker"), null, await verifyLogtoJwt(forged, ISSUER), { sub: "attacker", email: "victim@example.test" });
    expect(res).toEqual({ userinfo: { sub: "attacker" } });
  });

  it.each([
    ["forged", async () => forge({ sub: "victim" })],
    ["signed by someone else's key", async () => sign({ sub: "victim" }, { key: otherKeys.privateKey })],
    ["expired", async () => sign({ sub: "u1" }, { exp: Math.floor(Date.now() / 1000) - 600 })]
  ])("rejects an access token that is %s, even with a valid id_token", async (_label, make) => {
    const { verifyLogtoJwt, pickSessionUserinfo } = load();
    const bad = await verifyLogtoJwt(await make(), ISSUER);
    const goodId = await verifyLogtoJwt(await sign({ sub: "victim", email: "victim@example.test" }), ISSUER);
    expect(pickSessionUserinfo(bad, null, goodId, null)).toEqual({ error: "invalid_logto_token", status: 401 });
  });

  it("opaque access token: trusts UserInfo, and a verified id_token only for the same sub", async () => {
    const { verifyLogtoJwt, pickSessionUserinfo } = load();
    const fresh = { sub: "attacker", name: "Attacker" };
    const forged = forge({ sub: "attacker", email: "victim@example.test" });
    expect(pickSessionUserinfo(null, fresh, await verifyLogtoJwt(forged, ISSUER), { sub: "attacker", email: "victim@example.test" }).userinfo).toEqual(fresh);
    const same = await verifyLogtoJwt(await sign({ sub: "attacker", email: "me@example.test" }), ISSUER);
    expect(pickSessionUserinfo(null, fresh, same, null).userinfo).toMatchObject({ sub: "attacker", email: "me@example.test", name: "Attacker" });
    expect(pickSessionUserinfo(null, null, same, null)).toEqual({ error: "invalid_userinfo", status: 401 });
  });

  it("protects nlc-session in report mode too (only 'off' restores the old behavior)", async () => {
    const report = load("report");
    expect(report.pickSessionUserinfo(await report.verifyLogtoJwt(forge({ sub: "victim" }), ISSUER), null, null, { sub: "victim" }))
      .toEqual({ error: "invalid_logto_token", status: 401 });
    const off = load("off");
    expect(off.pickSessionUserinfo(null, null, null, { sub: "u1", email: "u1@example.test" }).userinfo.email).toBe("u1@example.test");
  });

  it("returns 503 (retry, don't log out) when JWKS is unreachable", async () => {
    const { verifyLogtoJwt, pickSessionUserinfo } = load("enforce", { jwksUnavailable: true });
    const res = await verifyLogtoJwt(await sign({ sub: "u1" }), ISSUER);
    expect(pickSessionUserinfo(res, null, null, { sub: "u1" })).toEqual({ error: "auth_verification_unavailable", status: 503 });
  });
});
