import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://esm.sh/jose@5.9.6";
import { buildInternalErrorBody } from "../_shared/internal-error-body.mjs";

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

// 來源相關的 CORS 標頭由 corsHeadersFor(req) 依白名單決定（見上方 cors-allowlist 區塊）
const corsHeaders = {
  "Content-Type": "application/json"
};

const PROFILE_LOOKUP_SELECT = "id, name, email, phone, nlc_member_id, role_id, great_region_id, pastoral_zone_id, small_group_id, great_region, pastoral_zone, small_group, member_context_synced_at, member_context_contract_version, member_context_membership_lifecycle_state, member_context_placement_state, member_context_placement_workflow_state, member_context_has_required_placement, member_context_required_action, member_context_required_action_url";
// created_at：前端判斷「剛開的新帳號」用（#615，換登入方式提示）。
const PROFILE_RESPONSE_SELECT = "id, created_at, name, email, phone, avatar_url, nlc_member_id, role_id, great_region_id, pastoral_zone_id, small_group_id, great_region, pastoral_zone, small_group, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_contract_version, member_context_membership_lifecycle_state, member_context_placement_state, member_context_placement_workflow_state, member_context_has_required_placement, member_context_required_action, member_context_required_action_url, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments, role_definition:role_definitions!profiles_role_definition_fkey(id, code, label, sort_order, is_assignable, can_manage_plans, can_manage_permissions, scope_type)";

function parseJwt(token: string) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((char) => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function normalizeMemberName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || Array.from(normalized).length > 40) return null;
  if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF\uFFFD]/u.test(normalized)) return null;
  // Common UTF-8 decoded-as-Latin-1 signatures. Preserve the existing name
  // rather than projecting visibly corrupted text into every app surface.
  if (/(?:\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{1,2}|\u00F0\u0178|\u00EF\u00BF\u00BD)/u.test(normalized)) return null;
  return normalized;
}

const LEVEL_DEPTH = {
  great_region: 0,
  pastoral_zone: 1,
  small_group: 2
};

const LEVEL_NAME_HINTS: Record<string, string[]> = {
  great_region: ["大區"],
  pastoral_zone: ["牧區"],
  small_group: ["小組"]
};

// Member Hub uses these as its own "not yet placed" placeholder node names
// (e.g. a real node literally named "未定" in the care-chain/home-path). Left
// as-is they get treated as a real org unit downstream — synced into
// great_regions/pastoral_zones/small_groups, shown in admin stats, and
// counted as "has a region" by every falsy/blank check in the app — instead
// of being handled as "member has no placement yet", which is what they
// actually mean. Normalize them to null at the source so every consumer
// (join-audience gate, registration stats, friendly onboarding prompts)
// treats an unplaced member consistently.
/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
const PLACEHOLDER_ORG_UNIT_NAMES = new Set(["未定"]);

function normalizeOrgUnitName(value: unknown) {
  const trimmed = String(value || "").trim();
  if (!trimmed || PLACEHOLDER_ORG_UNIT_NAMES.has(trimmed)) return null;
  return trimmed;
}

function pickNameByDepth(segments: any[], depth: number) {
  if (!Array.isArray(segments)) return null;
  const match = segments.find((seg) => seg && seg.levelDepth === depth);
  if (match?.name) return normalizeOrgUnitName(match.name);
  const byIndex = segments[depth];
  if (byIndex?.name) return normalizeOrgUnitName(byIndex.name);
  return null;
}

