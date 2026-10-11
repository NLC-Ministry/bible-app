// admin-api 的請求流程（#547）。index.ts 只接上 Deno.serve、Logto 驗證與 Supabase client；
// 相依全部從參數注入，scripts/admin-api.test.mjs 用假的相依跑真的流程。
//
// 順序：來源網域 → token 簽章 → 身分（sub → profile，角色讀資料庫）→ 後台應用程式（client 宣告）
//       → 帳號啟用、角色有能力 → action 存在、能力足夠 → 限流 → 參數 → 一支 SQL 函式。
// 拒絕（client 不對、沒有能力、超過限流）都記一筆 denied 稽核；回應一律 Cache-Control: no-store。
import {
  adminAllowOrigin,
  capabilitiesForRole,
  getAdminAction,
  hasCapabilities,
  isAllowedClient,
  isUuid,
  parseList,
  resolveRequestId
} from "./policy.ts";

export type TokenCheck = { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string };
export type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type AdminApiDeps = {
  env: (key: string) => string | undefined;
  verifyToken: (token: string) => Promise<TokenCheck>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  log?: (line: string) => void;
  now?: () => number;
  randomId?: () => string;
};

type Actor = { id: string; name?: string; role_code: string; role_label?: string | null; is_active?: boolean };

const CORS_ALLOW_HEADERS = "authorization, content-type, x-request-id";

