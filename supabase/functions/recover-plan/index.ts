// recover-plan（#664）：會友換登入方式開出新的空帳號時，驗證舊的登入方式後把空帳號併回舊帳號。
//
// 依據只有「兩個都驗過的 Logto token」：新帳號的 access token，加上舊帳號剛登入拿到的 access token 與 id_token。
// 裝置紀錄只用來決定要不要顯示提示（共用裝置、localStorage 可偽造），這裡完全不看。
// 合併不可逆，條件全部由 account_recovery_* 在同一個交易重查；這支函式只負責驗 token、把 sub 傳過去。
//
//   POST { action: "start", source_token }
//     → { ok: true, nonce }：前端拿 nonce 當 OIDC nonce，用 prompt=login 讓會友登入舊的方式。
//   POST { action: "complete", source_token, target_access_token, target_id_token }
//     → { ok: true }：合併完成。失敗回 { error: 固定代碼 }，不帶任何帳號資料。
//
// token 不寫 log、不存任何地方，DB 只存 nonce 的雜湊。
// 下面兩個內嵌區塊和 nlc-session 等函式逐字相同（scripts/logto-jwt-verify.test.mjs、
// scripts/cors-allowlist.test.mjs 會比對），區塊註解裡寫的「三支」不含這支。
// 必要 secret：RECOVER_PLAN_ALLOWED_CLIENT_IDS（會友 App 的 Logto client id，沒設定就全部拒絕）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://esm.sh/jose@5.9.6";

// >>> logto-jwt-verify（nlc-data、nlc-session、admin-api 三支 index.ts 內此區塊逐字相同；scripts/logto-jwt-verify.test.mjs 會比對）
// 以 Logto 的公開金鑰（JWKS）驗證 JWT 的簽章、發行者（iss）、到期（exp）。在這之前兩支函式都只
// base64 解開 payload 就信任裡面的 sub / email——任何人都能自己簽一張假 token 冒用別人。
// 直接內嵌、不 import 共用檔：部署只打包函式自己的資料夾。
//
// NLC_JWT_VERIFY_MODE（Edge Function secret）：
//   enforce（預設）：兩邊驗證失敗都拒絕。沒設或設成不認得的值也是 enforce（#564：漏設 secret 不能變成放行）。
//   report：         nlc-data 驗證失敗只記錄、照舊放行（當初上線前觀察正式流量用）；
//                   nlc-session 的 id_token 一律要驗過才採用（見 pickSessionUserinfo）。
//   off：            緊急開關，完全回到舊行為（只解 payload）。
// NLC_LOGTO_AUDIENCE（選填）：access token 的 aud 要等於它才算過（report 模式的 log 會印出實際的 aud）。
// NLC_LOGTO_CLIENT_ID（選填）：id_token 的 aud 要等於它才算過。
const LOGTO_JWT_MODE: "off" | "report" | "enforce" = (() => {
  const m = String(Deno.env.get("NLC_JWT_VERIFY_MODE") || "enforce").trim().toLowerCase();
  return m === "off" || m === "report" ? m : "enforce";
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
// nlc-session 用：決定這次登入採信哪份身分資料（#646）。
//   · 身分（sub）以 access token 為準：JWT access token 由 nlc-session 自己驗過簽章（accessTokenResult），
//     驗不過就拒絕，不改用 id_token。Logto UserInfo 不收帶 resource 的 JWT access token，所以只有
//     不透明 access token（accessTokenResult 為 null）才用 UserInfo 查到的 fresh。
//   · 前端送來的 id_token 只有在簽章驗過、而且 sub 跟上面相同時，才拿來補 email／姓名等欄位——
//     否則攻擊者可以附一張偽造、填了受害者 email 的 id_token，讓 email 比對把受害者帳號綁給他。
// 回傳 { userinfo } 或 { error, status }。mode=off 時回到舊行為。
function pickSessionUserinfo(
  accessTokenResult: LogtoJwtResult | null,
  fresh: Record<string, unknown> | null,
  idTokenResult: LogtoJwtResult | null,
  unverifiedIdTokenClaims: Record<string, unknown> | null
): { userinfo: Record<string, unknown> } | { error: string; status: number } {
  if (LOGTO_JWT_MODE === "off") {
    const merged = { ...(unverifiedIdTokenClaims || {}), ...(fresh || {}) };
    return merged.sub ? { userinfo: merged } : { error: "invalid_userinfo", status: 401 };
  }
  let sub = "";
  if (accessTokenResult) {
    if (!accessTokenResult.ok) {
      return accessTokenResult.reason === "jwks_unavailable"
        ? { error: "auth_verification_unavailable", status: 503 }
        : { error: "invalid_logto_token", status: 401 };
    }
    sub = String(accessTokenResult.payload.sub || "");
  } else if (fresh && fresh.sub) {
    sub = String(fresh.sub);
  }
  if (!sub) return { error: "invalid_userinfo", status: 401 };
  const verified = idTokenResult && idTokenResult.ok ? idTokenResult.payload : null;
  const usable = verified && verified.sub === sub ? verified : {};
  return { userinfo: { ...usable, ...(fresh || {}), sub } };
}
// <<< logto-jwt-verify

// >>> cors-allowlist（nlc-data、nlc-session、exam-write 三支 index.ts 內此區塊逐字相同；scripts/cors-allowlist.test.mjs 會比對）
// 只對白名單內的網站回 Access-Control-Allow-Origin（#553）。以前直接把請求帶來的 origin 原樣
// 回傳，任何網站都能在瀏覽器裡讀到回應。白名單外的來源不給這個標頭，瀏覽器就會擋下回應。
// 直接內嵌、不 import 共用檔：部署只打包函式自己的資料夾。
//   APP_ALLOWED_ORIGINS（選填，逗號分隔的完整 origin）：臨時再加的網域。
//   APP_ORIGIN（舊設定，選填）：也算在白名單內。
const CORS_FIXED_ORIGINS = [
  "https://bible.newlife.org.tw",
  "https://bible-speed-reading.vercel.app",
  "https://bible-speed-reading-staging.vercel.app",
  // 後台（#550）：照搬的舊管理區塊在後台網域的 iframe 裡，照舊呼叫 nlc-session／nlc-data／exam-write
  "https://bible-speed-reading-admin.vercel.app",
  "https://bible-speed-reading-admin-staging.vercel.app"
];
// Vercel 的 PR 預覽網址：尾巴是本專案的 Vercel 團隊，別人建的專案不會有
const CORS_PREVIEW_ORIGIN_RE = /^https:\/\/bible-speed-reading-[a-z0-9]+-a0970927705-1204s-projects\.vercel\.app$/;
// 本機開發（npx serve dist 等）
const CORS_LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-request-id";
function corsAllowedOrigins(): Set<string> {
  const extra = [Deno.env.get("APP_ORIGIN") || "", ...String(Deno.env.get("APP_ALLOWED_ORIGINS") || "").split(",")]
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...CORS_FIXED_ORIGINS, ...extra]);
}
function corsAllowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (corsAllowedOrigins().has(origin)) return origin;
  if (CORS_PREVIEW_ORIGIN_RE.test(origin) || CORS_LOCAL_ORIGIN_RE.test(origin)) return origin;
  return null;
}
function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = corsAllowOrigin(req.headers.get("origin"));
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // 預檢結果讓瀏覽器快取 2 小時（Chrome 上限）；沒設只快取 5 秒，每次開 App 都多一趟 OPTIONS（#629）
    "Access-Control-Max-Age": "7200",
    "Vary": "Origin"
  };
}
// <<< cors-allowlist