function pickNameByLevelName(segments: any[], hints: string[]) {
  if (!Array.isArray(segments) || !hints.length) return null;
  const match = segments.find((seg) => {
    const label = String(seg?.levelName || "").trim();
    return hints.some((hint) => label.includes(hint));
  });
  return match?.name ? normalizeOrgUnitName(match.name) : null;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromCareChain(careChain: any[]) {
  return {
    great_region: pickNameByDepth(careChain, LEVEL_DEPTH.great_region),
    pastoral_zone: pickNameByDepth(careChain, LEVEL_DEPTH.pastoral_zone),
    small_group: pickNameByDepth(careChain, LEVEL_DEPTH.small_group)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromHomePath(path: any[]) {
  if (!Array.isArray(path)) {
    return { great_region: null, pastoral_zone: null, small_group: null };
  }
  return {
    great_region: pickNameByLevelName(path, LEVEL_NAME_HINTS.great_region) || pickNameByDepth(path, 0),
    pastoral_zone: pickNameByLevelName(path, LEVEL_NAME_HINTS.pastoral_zone) || pickNameByDepth(path, 1),
    small_group: pickNameByLevelName(path, LEVEL_NAME_HINTS.small_group) || pickNameByDepth(path, 2)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromMemberContext(organization: any) {
  const org = organization || {};
  const nodeName = org.placementNodeName ? String(org.placementNodeName).trim() : "";
  const levelName = org.placementLevelName ? String(org.placementLevelName).trim() : "";
  const result: Record<"great_region" | "pastoral_zone" | "small_group", string | null> = {
    great_region: null,
    pastoral_zone: null,
    small_group: null
  };
  if (!nodeName || !levelName) return result;

  for (const [field, hints] of Object.entries(LEVEL_NAME_HINTS)) {
    if (hints.some((hint) => levelName.includes(hint))) {
      result[field as "great_region" | "pastoral_zone" | "small_group"] = normalizeOrgUnitName(nodeName);
      break;
    }
  }
  return result;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
const HUB_OWNED_PROFILE_FIELDS = ["name", "great_region", "pastoral_zone", "small_group"];

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function buildLockedFields(sourceValues: Record<string, string | null>, options: { hubLinked?: boolean } = {}) {
  const locked = Object.entries(sourceValues)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([field]) => field);

  if (options.hubLinked) {
    for (const field of HUB_OWNED_PROFILE_FIELDS) {
      if (!locked.includes(field)) locked.push(field);
    }
  }

  return locked;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function projectOrgFieldsFromHub(
  mergedOrg: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null },
  existingProfile: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null } | null,
  hubLinked: boolean
) {
  const hubOrg = {
    great_region: mergedOrg?.great_region ? String(mergedOrg.great_region).trim() : "",
    pastoral_zone: mergedOrg?.pastoral_zone ? String(mergedOrg.pastoral_zone).trim() : "",
    small_group: mergedOrg?.small_group ? String(mergedOrg.small_group).trim() : ""
  };

  if (hubLinked) return hubOrg;

  const firstValue = (...values: any[]) => {
    for (const value of values) {
      if (value !== null && value !== undefined && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };

  return {
    great_region: firstValue(hubOrg.great_region, existingProfile?.great_region),
    pastoral_zone: firstValue(hubOrg.pastoral_zone, existingProfile?.pastoral_zone),
    small_group: firstValue(hubOrg.small_group, existingProfile?.small_group)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function copyOrgFields(org: any) {
  return {
    great_region: org?.great_region || null,
    pastoral_zone: org?.pastoral_zone || null,
    small_group: org?.small_group || null
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function buildOrgProjectionAudit({
  memberContext,
  organization,
  platformOrgFields,
  placementOrgFields,
  contextOrgFields,
  mergedOrg,
  projectedOrg,
  existingProfile,
  orgResolutionSource,
  memberContextError
}: {
  memberContext: any;
  organization: any;
  platformOrgFields: any;
  placementOrgFields: any;
  contextOrgFields: any;
  mergedOrg: any;
  projectedOrg: any;
  existingProfile: any;
  orgResolutionSource: string;
  memberContextError: string | null;
}) {
  const canonicalPlacement = {
    placementNodeId: organization?.placementNodeId || null,
    placementNodeName: organization?.placementNodeName || null,
    placementLevelName: organization?.placementLevelName || null,
    hasRequiredPlacement: memberContext?.hasRequiredPlacement ?? null
  };

  return {
    source: orgResolutionSource || "none",
    status: projectedOrg?.great_region || projectedOrg?.pastoral_zone || projectedOrg?.small_group ? "projected" : "empty",
    member_context_available: Boolean(memberContext),
    member_context_error: memberContextError || null,
    canonical_placement: canonicalPlacement,
    inputs: {
      platform: copyOrgFields(platformOrgFields),
      placement: copyOrgFields(placementOrgFields),
      context: copyOrgFields(contextOrgFields),
      merged: copyOrgFields(mergedOrg)
    },
    existing_profile: copyOrgFields(existingProfile),
    projected_profile: copyOrgFields(projectedOrg)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
const INVENTED_PROFILE_NAMES = new Set(["教會肢體", "NLC User", "新使用者", "尚未取得姓名", "未命名使用者"]);

function resolveProjectedProfileName({ hubName, existingName }: { hubName: unknown; existingName: unknown }) {
  const hub = String(hubName || "").trim();
  if (hub && !INVENTED_PROFILE_NAMES.has(hub)) return hub;
  const existing = String(existingName || "").trim();
  if (existing && !INVENTED_PROFILE_NAMES.has(existing)) return existing;
  return "";
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function mergeOrgSources(platformOrg: any, placementOrg: any, contextOrganization: any) {
  const contextOrg = orgFromMemberContext(contextOrganization);

  const pick = (field: "great_region" | "pastoral_zone" | "small_group") => {
    if (placementOrg?.[field]) return placementOrg[field];
    if (contextOrg[field]) return contextOrg[field];
    if (platformOrg?.[field]) return platformOrg[field];
    return null;
  };

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

function sanitizeLeadershipIdentity(memberContext: any) {
  const leadership = memberContext?.leadershipIdentity;
  const assignments = Array.isArray(leadership?.assignments)
    ? leadership.assignments
      .filter((assignment: any) => assignment && typeof assignment === "object")
      .map((assignment: any) => ({
        assignmentId: assignment.assignmentId ? String(assignment.assignmentId) : null,
        identityKey: String(assignment.identityKey || ""),
        displayName: String(assignment.displayName || ""),
        displayRank: Number.isFinite(Number(assignment.displayRank)) ? Number(assignment.displayRank) : 0,
        nodeId: String(assignment.nodeId || ""),
        nodeName: String(assignment.nodeName || ""),
        levelName: assignment.levelName ? String(assignment.levelName) : null,
        levelDepth: assignment.levelDepth === null || assignment.levelDepth === undefined
          ? null
          : Number.isFinite(Number(assignment.levelDepth)) ? Number(assignment.levelDepth) : null,
        isPrimary: Boolean(assignment.isPrimary),
      }))
      .filter((assignment: any) => assignment.identityKey)
    : [];

  return {
    displayLabel: leadership?.displayLabel ? String(leadership.displayLabel) : null,
    primaryAssignmentId: leadership?.primaryAssignmentId ? String(leadership.primaryAssignmentId) : null,
    assignments,
  };
}

function projectCanonicalMemberJourney(memberContext: any) {
  const rawVersion = Number(memberContext?.contextContractVersion);
  const text = (value: unknown) => typeof value === "string" ? value.slice(0, 120) : null;
  const rawUrl = typeof memberContext?.requiredActionUrl === "string"
    ? memberContext.requiredActionUrl.slice(0, 2048)
    : null;
  return {
    contractVersion: Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : null,
    membershipLifecycleState: text(memberContext?.membershipLifecycleState),
    placementState: text(memberContext?.placementState),
    placementWorkflowState: text(memberContext?.placementWorkflowState),
    hasRequiredPlacement: typeof memberContext?.hasRequiredPlacement === "boolean"
      ? memberContext.hasRequiredPlacement
      : null,
    requiredAction: text(memberContext?.requiredAction),
    requiredActionUrl: rawUrl,
  };
}

const MEMBER_ROLE_ID = "10000000-0000-4000-8000-000000000001";

function normalizePermissionSignal(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function collectHubPermissionSignals(memberContext: any) {
  const leadership = memberContext?.leadershipIdentity || {};
  const assignments = Array.isArray(leadership.assignments) ? leadership.assignments : [];
  const roles = Array.isArray(memberContext?.roles) ? memberContext.roles : [];
  const membershipApproved = memberContext?.membershipState === "approved";
  const normalizedRoles = roles.map(normalizePermissionSignal).filter(Boolean);
  const satelliteAdminVerified = membershipApproved
    && normalizedRoles.includes("satellite_admin");
  const regularKeys = [
    ...roles,
    memberContext?.primaryRole,
    ...assignments.map((assignment: any) => assignment?.identityKey)
  ].map(normalizePermissionSignal).filter(Boolean)
    .filter(value => value !== "satellite_admin");
  const keys = satelliteAdminVerified ? [...regularKeys, "satellite_admin"] : regularKeys;
  const labels = [
    memberContext?.primaryRole,
    leadership.displayLabel,
    ...assignments.map((assignment: any) => assignment?.displayName)
  ].map(normalizePermissionSignal).filter(Boolean)
    .filter(value => value !== "satellite_admin");
  return {
    keys: [...new Set(keys)],
    labels: [...new Set(labels)],
    primaryRole: normalizePermissionSignal(memberContext?.primaryRole) === "satellite_admin"
      ? ""
      : normalizePermissionSignal(memberContext?.primaryRole),
    satelliteAdminVerified
  };
}

async function resolveSyncedRoleId(
  supabaseAdmin: any,
  memberContext: any,
  existingRoleId: string | null | undefined,
  linkedBy: "identity" | "member_id" | "email" | "none"
) {
  const strong = linkedBy === "identity" || linkedBy === "member_id" || linkedBy === "none";
  if (!strong) return MEMBER_ROLE_ID;
  if (!memberContext) return existingRoleId || MEMBER_ROLE_ID;

  const { data: definitions, error } = await supabaseAdmin
    .from("role_definitions")
    .select("id, code, label, sort_order, hub_permission_keys, hub_permission_labels")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const signals = collectHubPermissionSignals(memberContext);
  const matched = (definitions || [])
    .filter((definition: any) => {
      const keys = (definition.hub_permission_keys || []).map(normalizePermissionSignal);
      const labels = [
        definition.code,
        definition.label,
        ...(definition.hub_permission_labels || [])
      ].map(normalizePermissionSignal);
      const keyMatched = signals.keys.some((value: string) => keys.includes(value));
      const labelMatched = signals.labels.some((value: string) => labels.includes(value));
      const adminLabelMatched = definition.code === "admin"
        && signals.labels.some((l: string) => ["組織架構管理員", "系統管理員", "平台管理員", "admin"].includes(l));
      return keyMatched || adminLabelMatched || labelMatched;
    })
    .sort((left: any, right: any) =>
      Number(left.sort_order ?? 100) - Number(right.sort_order ?? 100)
    )[0];
  return matched?.id || MEMBER_ROLE_ID;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function hasAnyOrgField(org: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null }) {
  return Boolean(org.great_region || org.pastoral_zone || org.small_group);
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function fetchJsonOptional(url: string, init?: RequestInit) {
  try {
    return await fetchJson(url, init);
  } catch (err) {
    console.warn("Optional fetch failed:", url, err);
    return null;
  }
}

async function resolveLocalOrgLinks(
  supabaseAdmin: any,
  profilePayload: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null },
  memberContext: any
) {
  let great_region_id: string | null = null;
  let pastoral_zone_id: string | null = null;
  let small_group_id: string | null = null;
  let orgLinkStatus = memberContext ? "not_linked" : "skipped";
  let orgLinkError: string | null = null;

  const failed = (err: unknown) => {
    orgLinkStatus = "failed";
    orgLinkError = err instanceof Error ? err.message : String(err);
    console.warn("Member Hub org-tree link failed; continuing session sync with text org fields.", err);
    return {
      great_region_id: null,
      pastoral_zone_id: null,
      small_group_id: null,
      orgLinkStatus,
      orgLinkError
    };
  };

  try {
    // Rebuild the organization tree from authoritative Member Hub data as
    // members sign in. A degraded sync must never recreate stale local data.
    if (memberContext && profilePayload.great_region) {
      const { data: regionData, error: regionError } = await supabaseAdmin
        .from("great_regions")
        .upsert(
          { name: profilePayload.great_region },
          { onConflict: "name" }
        )
        .select("id")
        .single();
      if (regionError) return failed(regionError);
      great_region_id = regionData.id;
    }
    if (memberContext && profilePayload.pastoral_zone && great_region_id) {
      const { data: zoneData, error: zoneError } = await supabaseAdmin
        .from("pastoral_zones")
        .upsert(
          {
            name: profilePayload.pastoral_zone,
            great_region_id
          },
          { onConflict: "name,great_region_id" }
        )
        .select("id")
        .single();
      if (zoneError) return failed(zoneError);
      pastoral_zone_id = zoneData.id;
    }
    if (memberContext && profilePayload.small_group && pastoral_zone_id) {
      const { data: groupData, error: groupError } = await supabaseAdmin
        .from("small_groups")
        .upsert(
          {
            name: profilePayload.small_group,
            pastoral_zone_id
          },
          { onConflict: "name,pastoral_zone_id" }
        )
        .select("id")
        .single();
      if (groupError) return failed(groupError);
      small_group_id = groupData.id;
    }

    orgLinkStatus = memberContext && hasAnyOrgField(profilePayload) ? "linked" : orgLinkStatus;
  } catch (err) {
    return failed(err);
  }

  return {
    great_region_id,
    pastoral_zone_id,
    small_group_id,
    orgLinkStatus,
    orgLinkError
  };
}

Deno.serve(async (req: Request) => {
  const localCorsHeaders = {
    ...corsHeaders,
    ...corsHeadersFor(req)
  };

  const jsonResponse = (body: unknown, status = 200) => {
    return new Response(JSON.stringify(body), { status, headers: localCorsHeaders });
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: localCorsHeaders });
  }
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // ── 暫時性伺服器端耗時量測（找 nlc-session 為何要幾秒鐘的瓶頸用，確認完可整批移除）──
  // 宣告在 try 外面，這樣就算中途丟例外，catch 裡也拿得到已經量到的部分耗時。
  const t0 = Date.now();
  const requestId = crypto.randomUUID();
  const timings: [string, number][] = [];
  const mark = (label: string) => timings.push([label, Date.now() - t0]);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const issuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
    const memberHubUrl = trimSlash(Deno.env.get("NLC_MEMBER_HUB_URL") || "https://member.newlife.org.tw");
    const platformApiUrl = trimSlash(
      Deno.env.get("NLC_PLATFORM_API_URL") || "https://platform.newlife.org.tw/platform/v1"
    );

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server_not_configured" }, 500);
    }

    const { access_token: accessToken, id_token: idToken } = await req.json().catch(() => ({}));
    if (!accessToken || typeof accessToken !== "string") {
      return jsonResponse({ error: "missing_access_token" }, 400);
    }

    const bearerHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    let userinfo: any = null;
    let freshUserinfo: any = null;
    // 身分以驗過的 access token 為準（#646，跟 nlc-data 同一套驗證）。
    const accessIsJwt = accessToken.split(".").length === 3;
    let accessTokenResult: LogtoJwtResult | null = null;
    if (accessIsJwt && LOGTO_JWT_MODE !== "off") {
      accessTokenResult = await verifyLogtoJwt(accessToken, issuer, Deno.env.get("NLC_LOGTO_AUDIENCE") || undefined);
      recordLogtoJwt("nlc-session:access_token", accessTokenResult, accessToken);
      mark("access_token_verify");
    }
    // id_token 是前端送來的，未驗證前不可信（見 logto-jwt-verify 區塊的 pickSessionUserinfo）
    let idTokenResult: LogtoJwtResult | null = null;
    let unverifiedIdTokenClaims: any = null;
    if (idToken && typeof idToken === "string") {
      unverifiedIdTokenClaims = parseJwt(idToken);
      if (LOGTO_JWT_MODE !== "off") {
        idTokenResult = await verifyLogtoJwt(idToken, issuer, Deno.env.get("NLC_LOGTO_CLIENT_ID") || undefined);
        recordLogtoJwt("nlc-session:id_token", idTokenResult, idToken);
        mark("id_token_verify");
      }
    }

    // Logto UserInfo 只收不透明 access token；前端登入／續期都帶 resource，拿到的是 JWT，
    // 打 UserInfo 每次都失敗（#646）。只有不透明 token 才去查（本地驗不了）。
    // email／姓名等欄位改從驗過、sub 相同的 id_token 取：續期時 Logto 會發新的 id_token，姓名也優先用會員中心。
    if (!accessIsJwt) {
      try {
        const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
        mark("oidc_discovery");
        const userinfoEndpoint = discovery.userinfo_endpoint;
        if (userinfoEndpoint) {
          const fullUserinfo = await fetchJson(userinfoEndpoint, { headers: bearerHeaders });
          mark("logto_userinfo");
          if (fullUserinfo && fullUserinfo.sub) {
            freshUserinfo = fullUserinfo;
          }
        }
      } catch (err) {
        console.warn("Failed to fetch fresh userinfo from OIDC endpoint:", err);
      }
    }

    const picked = pickSessionUserinfo(accessTokenResult, freshUserinfo, idTokenResult, unverifiedIdTokenClaims);
    if ("error" in picked) {
      return jsonResponse({ error: picked.error }, picked.status);
    }
    userinfo = picked.userinfo;

    let memberContext: any = null;
    let memberContextError: string | null = null;
    try {
      const memberResponse = await fetchJson(`${memberHubUrl}/api/me/context`, {
        headers: bearerHeaders
      });
      mark("member_hub_context");
      const validEnvelope = memberResponse?.ok === true
        && memberResponse.context
        && typeof memberResponse.context === "object"
        && !Array.isArray(memberResponse.context);
      memberContext = validEnvelope ? memberResponse.context : null;
      if (!validEnvelope) {
        memberContextError = "member_hub_context_invalid_envelope";
      }
    } catch (err) {
      console.error("Member Hub context fetch failed:", err);
      memberContextError = `member_hub_context_failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!memberContext) {
      memberContextError = memberContextError || "member_hub_context_missing";
    }

    const memberProfile = memberContext?.profile || {};
    const memberIdentity = memberContext?.identity || {};
    const organization = memberContext?.organization || {};
    const leadershipIdentity = sanitizeLeadershipIdentity(memberContext);
    const canonicalJourney = projectCanonicalMemberJourney(memberContext);
    const memberId = memberIdentity.memberId || null;
    const membershipStatus = memberProfile.membershipStatus || null;

    let platformOrganization: any = null;
    let platformOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };

    if (memberId) {
      const platformResponse = await fetchJsonOptional(
        `${platformApiUrl}/members/${encodeURIComponent(memberId)}/organization`,
        { headers: bearerHeaders }
      );
      platformOrganization = platformResponse?.organization || null;
      if (platformOrganization?.careChain) {
        platformOrgFields = orgFromCareChain(platformOrganization.careChain);
      }
      mark("platform_org");
    }

    let placementOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };

    const contextOrgFields = orgFromMemberContext(organization);
    const mergedOrg = mergeOrgSources(platformOrgFields, placementOrgFields, organization);
    const orgResolutionSource = hasAnyOrgField(placementOrgFields)
      ? "member_hub_org_placement"
      : (hasAnyOrgField(contextOrgFields) ? "member_hub_context" : (hasAnyOrgField(platformOrgFields) ? "platform_organization" : "none"));

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: existingIdentity, error: identityError } = await supabaseAdmin
      .from("user_identities")
      .select("profile_id")
      .eq("provider", "logto")
      .eq("provider_user_id", userinfo.sub)
      .maybeSingle();

    if (identityError) throw identityError;
    mark("identity_lookup");

    let profileId = existingIdentity?.profile_id || null;
    let existingProfile: any = null;
    // How the existing profile was matched — governs whether Hub permission labels may be trusted.
    let linkSource: "identity" | "member_id" | "email" | "none" = profileId ? "identity" : "none";

    const lookupEmail = userinfo.email || memberIdentity.email || null;

    // Strong link: match an existing profile by the authenticated NLC member id.
    if (!profileId && memberId) {
      const { data: profileByMember, error: memberLookupError } = await supabaseAdmin
        .from("profiles")
        .select(PROFILE_LOOKUP_SELECT)
        .eq("nlc_member_id", memberId)
        .maybeSingle();
      if (memberLookupError) throw memberLookupError;
      if (profileByMember) {
        existingProfile = profileByMember;
        profileId = profileByMember.id;
        linkSource = "member_id";
      }
    }

    // Weak link: match by email only. NLC identity can be phone-primary, so the token
    // email may not be caller-owned; role UUID synchronization refuses to escalate privilege here.
    if (!profileId && lookupEmail) {
      const { data: profileByEmail, error: profileLookupError } = await supabaseAdmin
        .from("profiles")
        .select(PROFILE_LOOKUP_SELECT)
        .ilike("email", lookupEmail)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      if (profileByEmail) {
        existingProfile = profileByEmail;
        profileId = profileByEmail.id;
        linkSource = "email";
      }
    }

    if (profileId && !existingProfile) {
      const { data: profileById, error: profileByIdError } = await supabaseAdmin
        .from("profiles")
        .select(PROFILE_LOOKUP_SELECT)
        .eq("id", profileId)
        .maybeSingle();
      if (profileByIdError) throw profileByIdError;
      existingProfile = profileById || null;
    }
    mark("profile_lookup");


    if (!profileId) {
      // Guard against silently orphaning existing user data.
      // If userinfo.sub is known (non-empty), double-check whether this sub has ANY
      // historical identity record (including soft-deleted / mislinked ones).
      // If a record exists but profile lookup failed above, something is wrong —
      // return an error so the user can re-authenticate rather than silently creating
      // a new empty profile that loses all reading logs and team records.
      if (userinfo?.sub) {
        const { data: anyIdentity } = await supabaseAdmin
          .from("user_identities")
          .select("profile_id, provider_user_id")
          .eq("provider_user_id", userinfo.sub)
          .limit(1)
          .maybeSingle();

        if (anyIdentity) {
          // The sub is known but we couldn't load the linked profile — refuse to create
          // a new UUID to avoid data loss. Return a recoverable error.
          console.error("nlc-session: sub exists in user_identities but profile lookup failed", {
            sub: userinfo.sub,
            linked_profile_id: anyIdentity.profile_id
          });
          return jsonResponse({
            error: "profile_resolution_failed",
            message: "帳號資料暫時無法讀取，請重新登入。如問題持續，請聯絡教會支援。",
            sub_known: true
          }, 409);
        }
      }
      // Confirmed new user (sub never seen before) — safe to create a fresh profile.
      profileId = crypto.randomUUID();
    }


    const syncedRoleId = await resolveSyncedRoleId(supabaseAdmin, memberContext, existingProfile?.role_id, linkSource);
    mark("role_resolution");

    // Member Hub is canonical only when the context endpoint was reachable for this session.
    const hubLinked = !!memberContext;
    const projectedOrg = projectOrgFieldsFromHub(mergedOrg, existingProfile, hubLinked);
    const orgProjectionAudit = buildOrgProjectionAudit({
      memberContext,
      organization,
      platformOrgFields,
      placementOrgFields,
      contextOrgFields,
      mergedOrg,
      projectedOrg,
      existingProfile,
      orgResolutionSource,
      memberContextError
    });
    console.info("nlc-session org projection", JSON.stringify(orgProjectionAudit));

    const canonicalName = [
      memberProfile.displayName,
      freshUserinfo?.name,
      freshUserinfo?.preferred_username,
      memberIdentity.username,
      ...(!existingProfile ? [userinfo.name, userinfo.preferred_username] : [])
    ].map(normalizeMemberName).find(Boolean) || null;

    // Standard OIDC `phone` scope claim — the Logto account's own phone
    // identity, not Member Hub's separate member:read.contact contact info.
    const phoneNumber = typeof userinfo.phone_number === "string" && userinfo.phone_number.trim()
      ? userinfo.phone_number.trim()
      : null;

    const sourceValues: Record<string, string | null> = {
      email: lookupEmail,
      name: canonicalName,
      phone: phoneNumber,
      great_region: projectedOrg.great_region || null,
      pastoral_zone: projectedOrg.pastoral_zone || null,
      small_group: projectedOrg.small_group || null,
    };

    const lockedFields = buildLockedFields(sourceValues, { hubLinked });
    if (!lockedFields.includes("role_id")) lockedFields.push("role_id");

    const firstValue = (...values: any[]) => {
      for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim() !== "") return value;
      }
      return "";
    };

    const nowIso = new Date().toISOString();
    const memberContextSyncStatus = memberContext ? "success" : "degraded";
    const nextProfileName = resolveProjectedProfileName({
      hubName: sourceValues.name,
      existingName: existingProfile?.name,
    });
    const profilePayload: Record<string, any> = {
      id: profileId,
      name: nextProfileName,
      email: firstValue(sourceValues.email, existingProfile?.email, null) || null,
      phone: firstValue(sourceValues.phone, existingProfile?.phone, null) || null,
      great_region: projectedOrg.great_region,
      pastoral_zone: projectedOrg.pastoral_zone,
      small_group: projectedOrg.small_group,
      role_id: syncedRoleId,
      is_active: true,
      last_seen_at: nowIso,
      member_context_synced_at: memberContext ? nowIso : (existingProfile?.member_context_synced_at || null),
      member_context_sync_attempted_at: nowIso,
      member_context_sync_status: memberContextSyncStatus,
      member_context_sync_error: memberContextError,
      ...(memberContext ? {
        member_context_contract_version: canonicalJourney.contractVersion,
        member_context_membership_lifecycle_state: canonicalJourney.membershipLifecycleState,
        member_context_placement_state: canonicalJourney.placementState,
        member_context_placement_workflow_state: canonicalJourney.placementWorkflowState,
        member_context_has_required_placement: canonicalJourney.hasRequiredPlacement,
        member_context_required_action: canonicalJourney.requiredAction,
        member_context_required_action_url: canonicalJourney.requiredActionUrl,
        member_context_leadership_display_label: leadershipIdentity.displayLabel,
        member_context_leadership_primary_assignment_id: leadershipIdentity.primaryAssignmentId,
        member_context_leadership_assignments: leadershipIdentity.assignments,
      } : {}),
      updated_at: nowIso
    };

    if (memberId) {
      profilePayload.nlc_member_id = memberId;
    } else if (existingProfile?.nlc_member_id) {
      profilePayload.nlc_member_id = existingProfile.nlc_member_id;
    }

    const {
      great_region_id,
      pastoral_zone_id,
      small_group_id,
      orgLinkStatus,
      orgLinkError
    } = await resolveLocalOrgLinks(supabaseAdmin, profilePayload, memberContext);
    mark("org_links");

    profilePayload.great_region_id = (great_region_id || (profilePayload.great_region === existingProfile?.great_region ? existingProfile?.great_region_id : null)) || null;
    profilePayload.pastoral_zone_id = (pastoral_zone_id || (profilePayload.pastoral_zone === existingProfile?.pastoral_zone ? existingProfile?.pastoral_zone_id : null)) || null;
    profilePayload.small_group_id = (small_group_id || (profilePayload.small_group === existingProfile?.small_group ? existingProfile?.small_group_id : null)) || null;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" })
      .select(PROFILE_RESPONSE_SELECT)
      .single();

    if (profileError) throw profileError;
    mark("profile_upsert");

    // Prune only after an authoritative Hub projection has been committed.
    // The database function applies a grace period so concurrent sessions can
    // finish linking nodes they have just upserted.
    let orgCleanupStatus = memberContext ? "pending" : "skipped";
    let orgCleanupResult: any = null;
    let orgCleanupError: string | null = null;
    if (memberContext) {
      const { data: cleanupData, error: cleanupError } = await supabaseAdmin
        .rpc("prune_orphaned_church_org_nodes", {});
      if (cleanupError) {
        orgCleanupStatus = "failed";
        orgCleanupError = cleanupError.message || String(cleanupError);
        console.warn("Orphaned organization cleanup failed; continuing session sync.", cleanupError);
      } else {
        orgCleanupStatus = "success";
        orgCleanupResult = cleanupData;
      }
    }
    mark("org_prune");

    const { error: clearPrimaryError } = await supabaseAdmin
      .from("user_identities")
      .update({ is_primary: false, updated_at: nowIso })
      .eq("profile_id", profileId);

    if (clearPrimaryError) throw clearPrimaryError;
    mark("clear_primary");

    const identityMetadata: Record<string, unknown> = {
      issuer,
      userinfo,
      member_context: memberContext
    };
    identityMetadata.org_resolution_source = orgResolutionSource;
    identityMetadata.org_resolution = {
      source: orgResolutionSource,
      placement_available: hasAnyOrgField(placementOrgFields),
      platform_available: hasAnyOrgField(platformOrgFields),
      context_available: hasAnyOrgField(contextOrgFields),
      org_link_status: orgLinkStatus,
      org_link_error: orgLinkError,
      org_cleanup_status: orgCleanupStatus,
      org_cleanup_result: orgCleanupResult,
      org_cleanup_error: orgCleanupError
    };
    identityMetadata.org_projection_audit = orgProjectionAudit;
    const rolePermissionSignals = collectHubPermissionSignals(memberContext);
    const roleResolutionAudit = {
      status: linkSource === "email"
        ? "weak_link_member"
        : (memberContext ? "member_hub_resolved" : "degraded_preserved"),
      link_source: linkSource,
      role_id: profile.role_id,
      role_code: profile.role_definition?.code || null,
      permission_keys: rolePermissionSignals.keys,
      permission_labels: rolePermissionSignals.labels,
      satellite_admin_verified: rolePermissionSignals.satelliteAdminVerified,
      member_context_envelope_valid: Boolean(memberContext)
    };
    identityMetadata.role_resolution = roleResolutionAudit;
    console.info("nlc-session role projection", JSON.stringify(roleResolutionAudit));
    if (memberContextError) {
      identityMetadata.member_context_error = memberContextError;
    }
    if (platformOrganization) {
      identityMetadata.platform_organization = platformOrganization;
    }
    if (membershipStatus) {
      identityMetadata.membership_status = membershipStatus;
    }

    const { error: upsertIdentityError } = await supabaseAdmin
      .from("user_identities")
      .upsert({
        profile_id: profileId,
        provider: "logto",
        provider_user_id: userinfo.sub,
        email: profilePayload.email,
        display_name: profilePayload.name,
        is_primary: true,
        metadata: identityMetadata,
        last_seen_at: nowIso,
        updated_at: nowIso
      }, { onConflict: "provider,provider_user_id" });

    if (upsertIdentityError) throw upsertIdentityError;
    mark("identity_upsert");

    console.info("nlc-session timing", JSON.stringify({ total_ms: Date.now() - t0, steps: timings }));
    return jsonResponse({
      edge_session: true,
      profile,
      locked_fields: lockedFields,
      membership_status: membershipStatus,
      member_context_error: memberContextError,
      org_projection_debug: orgProjectionAudit,
      role_resolution_debug: roleResolutionAudit
    });
  } catch (err) {
    // Log full detail server-side only — never return a stack trace to the
    // client. A stack trace can reveal internal file paths, function names,
    // and dependency versions to anyone who can trigger this failure path.
    console.error("nlc-session failed:", requestId, err);
    console.info("nlc-session timing (failed)", JSON.stringify({ total_ms: Date.now() - t0, steps: timings }));
    // 對外只回固定訊息 + request id；err.message 可能帶出內部錯誤字串（#606）。
    return jsonResponse(buildInternalErrorBody("nlc_session_failed", requestId), 500);
  }
});
