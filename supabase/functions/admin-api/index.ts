// 後台專用 API（#547）：只服務後台（#555），和會友 App 用的 nlc-data 分開。
// 全部唯讀；一個 action 對一支 SQL 函式（supabase/migrations/20261011110008_admin_api_support.sql）。
// 權限表與參數規則在 policy.ts、請求流程在 handler.ts；這支只接上 Deno、Logto 驗證與 Supabase client。
//
// 必要的 secret（見 supabase/functions/README.md）：
//   ADMIN_API_ALLOWED_CLIENT_IDS  後台 Logto 應用程式的 client id（逗號分隔）。沒設定 → 全部拒絕。
// 選填：ADMIN_API_CLIENT_CLAIM（預設 client_id）、ADMIN_API_ALLOWED_ORIGINS、ADMIN_API_ALLOW_LOCALHOST、
//       ADMIN_API_AUDIENCE（沒設就用 NLC_LOGTO_AUDIENCE）、NLC_LOGTO_ISSUER。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://esm.sh/jose@5.9.6";
import { handleAdminRequest } from "./handler.ts";

// >>> logto-jwt-verify（nlc-data、nlc-session、admin-api 三支 index.ts 內此區塊逐字相同；scripts/logto-jwt-verify.test.mjs 會比對）
// 以 Logto 的公開金鑰（JWKS）驗證 JWT 的簽章、發行者（iss）、到期（exp）。在這之前兩支函式都只
// base64 解開 payload 就信任裡面的 sub / email——任何人都能自己簽一張假 token 冒用別人。
// 直接內嵌、不 import 共用檔：部署只打包函式自己的資料夾。
//
// NLC_JWT_VERIFY_MODE（Edge Function secret）：
//   report（預設）：nlc-data 驗證失敗只記錄、照舊放行，用來確認正式流量都驗得過；
//                   nlc-session 的 id_token 一律要驗過才採用（見 pickSessionUserinfo）。
//   enforce：        兩邊驗證失敗都拒絕。確認 report 期間沒有正常使用者被判失敗後再切。
//   off：            緊急開關，完全回到舊行為（只解 payload）。
// NLC_LOGTO_AUDIENCE（選填）：access token 的 aud 要等於它才算過（report 期間的 log 會印出實際的 aud）。
// NLC_LOGTO_CLIENT_ID（選填）：id_token 的 aud 要等於它才算過。
const LOGTO_JWT_MODE: "off" | "report" | "enforce" = (() => {
  const m = String(Deno.env.get("NLC_JWT_VERIFY_MODE") || "report").trim().toLowerCase();
  return m === "off" || m === "enforce" ? m : "report";
})();
const LOGTO_JWT_CLOCK_TOLERANCE_SEC = 60;
let logtoJwks: any = null;
let logtoJwksIssuer = "";
function getLogtoJwks(issuer: string) {
  if (!logtoJwks || logtoJwksIssuer !== issuer) {
    logtoJwks = jose.createRemoteJWKSet(new URL(`${issuer}/jwks`), {
      timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 10 * 60 * 1000
    });
    logtoJwksIssuer = issuer;
  }
  return logtoJwks;
}
type LogtoJwtResult = { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string };
async function verifyLogtoJwt(token: string, issuer: string, audience?: string): Promise<LogtoJwtResult> {
  try {
    const { payload } = await jose.jwtVerify(token, getLogtoJwks(issuer), {
      issuer, audience: audience || undefined, clockTolerance: LOGTO_JWT_CLOCK_TOLERANCE_SEC
    });
    return { ok: true, payload: payload as Record<string, unknown> };
  } catch (err) {
    const code = String((err as any)?.code || "");
    const reason = code === "ERR_JWT_EXPIRED" ? "expired"
      : code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ? "bad_signature"
      : code === "ERR_JWT_CLAIM_VALIDATION_FAILED" ? `claim_${String((err as any)?.claim || "unknown")}`
      : code === "ERR_JWKS_NO_MATCHING_KEY" ? "unknown_key"
      : code === "ERR_JOSE_ALG_NOT_ALLOWED" || code === "ERR_JOSE_NOT_SUPPORTED" ? "unsupported_alg"
      : code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID" || /fetch|network|dns|connect|sending request|Expected 200 OK/i.test(String((err as any)?.message || "")) ? "jwks_unavailable"
      : code === "ERR_JWT_INVALID" || code === "ERR_JWS_INVALID" ? "malformed"
      : (code ? code.toLowerCase() : "malformed");
    return { ok: false, reason };
  }
}
// 觀察用統計：每 5 分鐘印一行彙總；失敗明細每個時間窗最多 20 筆（只印 aud / alg / 過期多久，不印 sub 或 token）。
const logtoJwtStats = { since: Date.now(), counts: {} as Record<string, number>, detailed: 0 };
function recordLogtoJwt(source: string, result: LogtoJwtResult, token: string) {
  const key = `${source}:${result.ok ? "ok" : result.reason}`;
  logtoJwtStats.counts[key] = (logtoJwtStats.counts[key] || 0) + 1;
  if (!result.ok && logtoJwtStats.detailed < 20) {
    logtoJwtStats.detailed++;
    let aud: unknown = null, alg: unknown = null, expiredSec: number | null = null;
    try {
      const [h, p] = token.split(".");
      const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
      alg = dec(h)?.alg ?? null;
      const payload = dec(p) || {};
      aud = payload.aud ?? null;
      if (typeof payload.exp === "number") expiredSec = Math.round(Date.now() / 1000 - payload.exp);
    } catch (_) { /* malformed */ }
    console.warn(JSON.stringify({ event: "logto_jwt_verify_failed", mode: LOGTO_JWT_MODE, source, reason: result.reason, aud, alg, expiredSec }));
  }
  if (Date.now() - logtoJwtStats.since >= 5 * 60 * 1000) {
    console.log(JSON.stringify({ event: "logto_jwt_verify_summary", mode: LOGTO_JWT_MODE, windowSec: Math.round((Date.now() - logtoJwtStats.since) / 1000), counts: logtoJwtStats.counts }));
    logtoJwtStats.since = Date.now();
    logtoJwtStats.counts = {};
    logtoJwtStats.detailed = 0;
  }
}
// nlc-session 用：決定這次登入採信哪份身分資料。
//   · 向 Logto UserInfo 查到的（fresh）一定是真的（Logto 自己驗了 access token）。
//   · 前端送來的 id_token 只有在簽章驗過、而且 sub 跟 fresh 相同時，才拿來補欄位——
//     否則攻擊者可以附一張偽造、填了受害者 email 的 id_token，讓 email 比對把受害者帳號綁給他。
//   · 查不到 fresh（UserInfo 故障）時，只接受驗過簽章的 id_token。
// 回傳 { userinfo } 或 { error, status }。mode=off 時回到舊行為。
function pickSessionUserinfo(
  fresh: Record<string, unknown> | null,
  idTokenResult: LogtoJwtResult | null,
  unverifiedIdTokenClaims: Record<string, unknown> | null
): { userinfo: Record<string, unknown> } | { error: string; status: number } {
  if (LOGTO_JWT_MODE === "off") {
    const merged = { ...(unverifiedIdTokenClaims || {}), ...(fresh || {}) };
    return merged.sub ? { userinfo: merged } : { error: "invalid_userinfo", status: 401 };
  }
  const verified = idTokenResult && idTokenResult.ok ? idTokenResult.payload : null;
  if (fresh && fresh.sub) {
    const usable = verified && verified.sub === fresh.sub ? verified : {};
    return { userinfo: { ...usable, ...fresh } };
  }
  if (verified && verified.sub) return { userinfo: { ...verified } };
  if (idTokenResult && !idTokenResult.ok && idTokenResult.reason === "jwks_unavailable") {
    return { error: "auth_verification_unavailable", status: 503 };
  }
  return { error: "invalid_userinfo", status: 401 };
}
// <<< logto-jwt-verify

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const logtoIssuer = (Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc").replace(/\/+$/, "");

Deno.serve((req: Request) => handleAdminRequest(req, {
  env: (key) => Deno.env.get(key),
  // 一律要驗過簽章、發行者、到期——不看 NLC_JWT_VERIFY_MODE（那是 nlc-data 過渡期用的）
  verifyToken: async (token) => {
    const result = await verifyLogtoJwt(
      token,
      logtoIssuer,
      Deno.env.get("ADMIN_API_AUDIENCE") || Deno.env.get("NLC_LOGTO_AUDIENCE") || undefined
    );
    recordLogtoJwt("admin-api", result, token);
    return result;
  },
  rpc: async (fn, args) => {
    if (!supabaseAdmin) return { data: null, error: { message: "server_not_configured" } };
    const { data, error } = await supabaseAdmin.rpc(fn, args);
    return { data, error };
  },
  log: (line) => console.log(line)
}));