export async function handleAdminRequest(req: Request, deps: AdminApiDeps): Promise<Response> {
  const now = deps.now || (() => Date.now());
  const startedAt = now();
  const requestId = resolveRequestId(req.headers.get("x-request-id"), deps.randomId || (() => crypto.randomUUID()));
  const origin = req.headers.get("origin");
  const allowedOrigin = adminAllowOrigin(
    origin,
    parseList(deps.env("ADMIN_API_ALLOWED_ORIGINS")),
    deps.env("ADMIN_API_ALLOW_LOCALHOST") === "true"
  );
  const logContext: { action: string; actorId: string | null } = { action: "", actorId: null };

  const baseHeaders: Record<string, string> = {
    ...(allowedOrigin ? {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Expose-Headers": "x-request-id, Retry-After",
      "Access-Control-Max-Age": "600"
    } : {}),
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "x-request-id": requestId
  };

  const respond = (status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
    deps.log?.(JSON.stringify({
      event: "admin_api_request",
      request_id: requestId,
      action: logContext.action,
      actor_id: logContext.actorId,
      status,
      ms: Math.max(0, Math.round(now() - startedAt))
    }));
    return new Response(JSON.stringify({ ...body, request_id: requestId }), {
      status,
      headers: { ...baseHeaders, "Content-Type": "application/json", ...extraHeaders }
    });
  };
  const failure = (stage: string, error: { message?: string; code?: string } | null) => {
    deps.log?.(JSON.stringify({ event: "admin_api_error", request_id: requestId, stage, code: error?.code || null, message: error?.message || null }));
    return respond(500, { error: "admin_api_failed" });
  };

  if (origin && !allowedOrigin) return respond(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return respond(401, { error: "missing_authorization" });

  // 後台應用程式沒設定就全部拒絕（fail closed）
  const allowedClients = parseList(deps.env("ADMIN_API_ALLOWED_CLIENT_IDS"));
  if (allowedClients.length === 0) return respond(403, { error: "admin_client_not_configured" });

  const verified = await deps.verifyToken(token);
  if (!verified.ok) {
    return verified.reason === "jwks_unavailable"
      ? respond(503, { error: "auth_verification_unavailable" })
      : respond(401, { error: "invalid_token" });
  }
  const sub = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
  if (!sub) return respond(401, { error: "invalid_token" });

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_e) {
    body = null;
  }
  if (!body) return respond(400, { error: "invalid_body" });
  logContext.action = typeof body.action === "string" ? body.action.slice(0, 60) : "";
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? body.params as Record<string, unknown>
    : {};

  const actorResult = await deps.rpc("admin_api_actor", { p_provider_user_id: sub });
  if (actorResult.error) return failure("actor", actorResult.error);
  const actor = actorResult.data && typeof actorResult.data === "object" ? actorResult.data as Actor : null;
  if (actor?.id) logContext.actorId = actor.id;

  const recordDenied = async (error: string, detail: Record<string, unknown> = {}) => {
    if (!actor?.id) return;
    const { error: auditError } = await deps.rpc("admin_api_record_event", {
      p_action: logContext.action || "unknown",
      p_result: "denied",
      p_actor_id: actor.id,
      p_actor_role: actor.role_code || null,
      p_resource: "admin-api",
      p_target_user_id: isUuid(params.user_id) ? params.user_id : null,
      p_reason: null,
      p_request_id: requestId,
      p_detail: { error, ...detail }
    }).catch((err: unknown) => ({ error: { message: String(err) } }));
    if (auditError) deps.log?.(JSON.stringify({ event: "admin_api_audit_failed", request_id: requestId, message: auditError.message || null }));
  };

  const clientClaim = deps.env("ADMIN_API_CLIENT_CLAIM") || "client_id";
  if (!isAllowedClient(verified.payload, allowedClients, clientClaim)) {
    const claimed = verified.payload[clientClaim];
    await recordDenied("client_not_allowed", { client_id: typeof claimed === "string" ? claimed.slice(0, 100) : null });
    return respond(403, { error: "client_not_allowed" });
  }
  if (!actor?.id) return respond(403, { error: "forbidden" });
  if (actor.is_active === false) {
    await recordDenied("inactive_account");
    return respond(403, { error: "forbidden" });
  }
  const granted = capabilitiesForRole(actor.role_code);
  if (granted.length === 0) {
    await recordDenied("no_capabilities");
    return respond(403, { error: "forbidden" });
  }

  const spec = getAdminAction(body.action);
  if (!spec) return respond(400, { error: "unknown_action" });
  if (!hasCapabilities(granted, spec.capabilities)) {
    await recordDenied("missing_capability", { required: spec.capabilities });
    return respond(403, { error: "forbidden" });
  }

  const limit = await deps.rpc("admin_api_take_rate_limit", {
    p_actor_id: actor.id,
    p_bucket: spec.rateLimit.bucket,
    p_limit: spec.rateLimit.limit,
    p_window_seconds: spec.rateLimit.windowSeconds
  });
  if (limit.error) return failure("rate_limit", limit.error);
  const limitData = (limit.data || {}) as { allowed?: boolean; retry_after?: number };
  if (limitData.allowed !== true) {
    const retryAfter = Math.max(1, Number(limitData.retry_after) || spec.rateLimit.windowSeconds);
    await recordDenied("rate_limited", { bucket: spec.rateLimit.bucket });
    return respond(429, { error: "rate_limited", retry_after: retryAfter }, { "Retry-After": String(retryAfter) });
  }

  const built = spec.buildArgs(params, { actorId: actor.id, actorRole: actor.role_code, requestId });
  if (!built.ok) return respond(400, { error: built.error });

  const result = await deps.rpc(spec.rpc, built.args);
  if (result.error) {
    // SQL 端的參數檢查（RAISE … ERRCODE 22023）照原訊息回 400，例如 query_too_short
    if (result.error.code === "22023") return respond(400, { error: result.error.message || "invalid_params" });
    return failure(spec.rpc, result.error);
  }
  if (spec.notFoundOnNull && (result.data === null || result.data === undefined)) {
    return respond(404, { error: "user_not_found" });
  }
  const data = spec.rpc === "admin_api_bootstrap" && result.data && typeof result.data === "object"
    ? { ...(result.data as Record<string, unknown>), capabilities: granted }
    : result.data;
  return respond(200, { data });
}