const MAX_BODY_CHARS = 64 * 1024;

// 回應只有固定代碼，不帶任何帳號資料：不能拿這支當探測工具查別人的帳號。
const REFUSAL_STATUS: Record<string, number> = {
  not_eligible: 403,
  same_account: 409,
  challenge_invalid: 409,
  rate_limited: 429,
  busy: 503,
  merge_failed: 500
};

function parseList(value: string | undefined) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type VerifiedAccess = { ok: true; sub: string } | { ok: false; error: string; status: number };

// 一律驗簽章、發行者、到期，不看 NLC_JWT_VERIFY_MODE：合併不可逆，off／report 也不能放行（比照 admin-api）。
// 另外要求是會友 App 發的 token：同一個 Logto 底下其他 App 拿到的 token 不算數。
async function verifyAccessToken(token: string, issuer: string, allowedClients: string[], source: string): Promise<VerifiedAccess> {
  const result = await verifyLogtoJwt(token, issuer, Deno.env.get("NLC_LOGTO_AUDIENCE") || undefined);
  recordLogtoJwt(source, result, token);
  if (!result.ok) {
    return result.reason === "jwks_unavailable"
      ? { ok: false, error: "auth_verification_unavailable", status: 503 }
      : { ok: false, error: "invalid_token", status: 401 };
  }
  const sub = nonEmptyString(result.payload.sub);
  if (!sub || !allowedClients.includes(String(result.payload.client_id || ""))) {
    return { ok: false, error: "invalid_token", status: 401 };
  }
  return { ok: true, sub };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const headers = {
    ...corsHeadersFor(req),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "x-request-id": requestId
  };
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ...body, request_id: requestId }), { status, headers });
  // 不記 sub、profile ID、token：要查原因看 account_recovery_challenges.outcome
  const finish = (status: number, body: Record<string, unknown>, action: string, reason?: string) => {
    console.info(JSON.stringify({ event: "recover_plan_request", request_id: requestId, action, status, code: body.error ?? "ok", reason }));
    return respond(status, body);
  };

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });
  // 瀏覽器一定帶 Origin：白名單外的網站連送出都不接受，不只是讀不到回應（防 CSRF）。
  if (!corsAllowOrigin(req.headers.get("origin"))) return respond(403, { error: "origin_not_allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const issuer = (Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc").replace(/\/+$/, "");
    // 沒設定就全部拒絕（fail closed，比照 admin-api 的 ADMIN_API_ALLOWED_CLIENT_IDS）
    const allowedClients = parseList(Deno.env.get("RECOVER_PLAN_ALLOWED_CLIENT_IDS"));
    if (!supabaseUrl || !serviceRoleKey || allowedClients.length === 0) {
      return respond(503, { error: "recovery_not_configured" });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return respond(413, { error: "payload_too_large" });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) || {};
    } catch {
      return respond(400, { error: "invalid_body" });
    }
    const action = String(body.action || "");
    if (action !== "start" && action !== "complete") return respond(400, { error: "unknown_action" });

    const sourceToken = nonEmptyString(body.source_token);
    if (!sourceToken) return finish(400, { error: "missing_token" }, action);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const source = await verifyAccessToken(sourceToken, issuer, allowedClients, "recover-plan:source");
    if (!source.ok) return finish(source.status, { error: source.error }, action);

    if (action === "start") {
      const nonce = randomNonce();
      const { data, error } = await supabaseAdmin.rpc("account_recovery_start", {
        p_source_sub: source.sub,
        p_nonce_hash: await sha256Hex(nonce)
      });
      if (error) throw new Error(`account_recovery_start: ${error.code || "unknown"}`);
      if (!data?.ok) {
        const code = String(data?.code || "not_eligible");
        return finish(REFUSAL_STATUS[code] ?? 403, { error: code }, action);
      }
      return finish(200, { ok: true, nonce }, action);
    }

    const targetToken = nonEmptyString(body.target_access_token);
    const targetIdToken = nonEmptyString(body.target_id_token);
    if (!targetToken || !targetIdToken) return finish(400, { error: "missing_token" }, action);

    const target = await verifyAccessToken(targetToken, issuer, allowedClients, "recover-plan:target");
    if (!target.ok) return finish(target.status, { error: target.error }, action);

    // id_token 證明這次登入是為了這次找回做的：aud 是會友 App、sub 和 access token 相同，
    // nonce 是 start 發的那一個。sub 一律取自驗過的 token，前端傳的任何 ID 都不看。
    const idResult = await verifyLogtoJwt(targetIdToken, issuer);
    recordLogtoJwt("recover-plan:target_id_token", idResult, targetIdToken);
    if (!idResult.ok) {
      return idResult.reason === "jwks_unavailable"
        ? finish(503, { error: "auth_verification_unavailable" }, action)
        : finish(401, { error: "invalid_token" }, action);
    }
    const audiences = ([] as unknown[]).concat(idResult.payload.aud ?? []).map(String);
    const nonce = nonEmptyString(idResult.payload.nonce);
    if (idResult.payload.sub !== target.sub || !nonce || !audiences.some((aud) => allowedClients.includes(aud))) {
      return finish(401, { error: "invalid_token" }, action);
    }
    // prompt=login 是前端決定的，有人自己組授權網址就能略過重新登入，所以一定要有 auth_time：
    // 沒給就拒絕（reason 只進 log，查 staging 有沒有給時看這裡），比 challenge 舊的由 SQL 擋。
    const rawAuthTime = idResult.payload.auth_time;
    if (typeof rawAuthTime !== "number" || !Number.isFinite(rawAuthTime)) {
      return finish(403, { error: "not_eligible" }, action, "auth_time_missing");
    }
    const authTime = new Date(rawAuthTime * 1000).toISOString();

    // 單獨一句：admin_merge_profiles 會 ALTER TABLE 暫停觸發器，同一句又讀那些表會報 55006。
    const { data, error } = await supabaseAdmin.rpc("account_recovery_merge", {
      p_source_sub: source.sub,
      p_target_sub: target.sub,
      p_nonce_hash: await sha256Hex(nonce),
      p_target_auth_time: authTime,
      p_request_id: requestId
    });
    if (error) throw new Error(`account_recovery_merge: ${error.code || "unknown"}`);
    if (!data?.ok) {
      const code = String(data?.code || "not_eligible");
      return finish(REFUSAL_STATUS[code] ?? 403, { error: code }, action);
    }
    return finish(200, { ok: true }, action);
  } catch (err) {
    // 只記錯誤訊息裡我們自己組的部分，不記請求內容（裡面有 token）
    console.error(JSON.stringify({ event: "recover_plan_failed", request_id: requestId, message: err instanceof Error ? err.message : "unknown" }));
    return respond(500, { error: "recover_plan_failed" });
  }
});
