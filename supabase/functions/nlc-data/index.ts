import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRetiredPlanRequest } from "./retired-resources.ts";
import {
  PLAN_READING_LOG_DIGEST_RPC,
  PLAN_STATS_ROSTER_RPC,
  buildPlanReadingLogDigestArgs,
  buildPlanStatsRosterArgs,
} from "./plan-stats-scope.ts";
import {
  AUDITED_ADMIN_RPCS,
  buildRpcAuditEvent,
  buildTableWriteAuditEvent,
  classifyFailure,
  diffFields,
  isAuditedTableWrite,
  resolveRequestId,
  singleRowKey,
  type AdminAuditEvent,
} from "./admin-audit.ts";
import { buildRequestLogLine, requestLogTarget, sanitizeReportInsertPayload } from "./request-diagnostics.ts";
import * as jose from "https://esm.sh/jose@5.9.6";

// >>> logto-jwt-verify（nlc-data 與 nlc-session 兩支 index.ts 內此區塊逐字相同；scripts/logto-jwt-verify.test.mjs 會比對）
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


// >>> exam-write-token（nlc-data 與 exam-write 兩支 index.ts 內此區塊逐字相同；scripts/exam-write-path.test.mjs 會比對）
// 大測驗「作答專用寫入憑證」：nlc-data 簽發、exam-write 驗證。直接內嵌、不 import 共用檔，
// 因為部署只會打包函式自己的資料夾（../_shared 會 Module not found）。
// token = "v1." + base64url(HMAC-SHA256(EXAM_WRITE_SECRET, "exam-write:v1:<attemptId>:<userId>"))
// · 無狀態：不存 DB，驗證時用 attempt 的 user_id 重算比對；綁定「這份作答 + 這個人」。
// · 沒有自己的到期時間——有效範圍由 DB 函式把關（exam_save_progress 只收 in_progress 且未逾
//   截止 + 120 秒；exam_submit_attempt 只在 in_progress 時寫入），送出後就沒有可做的事。
// · 換 EXAM_WRITE_SECRET＝所有已簽發憑證立即失效，前端自動退回 nlc-data 路徑。
const examWriteEncoder = new TextEncoder();
function examWriteBase64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function examWriteHmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", examWriteEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, examWriteEncoder.encode(message)));
}
function examWriteTimingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signExamWriteToken(secret: string, attemptId: string, userId: string): Promise<string> {
  if (!secret || !attemptId || !userId) throw new Error("exam_write_token_args_missing");
  return "v1." + examWriteBase64Url(await examWriteHmac(secret, `exam-write:v1:${attemptId}:${userId}`));
}
async function verifyExamWriteToken(
  secret: string, attemptId: string, userId: string, token: unknown
): Promise<boolean> {
  if (!secret || !attemptId || !userId || typeof token !== "string" || !token.startsWith("v1.")) return false;
  const expected = await signExamWriteToken(secret, attemptId, userId);
  return examWriteTimingSafeEqual(expected, token);
}
// <<< exam-write-token

// >>> cors-allowlist（nlc-data、nlc-session、exam-write 三支 index.ts 內此區塊逐字相同；scripts/cors-allowlist.test.mjs 會比對）
// 只對白名單內的網站回 Access-Control-Allow-Origin（#553）。以前直接把請求帶來的 origin 原樣
// 回傳，任何網站都能在瀏覽器裡讀到回應。白名單外的來源不給這個標頭，瀏覽器就會擋下回應。
// 直接內嵌、不 import 共用檔：部署只打包函式自己的資料夾。
//   APP_ALLOWED_ORIGINS（選填，逗號分隔的完整 origin）：臨時再加的網域。
//   APP_ORIGIN（舊設定，選填）：也算在白名單內。
const CORS_FIXED_ORIGINS = [
  "https://bible.newlife.org.tw",
  "https://bible-speed-reading.vercel.app",
  "https://bible-speed-reading-staging.vercel.app"
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
    "Vary": "Origin"
  };
}
// <<< cors-allowlist

// 來源相關的 CORS 標頭由 corsHeadersFor(req) 依白名單決定（見上方 cors-allowlist 區塊）
const corsHeaders = {
  "Content-Type": "application/json"
};

// 每個 select／batch 請求最多回幾筆（.range() 跨度與 .limit() 共用）。等於 PostgREST
// 預設 max rows。以前是 200（#399）；前端分頁以實際筆數前進，新舊上限都相容。
const MAX_ROWS_PER_REQUEST = 1000;

const READ_TABLES = new Set([
  "great_regions",
  "pastoral_zones",
  "small_groups",
  "global_plans",
  "church_announcements",
  "profiles",
  "reading_plans",
  "reading_logs",
  "devotional_notes",
  "devotional_likes",
  "devotional_comments",
  "verse_likes",
  // profile_identity_overview / member_reading_summary removed 2026-09-16:
  // both exposed every member's row (profile_identity_overview includes
  // email, Logto provider_user_id, last_seen_at) with zero forced scope in
  // applyForcedScope — any authenticated member could SELECT the whole
  // church directory. Neither view is referenced anywhere in js/ or any
  // RPC; this was pure unused attack surface, so it's removed rather than
  // scoped. If a real admin feature needs this data later, add a dedicated,
  // role-checked action for it instead of reopening generic select access.
  //
  // view_pastoral_zone_stats / view_small_group_stats also removed
  // 2026-09-16: the views themselves never existed in the active schema
  // (only in supabase/migrations_legacy, never carried into
  // 0001_clean_schema.sql), and the only two frontend call sites were
  // already-dead code (js/modules/home.js's renderPastoralZoneRankingList,
  // whose DOM container doesn't exist, and js/modules/plan.js's
  // updateStatsView cluster, gated behind a "stats-view" tab the current tab
  // bar has no button for) — both removed in the same change. The equivalent
  // ranking data is already computed live via renderOrgStatsTree /
  // computeOrgUnitStats in js/modules/plan.js.
  "care_reminders",
  "app_feature_settings",
  "role_definitions",
  "highlights",
  "reading_teams",
  "reading_team_members",
  "verse_notes",
  "passage_commentary",
  "commentary_terms",
  // 檢視表（#470）：只列已發布內容的 (book, chapter)，閱讀器換章前查。
  "commentary_chapter_index"
]);
const USER_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes", "highlights"]);
const ADMIN_WRITE_TABLES = new Set(["great_regions", "pastoral_zones", "small_groups", "global_plans", "church_announcements", "profiles", "app_feature_settings"]);
// Unlike ADMIN_WRITE_TABLES (admin or any plan manager), only system admins
// may write these.
const ADMIN_ONLY_WRITE_TABLES = new Set(["passage_commentary", "commentary_terms"]);
const OWN_WRITE_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments", "care_reminders", "highlights", "verse_notes"]);
// care_reminders: the generic OWN_WRITE_TABLES path below has no per-action
// distinction, so being in that set would let ANY authenticated member
// insert/delete rows on this table directly (not just update their own) —
// insert isn't even payload-protected here (see forceUserPayload's
// writeProtected list), so it could forge an arbitrary sender_id/recipient_id
// pastoral care message, and delete has no forced-scope branch in
// applyForcedScope at all, so it could wipe any/all rows. The only
// legitimate self-service action on this table is a recipient acknowledging
// their own reminder (UPDATE, scoped to recipient_id in applyForcedScope);
// creating one must go through the dedicated `send_care_reminder` action,
// which enforces the sender's pastoral role/org scope and forces sender_id
// server-side. Restrict the generic path to that one action.
const OWN_WRITE_UPDATE_ONLY_TABLES = new Set(["care_reminders"]);
const TEAM_RPC_FUNCTIONS = new Set([
  "get_my_reading_team",
  "get_reading_team_registration_overview",
  "get_reading_team_statistics",
  "get_reading_team_leaderboards",
  "get_pastoral_zone_leaderboard",
  "get_personal_plan_ranking_summary",
  "create_reading_team",
  "join_reading_team_by_code",
  "get_reading_team_carryover_offer",
  "carry_reading_teams_to_stage",
  "leave_reading_team",
  "remove_reading_team_member",
  "disband_reading_team",
  "rename_reading_team",
  "transfer_reading_team_captain",
  "send_reading_team_reminder",
  "get_unjoined_plan_members",
  "get_joined_plan_members",
  "send_plan_join_invitation",
  "get_admin_member_team_placements"
]);
const PLAN_MANAGEMENT_RPC_FUNCTIONS = new Set([
  "get_reading_team_registration_overview",
  "get_unjoined_plan_members",
  "get_joined_plan_members",
  "send_plan_join_invitation",
  "get_admin_member_team_placements"
]);
const ADMIN_RPC_FUNCTIONS = new Set([
  "get_admin_registration_statistics",
  "set_profile_managed_scopes",
  "create_region_stage_cohort"
]);
const QUIZ_RPC_FUNCTIONS = new Set([
  // 發佈只剩每天 00:00 的自動發佈（service role，#306）；審核、換版、手動／排程發佈
  // 的 RPC 已在 #308 移除。
  "get_daily_quiz_dashboard",
  "submit_daily_quiz",
  "get_quiz_notifications",
  "mark_quiz_notifications_read",
  // 0185：逐題送出＋最後結算，取代「整份一次送出」；submit_daily_quiz 保留
  // 給還沒切過去的舊前端用，兩者並存。
  "daily_quiz_submit_answer",
  "daily_quiz_finalize_attempt",
  // 0186：後台結果統計（唯讀）；權限檢查在 SQL 端用 can_manage_quiz_group。
  // 0196 簡化：只回參與率＋完整名單，PR/排行榜公布整套已移除。
  "daily_quiz_get_stats",
  // 0188：會友端「我的測驗」查詢；0196 起不再有 PR，只有自己的分數與作答時間。
  "daily_quiz_get_my_results",
  // 自動發佈 run_daily_quiz_schedule_sweep 不在這裡——只有排程 Edge Function
  // 用 service-role client 直接呼叫，前端永遠拿不到。
  // #306：自動發佈規則（讀／寫都只給系統管理員，SQL 端檢查）
  "get_daily_quiz_auto_publish_rule",
  "set_daily_quiz_auto_publish_rule",
  // #307：7 天日曆與每一天的設定（只給系統管理員，SQL 端檢查）
  "get_daily_quiz_calendar",
  "set_daily_quiz_day_skip",
  "set_daily_quiz_day_custom",
  "swap_daily_quiz_version"
]);
// 速讀「大測驗」(migration 0096). Gated by the speed_reading_exam feature flag;
// authoring/grading RPCs additionally require an admin/pastor profile.
const EXAM_RPC_FUNCTIONS = new Set([
  "exam_upsert_paper",
  "exam_upsert_question",
  "exam_delete_question",
  "exam_get_paper_admin",
  "exam_save_announcement",
  "exam_publish",
  "exam_set_status",
  "exam_reset_attempts",
  "exam_reset_my_rehearsal",
  "exam_set_practice_enabled",
  "exam_set_answer_explanation_visible",
  "exam_set_question_explanation",
  "exam_recompute_scores",
  "exam_set_answer_key",
  "exam_publish_results",
  "exam_finalize_expired",
  "exam_start_practice",
  "exam_mark_practice_complete",
  "exam_get_practice_records",
  "exam_get_practice_detail",
  "exam_home_banner",
  "exam_home_exams",
  "exam_my_papers",
  "exam_get_for_attempt",
  "exam_start_attempt",
  "exam_save_progress",
  "exam_submit_attempt",
  "exam_backfill_shortanswer",
  "exam_get_my_result",
  "exam_get_grading_queue",
  "exam_grade_answer",
  "exam_grade_answers_batch",
  "exam_get_stats",
  "exam_export_answers",
  // 線上簡答批改頁（grade.html，migration 0146）。指派兩支要 admin；
  // 批改五支的閘門是「這個 attempt/paper 指派給我」，在 SQL 端做，不需 admin 角色。
  "exam_list_gradable_attempts",
  "exam_search_grader_candidates",
  "exam_assign_attempts",
  "exam_get_grading_workspace",
  "exam_get_grading_sheet",
  "exam_save_grading_draft",
  "exam_grade_attempt",
  "exam_grade_attempts_bulk",
  "exam_reset_attempt_grading",
  "get_exam_notifications",
  "mark_exam_notifications_read"
]);
const EXAM_ADMIN_RPC_FUNCTIONS = new Set([
  "exam_upsert_paper",
  "exam_upsert_question",
  "exam_delete_question",
  "exam_get_paper_admin",
  "exam_save_announcement",
  "exam_publish",
  "exam_set_status",
  "exam_reset_attempts",
  "exam_reset_my_rehearsal",
  "exam_set_practice_enabled",
  "exam_set_answer_explanation_visible",
  "exam_set_question_explanation",
  "exam_recompute_scores",
  "exam_set_answer_key",
  "exam_publish_results",
  "exam_finalize_expired",
  "exam_get_grading_queue",
  "exam_grade_answer",
  "exam_grade_answers_batch",
  // 線上簡答批改：指派清單／搜尋批改人員／指派動作要 admin/pastor（0146）
  "exam_list_gradable_attempts",
  "exam_search_grader_candidates",
  "exam_assign_attempts"
  // exam_get_stats 不在此：它自己做角色 + 委派範圍檢查（migration 0121），
  // 開放給 great_zone_leader / zone_leader / group_leader 看自己範圍的統計。
  // exam_get_grading_workspace / _sheet / _save_grading_draft / _grade_attempt /
  // _grade_attempts_bulk 也不在此：閘門是「指派給我」，批改人員不必是 admin。
]);
const PROFILE_SELECT = "id, name, email, avatar_url, great_region, pastoral_zone, small_group, role_id, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_contract_version, member_context_membership_lifecycle_state, member_context_placement_state, member_context_placement_workflow_state, member_context_has_required_placement, member_context_required_action, member_context_required_action_url, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments, role_definition:role_definitions(id, code, label, sort_order, is_assignable, can_manage_plans, can_manage_permissions, scope_type)";
// Missing the member_context_contract_version/membership_lifecycle_state/
// placement_* / required_action* columns — used as a retry target wherever a
// query against PROFILE_SELECT fails, so a database that hasn't run the
// member-journey migration yet degrades instead of hard-failing.
const PROFILE_SELECT_LEGACY = "id, name, email, avatar_url, great_region, pastoral_zone, small_group, role_id, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments, role_definition:role_definitions(id, code, label, sort_order, is_assignable, can_manage_plans, can_manage_permissions, scope_type)";
// 回報對話串（issue_reports 工單 + issue_report_messages，migration 0153）。
// 每支 RPC 自己在 SQL 端用 _issue_actor()/_issue_is_admin() 做「本人或 admin」授權；
// 這裡只需注入 p_actor_id。碰 Storage 的（附件上傳/簽名網址/刪物件）不是 RPC，
// 走下面的 issue_thread_get / issue_thread_post / issue_thread_attachment_delete action。
const ISSUE_RPC_FUNCTIONS = new Set([
  "issue_thread_mark_read",
  "issue_thread_unread_summary",
  "issue_my_reports",
  "issue_admin_thread_list",
  "issue_admin_set_status"
]);
const ISSUE_ADMIN_RPC_FUNCTIONS = new Set([
  "issue_admin_thread_list",
  "issue_admin_set_status"
]);
// 首頁「快問快答」（lightning quiz，migration 0202；每題各自發布／鎖定見 0211）。
// 會友端 RPC 在 SQL 端只看已發布的活動；admin_* 系列自己用
// _lightning_quiz_actor_is_admin() 檢查 admin。這裡只需注入 p_actor_id。
const LIGHTNING_QUIZ_RPC_FUNCTIONS = new Set([
  "get_todays_lightning_quiz",
  "start_lightning_quiz_attempt",
  "submit_lightning_quiz_attempt",
  "get_my_lightning_quiz_history",
  "admin_list_lightning_quiz_questions",
  "admin_upsert_lightning_quiz_question",
  "admin_set_lightning_quiz_status",
  "admin_delete_lightning_quiz_question",
  "admin_get_lightning_quiz_trend",
  "admin_get_lightning_quiz_weeks",
  "admin_get_lightning_quiz_week",
  "admin_get_lightning_quiz_results",
  "admin_get_lightning_quiz_settings",
  "admin_save_lightning_quiz_settings",
  "admin_import_lightning_quiz_questions",
  // 每週前三名公布到首頁（#429）
  "get_lightning_quiz_week_ranking",
  "admin_get_lightning_quiz_week_ranking",
  "admin_publish_lightning_quiz_week_ranking",
  "admin_revoke_lightning_quiz_week_ranking",
  // 英雄榜兌換券（#445）：會友端只碰呼叫者自己的券（SQL 端以注入的 p_actor_id 過濾）
  "get_my_lightning_quiz_vouchers",
  "redeem_my_lightning_quiz_voucher",
  "admin_list_lightning_quiz_vouchers",
  "admin_set_lightning_quiz_voucher_redeemed"
]);
// 個人統計「累積閱讀章數」由伺服器算（#348）；已關閉計畫的已讀章節摘要（#474）。
// 只算呼叫者自己的紀錄，所以一定要注入 p_actor_id，SQL 端不接受前端傳入的 user id。
const READING_STATS_RPC_FUNCTIONS = new Set([
  "get_my_plan_chapter_total",
  "get_my_reading_log_digest"
]);
// 管理面板「讀經使用率」（#452 DAU／WAU／MAU、#453 L7、#454 星期 × 小時熱度圖）。
// SQL 端自己檢查呼叫者是系統管理員（role = admin），這裡只注入 p_actor_id。
const READING_ACTIVITY_RPC_FUNCTIONS = new Set([
  "admin_get_reading_activity",
  "admin_get_reading_activity_l7",
  "admin_get_reading_hour_heatmap"
]);
// 計畫統計／組員總覽的精簡打卡紀錄（#394）和一次回傳的名單（#397）：
// PLAN_READING_LOG_DIGEST_RPC、PLAN_STATS_ROSTER_RPC 定義在 plan-stats-scope.ts。
// 可見範圍跟 profiles／reading_logs select 一樣由 getVisibleProfileIds 決定（每個請求只算一次），
// p_whole_church、p_visible_ids、p_actor_id 一律由這裡覆寫。
// 經文注釋審核（#471）：審核者只能審被指派的書卷，指派／總覽／重新送審／最終發布只限
// 系統管理員——都由 SQL 端依注入的 p_actor_id 檢查（沒有指派就拒絕），這裡只注入 p_actor_id。
const COMMENTARY_REVIEW_RPC_FUNCTIONS = new Set([
  "get_my_commentary_reviews",
  "review_commentary",
  "get_commentary_review_overview",
  "set_commentary_reviewers",
  "resubmit_commentary",
  "publish_approved_commentary",
  "get_commentary_review_notifications",
  "mark_commentary_review_notifications_read"
]);
// 管理頁「使用者基本資料」「權限管理」共用的名單（#395）。全教會範圍才放行；
// 報名／隊伍明細只給 admin（使用者基本資料是 admin 限定）。參數一律由這裡注入。
const ADMIN_USER_DIRECTORY_RPC = "get_admin_user_directory";
const RPC_FUNCTIONS = new Set([
  "increment_likes",
  "decrement_likes",
  "publish_global_plan_rules",
  "get_user_rankings",
  "get_org_structure_tree",
  ...TEAM_RPC_FUNCTIONS,
  ...ADMIN_RPC_FUNCTIONS,
  ...QUIZ_RPC_FUNCTIONS,
  ...EXAM_RPC_FUNCTIONS,
  ...LIGHTNING_QUIZ_RPC_FUNCTIONS,
  ...READING_STATS_RPC_FUNCTIONS,
  ...READING_ACTIVITY_RPC_FUNCTIONS,
  ...COMMENTARY_REVIEW_RPC_FUNCTIONS,
  PLAN_READING_LOG_DIGEST_RPC,
  PLAN_STATS_ROSTER_RPC,
  ADMIN_USER_DIRECTORY_RPC,
  ...ISSUE_RPC_FUNCTIONS
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
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

const PROFILE_CACHE = new Map<string, { profile: any; timestamp: number }>();
const PROFILE_CACHE_TTL_MS = 15000; // 15 seconds warm Edge Function memory cache

async function fetchProfileData(supabaseAdmin: any, userId: string) {
  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .maybeSingle();
    if (!profileError && profile) return profile;
  } catch (err) {
    console.warn("PROFILE_SELECT join failed; falling back to direct profiles query:", err);
  }

  try {
    const { data: basicProfile, error: basicError } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, avatar_url, great_region, pastoral_zone, small_group, role_id, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments")
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .maybeSingle();
    if (!basicError) return basicProfile;
  } catch (err) {
    console.warn("Fallback profile query failed; retrying with the legacy select:", err);
  }

  // Profile resolution runs on every request — never let optional
  // member-journey columns (which may not be deployed to this database yet)
  // take down auth for the whole app.
  const { data: legacyProfile, error: legacyError } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_SELECT_LEGACY)
    .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
    .maybeSingle();
  if (legacyError) throw legacyError;
  return legacyProfile;
}

async function resolveProfile(supabaseAdmin: any, accessToken: string) {
  const cached = PROFILE_CACHE.get(accessToken);
  const now = Date.now();
  if (cached && (now - cached.timestamp < PROFILE_CACHE_TTL_MS)) {
    return cached.profile;
  }

  const payload = parseJwt(accessToken);
  const expectedLogtoIssuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
  const tokenIssuer = trimSlash(String(payload?.iss || ""));
  const isLogtoJwt = Boolean(payload?.sub && tokenIssuer === expectedLogtoIssuer);

  // Logto is the production login method. Do not send its JWT to Supabase Auth
  // first: that request must fail before fallback and adds one remote round trip
  // to every nlc-data call. Non-Logto tokens still use Supabase verification.
  if (!isLogtoJwt) {
    try {
      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(accessToken);
      if (user && !authErr) {
        const profile = await fetchProfileData(supabaseAdmin, user.id);
        if (profile) {
          PROFILE_CACHE.set(accessToken, { profile, timestamp: Date.now() });
          return profile;
        }
      }
    } catch (err) {
      console.log("Supabase JWT verification failed; checking Logto OIDC:", err);
    }
  }

  // 簽章 / 發行者 / 到期驗證（見 logto-jwt-verify 區塊）。report 模式只記錄、照舊放行；
  // enforce 模式驗不過就拒絕。驗過才會進下面的 PROFILE_CACHE，快取不會收進偽造的 token。
  if (isLogtoJwt && LOGTO_JWT_MODE !== "off") {
    const verification = await verifyLogtoJwt(accessToken, expectedLogtoIssuer, Deno.env.get("NLC_LOGTO_AUDIENCE") || undefined);
    recordLogtoJwt("nlc-data", verification, accessToken);
    if (!verification.ok && LOGTO_JWT_MODE === "enforce") {
      throw new Error(verification.reason === "jwks_unavailable" ? "auth_verification_unavailable" : "invalid_logto_token");
    }
  }

  let sub: string | null = isLogtoJwt ? String(payload.sub) : null;
  if (!sub) {
    // Opaque Logto tokens cannot be decoded locally; resolve them through the
    // configured OIDC UserInfo endpoint.
    try {
      const discovery = await fetchJson(`${expectedLogtoIssuer}/.well-known/openid-configuration`);
      const userinfo = await fetchJson(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
      sub = userinfo?.sub || null;
    } catch (err) {
      console.error("Failed to resolve profile from OIDC UserInfo fallback:", err);
    }
  }

  if (!sub) throw new Error("invalid_logto_token");

  const { data: identity, error: identityError } = await supabaseAdmin
    .from("user_identities")
    .select("profile_id")
    .eq("provider", "logto")
    .eq("provider_user_id", sub)
    .maybeSingle();
  if (identityError) throw identityError;
  if (!identity?.profile_id) throw new Error("profile_identity_not_found");

  const profile = await fetchProfileData(supabaseAdmin, identity.profile_id);
  PROFILE_CACHE.set(accessToken, { profile, timestamp: Date.now() });
  return profile;
}


async function isFeatureEnabled(supabaseAdmin: any, key: string) {
  const { data, error } = await supabaseAdmin
    .from("app_feature_settings")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  if (error) return false;
  return data?.enabled === true;
}
const ROLE_CODE_MAP: Record<string, string> = {
  "10000000-0000-4000-8000-000000000001": "member",
  "10000000-0000-4000-8000-000000000002": "group_leader",
  "10000000-0000-4000-8000-000000000003": "zone_leader",
  "10000000-0000-4000-8000-000000000004": "great_zone_leader",
  "10000000-0000-4000-8000-000000000005": "pastor",
  "10000000-0000-4000-8000-000000000006": "admin"
};

function getProfileRoleCode(profile: any) {
  const leadershipLabel = String(profile?.member_context_leadership_display_label || "").trim();
  if (leadershipLabel === "組織架構管理員" || leadershipLabel.includes("系統管理員") || leadershipLabel.includes("組織架構管理員")) {
    return "admin";
  }
  if (leadershipLabel === "教會牧者" || leadershipLabel.includes("主任牧師") || leadershipLabel.includes("教會牧者") || leadershipLabel.includes("牧者")) {
    return "pastor";
  }
  if (leadershipLabel === "大區長" || leadershipLabel.includes("大區同工")) {
    return "great_zone_leader";
  }
  if (leadershipLabel === "區長" || leadershipLabel.includes("牧區長") || leadershipLabel.includes("區同工")) {
    return "zone_leader";
  }
  if (leadershipLabel === "小組長" || leadershipLabel.includes("副小組長") || leadershipLabel.includes("小組同工")) {
    return "group_leader";
  }

  const roleId = String(profile?.role_id || "").toLowerCase();
  return profile?.role_definition?.code
    || (roleId ? ROLE_CODE_MAP[roleId] : null)
    || profile?.role
    || "member";
}

function isAdmin(profile: any) {
  return getProfileRoleCode(profile) === "admin";
}

function hasWholeChurchPlanScope(profile: any) {
  return ["admin", "pastor"].includes(getProfileRoleCode(profile));
}

function canManagePlans(profile: any) {
  return ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(getProfileRoleCode(profile));
}

function normalizeRows(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function forceUserPayload(table: string, payload: any, profileId: string, action?: string) {
  if (table === "profiles") {
    const rows = normalizeRows(payload).map(row => {
      const copy = { ...row };
      if (action === "update") {
        delete copy.id;
      } else {
        copy.id = copy.id || profileId;
      }
      return copy;
    });
    return Array.isArray(payload) ? rows : rows[0];
  }
  if (table === "passage_commentary" || table === "commentary_terms") {
    const rows = normalizeRows(payload).map(row => {
      const copy = { ...row };
      if (action === "update") delete copy.created_by;
      else copy.created_by = profileId;
      return copy;
    });
    return Array.isArray(payload) ? rows : rows[0];
  }
  // issue_reports is included so a member's report is always attributed to the
  // authenticated caller (server-authoritative user_id), never a client-supplied one.
  const writeProtected = ["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments", "issue_reports", "highlights", "verse_notes"];
  if (writeProtected.includes(table)) {
    const rows = normalizeRows(payload).map(row => {
      const copy = { ...row };
      if (action === "update") {
        delete copy.user_id;
      } else {
        copy.user_id = profileId;
      }
      return copy;
    });
    return Array.isArray(payload) ? rows : rows[0];
  }
  return payload;
}

// Multi-column ORDER BY (#351). The client sends every chained .order() in
// `orders` and the first one again in `order`; older clients send only
// `order`. Paginated reads rely on the trailing unique key (id, or
// team_id + user_id) so each .range() page slices the same row order.
function applyOrder(query: any, spec: { order?: any; orders?: any }) {
  const orders = Array.isArray(spec.orders) && spec.orders.length > 0
    ? spec.orders
    : (spec.order ? [spec.order] : []);
  for (const entry of orders) {
    if (!entry || typeof entry.column !== "string" || !entry.column) continue;
    query = query.order(entry.column, { ascending: entry.ascending !== false });
  }
  return query;
}

function applyFilters(query: any, filters: any[] = []) {
  for (const filter of filters) {
    if (!filter || !filter.type || !filter.column) continue;
    if (filter.type === "eq") query = query.eq(filter.column, filter.value);
    else if (filter.type === "is") query = query.is(filter.column, filter.value);
    else if (filter.type === "in") query = query.in(filter.column, filter.value || []);
  }
  return query;
}

function valuesOverlap(left: unknown, right: unknown) {
  const leftValues = String(left || "").split(",").map(value => value.trim()).filter(Boolean);
  const rightValues = String(right || "").split(",").map(value => value.trim()).filter(Boolean);
  return leftValues.some(value => rightValues.includes(value));
}

function splitScope(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

async function getVisibleProfileIds(supabaseAdmin: any, profile: any) {
  if (hasWholeChurchPlanScope(profile)) return null;
  const roleCode = getProfileRoleCode(profile);
  let query = supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("is_active", true);

  if (roleCode === "great_zone_leader") {
    const regions = splitScope(profile.managed_regions || profile.great_region);
    if (!regions.length) return [profile.id];
    query = query.in("great_region", regions);
  } else if (roleCode === "zone_leader") {
    const zones = splitScope(profile.managed_zones || profile.pastoral_zone);
    if (!zones.length) return [profile.id];
    query = query.in("pastoral_zone", zones);
  } else if (roleCode === "group_leader") {
    const groups = splitScope(profile.managed_groups || profile.small_group);
    if (!groups.length) return [profile.id];
    query = query.in("small_group", groups);
  } else {
    return [profile.id];
  }

  const { data: profiles, error } = await query;
  if (error) throw error;
  return Array.from(new Set([profile.id, ...(profiles || []).map((candidate: any) => candidate.id)]));
}

async function applyForcedScope(query: any, table: string, action: string, profile: any, supabaseAdmin: any) {
  // Supabase query builders are PromiseLike. Returning one directly from this
  // async function would execute the query before order/limit/returning are
  // applied. Always wrap it in a plain object to prevent Promise assimilation.
  if (action === "insert" || action === "upsert") return { query };
  if (USER_TABLES.has(table)) {
    if (action !== "select") return { query: query.eq("user_id", profile.id) };
    const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
    return {
      query: visibleIds === null
        ? query
        : query.in("user_id", visibleIds.length ? visibleIds : [profile.id])
    };
  }
  if (table === "profiles" && !hasWholeChurchPlanScope(profile)) {
    const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
    return { query: query.in("id", visibleIds && visibleIds.length ? visibleIds : [profile.id]) };
  }
  if (table === "user_identities") return { query: query.eq("profile_id", profile.id) };
  // reading_teams / reading_team_members have no org-scope columns by design
  // (migration 0019) and rely on RLS ("see a team only after joining it, or
  // as admin") — but nlc-data runs on the service-role key, which bypasses
  // RLS entirely. Reproduce the same boundary here: a plain member may only
  // read teams they belong to; management roles keep full read access for
  // the admin team-registration overview / member-placement fallbacks in
  // js/db.js, which intentionally scan every team.
  if ((table === "reading_teams" || table === "reading_team_members") && action === "select" && !canManagePlans(profile)) {
    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("reading_team_members")
      .select("team_id")
      .eq("user_id", profile.id);
    if (membershipError) throw membershipError;
    const teamIds = (memberships || []).map((row: any) => row.team_id).filter(Boolean);
    const idColumn = table === "reading_teams" ? "id" : "team_id";
    return { query: query.in(idColumn, teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"]) };
  }
  if (table === "global_plans" && action === "select" && !canManagePlans(profile)) return { query: query.or("is_hidden.eq.false,plan_kind.eq.church_campaign_stage") };
  if (table === "church_announcements" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };
  if (table === "passage_commentary" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };
  if (table === "commentary_terms" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };
  if (table === "care_reminders" && action === "select") return { query: query.eq("recipient_id", profile.id) };
  if (table === "care_reminders" && action === "update") return { query: query.eq("recipient_id", profile.id) };
  // verse_notes are private reflections, never shared with pastors/admins the
  // way reading_logs/devotional_notes are — always restrict to the caller's
  // own rows regardless of role, on every action (not just select).
  if (table === "verse_notes") return { query: query.eq("user_id", profile.id) };
  // devotional_likes / devotional_comments: select is intentionally left open
  // (a note's likes/comments are visible to the sharing group — the original
  // RLS policy is devotional_likes_select_group, and insert is already
  // payload-forced to the caller in forceUserPayload), but update/delete had
  // no forced scope at all here, unlike the RLS this table used to rely on
  // (devotional_likes_manage_own: USING/WITH CHECK user_id = current_profile_id())
  // — which never applies to nlc-data's service-role client anyway. Without
  // this, any authenticated member could edit or delete another member's
  // like/comment by id. Reproduce the "own rows only" rule here.
  if ((table === "devotional_likes" || table === "devotional_comments") && (action === "update" || action === "delete")) {
    return { query: query.eq("user_id", profile.id) };
  }
  return { query };
}

// ── 稽核補記（#549）──────────────────────────────────────────────────────────
// 管理寫入成功後補記一筆到 audit.admin_events（經 public.record_admin_audit_event，
// 只有 service role 能呼叫）。盡力而為：稽核失敗只記 log，不影響原本的請求。
async function recordAdminAudit(supabaseAdmin: any, event: AdminAuditEvent) {
  try {
    const { error } = await supabaseAdmin.rpc("record_admin_audit_event", event);
    if (error) console.warn(JSON.stringify({ event: "admin_audit_record_failed", action: event.p_action, code: error.code, message: error.message }));
  } catch (err) {
    console.warn(JSON.stringify({ event: "admin_audit_record_failed", action: event.p_action, message: err instanceof Error ? err.message : String(err) }));
  }
}

async function fetchManagedScopes(supabaseAdmin: any, profileId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("managed_regions, managed_zones, managed_groups")
      .eq("id", profileId)
      .maybeSingle();
    return data || null;
  } catch (_err) {
    return null;
  }
}

// 單列 update／delete 先讀出修改前的值（update 只讀 payload 有的欄位）；批次操作不讀，只記條件和筆數
async function fetchAuditBefore(supabaseAdmin: any, table: string, action: string, filters: unknown, payload: unknown) {
  if (action !== "update" && action !== "delete") return null;
  const key = singleRowKey(table, filters);
  if (!key) return null;
  let columns = "*";
  if (action === "update") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    columns = Object.keys(payload).filter((name) => /^[a-z_][a-z0-9_]*$/.test(name)).join(",");
    if (!columns) return null;
  }
  try {
    const { data } = await supabaseAdmin.from(table).select(columns).eq(key.column, key.value).maybeSingle();
    return data || null;
  } catch (_err) {
    return null;
  }
}

// Run one read-only query spec through the SAME allowlist + forced-scope + option
// pipeline as the single-query `action:"select"` path near the bottom of
// Deno.serve. Kept deliberately in sync with that block; if you change one, change
// both. Returns { data } on success or { error, code? } for an expected failure
// (forbidden table, PostgREST error). Never throws for expected conditions — a
// thrown error is caught by the batch loop and reported per-query.
async function runSelectPipeline(
  spec: {
    table?: unknown; select?: unknown; filters?: any[]; or?: unknown;
    order?: any; orders?: any; range?: any; limit?: unknown; returning?: unknown;
  },
  profile: any,
  supabaseAdmin: any,
): Promise<{ data?: any; error?: string; code?: string }> {
  const table = typeof spec.table === "string" ? spec.table : "";
  if (!table) return { error: "missing_table" };

  const canReportOwnSelect = table === "issue_reports" && (
    isAdmin(profile) || (
      Array.isArray(spec.filters) && spec.filters.some((f: any) => f && f.column === "user_id" && f.value === profile.id)
    )
  );
  if (!(READ_TABLES.has(table) || canReportOwnSelect)) return { error: "forbidden" };

  const devotionalTables = new Set(["devotional_notes", "devotional_likes", "devotional_comments"]);
  if (devotionalTables.has(table) && !(await isFeatureEnabled(supabaseAdmin, "pastoral_sharing_wall"))) {
    return { data: [] };
  }

  let query: any = supabaseAdmin.from(table).select(typeof spec.select === "string" ? spec.select : "*");
  query = applyFilters(query, spec.filters || []);
  if (spec.or) query = query.or(spec.or);
  ({ query } = await applyForcedScope(query, table, "select", profile, supabaseAdmin));
  query = applyOrder(query, spec);
  if (spec.range && Number.isInteger(spec.range.from) && Number.isInteger(spec.range.to)) {
    const rangeFrom = Math.max(0, spec.range.from);
    const rangeTo = Math.min(Math.max(rangeFrom, spec.range.to), rangeFrom + MAX_ROWS_PER_REQUEST - 1);
    query = query.range(rangeFrom, rangeTo);
  }
  if (spec.limit) query = query.limit(Math.min(MAX_ROWS_PER_REQUEST, Math.max(1, Number(spec.limit) || 1)));
  if (spec.returning === "single") query = query.single();
  else if (spec.returning === "maybeSingle") query = query.maybeSingle();

  const { data, error } = await query;
  if (error) return { error: error.message, code: error.code };
  return { data };
}

Deno.serve(async (req: Request) => {
  const localCorsHeaders = {
    ...corsHeaders,
    ...corsHeadersFor(req)
  };

  const requestStartedAt = performance.now();
  // 請求 id：前端帶 x-request-id（#548），沒帶就產生一個；寫進稽核紀錄（#549）
  const requestId = resolveRequestId(req.headers.get("x-request-id"), () => crypto.randomUUID());
  const requestContext = { action: "", target: "" };
  const jsonResponse = (body: unknown, status = 200) => {
    const serialized = JSON.stringify(body);
    const elapsedMs = performance.now() - requestStartedAt;
    // 每個請求一行結構化 log（#548）：回報診斷資訊裡的 request_id 對得到這一行
    console.log(buildRequestLogLine({ requestId, ...requestContext, status, ms: elapsedMs }));
    return new Response(serialized, {
      status,
      headers: {
        ...localCorsHeaders,
        "Content-Length": String(new TextEncoder().encode(serialized).byteLength),
        "Server-Timing": `edge;dur=${elapsedMs.toFixed(1)}`,
        "x-request-id": requestId,
        "Access-Control-Expose-Headers": "Content-Length, Server-Timing, x-request-id"
      }
    });
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: localCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server_not_configured" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return jsonResponse({ error: "missing_authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const table = body.table;
    const action = body.action || "select";
    requestContext.action = String(action).slice(0, 60);
    requestContext.target = requestLogTarget(body);
    if (!["save_profile", "rpc", "batch", "send_care_reminder", "mark_issue_report_reply_seen", "sync_registration_stats_sheet", "issue_thread_get", "issue_thread_post", "issue_thread_attachment_delete"].includes(action) && (!table || typeof table !== "string")) {
      return jsonResponse({ error: "missing_table" }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const profile = await resolveProfile(supabaseAdmin, accessToken);

    if (isRetiredPlanRequest(body)) {
      return jsonResponse({ error: "resource_not_found", resource: "reading_plan" }, 404);
    }

    if (action === "rpc") {
      const functionName = typeof body.function === "string" ? body.function : "";
      if (!RPC_FUNCTIONS.has(functionName)) return jsonResponse({ error: "forbidden_rpc" }, 403);
      // 權限不足的管理 RPC 記為 denied（#549），供異常偵測
      const denyAdminRpc = async () => {
        await recordAdminAudit(supabaseAdmin, buildRpcAuditEvent({
          fn: functionName, args: body.args, actor: profile, roleCode: getProfileRoleCode(profile), requestId, result: "denied"
        }));
        return jsonResponse({ error: "forbidden_rpc" }, 403);
      };
      if (functionName === "publish_global_plan_rules" && !isAdmin(profile)) {
        return await denyAdminRpc();
      }
      if (PLAN_MANAGEMENT_RPC_FUNCTIONS.has(functionName) && !canManagePlans(profile)) {
        return await denyAdminRpc();
      }
      if (ADMIN_RPC_FUNCTIONS.has(functionName) && !isAdmin(profile)) {
        return await denyAdminRpc();
      }
      if (ISSUE_ADMIN_RPC_FUNCTIONS.has(functionName) && !isAdmin(profile)) {
        return await denyAdminRpc();
      }
      if (functionName === ADMIN_USER_DIRECTORY_RPC && !hasWholeChurchPlanScope(profile)) {
        return await denyAdminRpc();
      }
      if (QUIZ_RPC_FUNCTIONS.has(functionName)) {
        const { data: quizFeature, error: quizFeatureError } = await supabaseAdmin
          .from("app_feature_settings")
          .select("enabled")
          .eq("key", "daily_quiz")
          .maybeSingle();
        if (quizFeatureError || quizFeature?.enabled !== true) {
          return jsonResponse({ error: "daily_quiz_feature_disabled" }, 403);
        }
      }
      if (EXAM_RPC_FUNCTIONS.has(functionName)) {
        if (EXAM_ADMIN_RPC_FUNCTIONS.has(functionName) && !isAdmin(profile)) {
          return await denyAdminRpc();
        }
        const { data: examFeature, error: examFeatureError } = await supabaseAdmin
          .from("app_feature_settings")
          .select("enabled")
          .eq("key", "speed_reading_exam")
          .maybeSingle();
        if (examFeatureError || examFeature?.enabled !== true) {
          return jsonResponse({ error: "speed_reading_exam_feature_disabled" }, 403);
        }
      }
      const rpcName = functionName;
      // get_admin_member_team_placements(p_global_plan_id, p_actor_id) calls
      // resolve_reading_team_actor(p_actor_id) just like every other
      // TEAM_RPC_FUNCTIONS entry (migration 0064) — it must get p_actor_id
      // injected too, or resolve_reading_team_actor falls back to
      // current_profile_id() (NULL under the service-role key nlc-data
      // runs on) and raises "profile_required".
      let rpcArgs: Record<string, unknown>;
      if (functionName === "get_org_structure_tree") {
        // Pass the caller's role + managed scope resolved the SAME way
        // applyForcedScope resolves it for profiles selects, so the RPC only
        // filters and the two paths can never diverge.
        rpcArgs = {
          p_actor_id: profile.id,
          p_role_code: getProfileRoleCode(profile),
          p_scope_regions: splitScope(profile.managed_regions || profile.great_region),
          p_scope_zones: splitScope(profile.managed_zones || profile.pastoral_zone),
          p_scope_groups: splitScope(profile.managed_groups || profile.small_group),
        };
      } else if (functionName === PLAN_READING_LOG_DIGEST_RPC) {
        const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
        rpcArgs = buildPlanReadingLogDigestArgs(body.args, visibleIds, profile.id);
      } else if (functionName === PLAN_STATS_ROSTER_RPC) {
        const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
        rpcArgs = buildPlanStatsRosterArgs(body.args, visibleIds, profile.id);
      } else if (functionName === ADMIN_USER_DIRECTORY_RPC) {
        rpcArgs = { p_include_plan_details: isAdmin(profile), p_actor_id: profile.id };
      } else if (functionName === "publish_global_plan_rules"
        || TEAM_RPC_FUNCTIONS.has(functionName)
        || QUIZ_RPC_FUNCTIONS.has(functionName)
        || EXAM_RPC_FUNCTIONS.has(functionName)
        || ISSUE_RPC_FUNCTIONS.has(functionName)
        || LIGHTNING_QUIZ_RPC_FUNCTIONS.has(functionName)
        || READING_STATS_RPC_FUNCTIONS.has(functionName)
        || READING_ACTIVITY_RPC_FUNCTIONS.has(functionName)
        || COMMENTARY_REVIEW_RPC_FUNCTIONS.has(functionName)
        || functionName === "get_admin_registration_statistics"
        || functionName === "create_region_stage_cohort") {
        rpcArgs = { ...(body.args || {}), p_actor_id: profile.id };
      } else {
        rpcArgs = (body.args || {});
      }
      // 管理範圍：補記修改前後的值（只有這支，其他管理 RPC 記參數就夠）
      const auditRpc = AUDITED_ADMIN_RPCS.has(functionName);
      const scopeTargetId = auditRpc && functionName === "set_profile_managed_scopes" ? String((rpcArgs as any).p_profile_id || "") : "";
      const scopeBefore = scopeTargetId ? await fetchManagedScopes(supabaseAdmin, scopeTargetId) : null;
      const { data, error } = await supabaseAdmin.rpc(rpcName, rpcArgs);
      if (auditRpc) {
        const scopeAfter = scopeTargetId && !error ? await fetchManagedScopes(supabaseAdmin, scopeTargetId) : null;
        await recordAdminAudit(supabaseAdmin, buildRpcAuditEvent({
          fn: functionName,
          args: rpcArgs,
          actor: profile,
          roleCode: getProfileRoleCode(profile),
          requestId,
          result: error ? classifyFailure(error) : "ok",
          error,
          changes: scopeAfter ? diffFields(scopeBefore, scopeAfter) : null
        }));
      }
      if (error) return jsonResponse({ error: error.message, code: error.code }, 400);
      // 作答中的 attempt 附上「這份作答專用」寫入憑證：之後的暫存 / 送出走 exam-write，
      // 不再依賴這張會過期的登入 token。只簽給 attempt 主人本人（staff 查別人的卷不簽）；
      // 沒設 EXAM_WRITE_SECRET 就不簽，前端自動沿用 nlc-data。
      if (functionName === "exam_get_for_attempt") {
        const attempt = (data as any)?.attempt;
        const writeSecret = Deno.env.get("EXAM_WRITE_SECRET");
        if (writeSecret && attempt?.id && attempt.status === "in_progress") {
          const { data: owned } = await supabaseAdmin
            .from("exam_attempts").select("id").eq("id", attempt.id).eq("user_id", profile.id).maybeSingle();
          if (owned) attempt.writeToken = await signExamWriteToken(writeSecret, attempt.id, profile.id);
        }
      }
      return jsonResponse({ data });
    }

    // ── batch: many read-only selects, one Logto verification, one HTTP round
    //    trip. body.queries = [{ table, select, filters, or, order, range, limit,
    //    returning }, ...]. Each runs through runSelectPipeline (same allowlist +
    //    forced scope as the single-query path). Response: { data: [{data}|{error,code}, ...] }
    //    in request order — one bad query never fails the others. Read-only:
    //    any non-select spec is rejected in its slot. ──
    if (action === "batch") {
      const queries = Array.isArray(body.queries) ? body.queries : null;
      if (!queries) return jsonResponse({ error: "missing_queries" }, 400);
      if (queries.length === 0) return jsonResponse({ data: [] });
      if (queries.length > 25) return jsonResponse({ error: "batch_too_large" }, 400);

      const results: Array<{ data?: any; error?: string; code?: string }> = [];
      for (const spec of queries) {
        if (spec && spec.action && spec.action !== "select") {
          results.push({ error: "batch_read_only" });
          continue;
        }
        try {
          results.push(await runSelectPipeline(spec || {}, profile, supabaseAdmin));
        } catch (queryErr) {
          const message = queryErr instanceof Error ? queryErr.message : String(queryErr);
          results.push({ error: message });
        }
      }
      return jsonResponse({ data: results });
    }

    // ── send_care_reminder: server-side forced sender_id ──
    if (action === "send_care_reminder") {
      const p = body.payload || {};
      const validReasons = ["behind", "inactive", "care", "encouragement"];
      if (!p.recipient_id) return jsonResponse({ error: "missing_recipient_id" }, 400);
      if (!validReasons.includes(p.reason)) return jsonResponse({ error: "invalid_reason" }, 400);
      const msg = String(p.message || "").trim();
      if (!msg || msg.length > 300) return jsonResponse({ error: "invalid_message" }, 400);
      const pastoralRoles = ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"];
      if (!pastoralRoles.includes(getProfileRoleCode(profile)) || profile.id === p.recipient_id) {
        return jsonResponse({ error: "pastoral_reminder_scope_required" }, 403);
      }
      const { data: recipient, error: recipientError } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active, great_region, pastoral_zone, small_group")
        .eq("id", p.recipient_id)
        .maybeSingle();
      if (recipientError) return jsonResponse({ error: recipientError.message }, 400);
      if (!recipient || recipient.is_active === false) return jsonResponse({ error: "recipient_not_found" }, 404);

      const withinScope = hasWholeChurchPlanScope(profile)
        || (getProfileRoleCode(profile) === "great_zone_leader" && valuesOverlap(recipient.great_region, profile.managed_regions || profile.great_region))
        || (getProfileRoleCode(profile) === "zone_leader" && valuesOverlap(recipient.pastoral_zone, profile.managed_zones || profile.pastoral_zone))
        || (getProfileRoleCode(profile) === "group_leader"
          && valuesOverlap(recipient.pastoral_zone, profile.pastoral_zone)
          && valuesOverlap(recipient.small_group, profile.small_group));
      if (!withinScope) return jsonResponse({ error: "pastoral_reminder_scope_required" }, 403);

      const sentOn = new Date().toISOString().slice(0, 10);
      const planKey = String(p.plan_key || "");

      // A sender can only send one reminder per recipient per plan per day
      // (care_reminders_daily_unique). Re-sending the same day used to just
      // hit that unique-constraint error with no way to see or fix what was
      // already sent. Instead: if today's reminder to this person is still
      // unread, treat this as an edit (update it in place); if it's already
      // been read/dismissed, tell the caller plainly rather than surfacing a
      // raw constraint violation.
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("care_reminders")
        .select("id, status")
        .eq("sender_id", profile.id)
        .eq("recipient_id", p.recipient_id)
        .eq("plan_key", planKey)
        .eq("sent_on", sentOn)
        .maybeSingle();
      if (existingError) return jsonResponse({ error: existingError.message, code: existingError.code }, 400);

      if (existing) {
        if (existing.status !== "unread") {
          return jsonResponse({ error: "care_reminder_already_seen" }, 409);
        }
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("care_reminders")
          .update({ reason: p.reason, message: msg })
          .eq("id", existing.id)
          .select("id, reason, message, status, sent_on")
          .single();
        if (updateError) return jsonResponse({ error: updateError.message, code: updateError.code }, 400);
        return jsonResponse({ data: { ...updated, edited: true } });
      }

      const { data: inserted, error } = await supabaseAdmin
        .from("care_reminders")
        .insert({
          sender_id: profile.id,           // always the authenticated caller
          recipient_id: p.recipient_id,
          plan_key: planKey,
          reason: p.reason,
          message: msg,
          status: "unread",
          sent_on: sentOn
        })
        .select("id, reason, message, status, sent_on")
        .single();
      if (error) return jsonResponse({ error: error.message, code: error.code }, 400);
      return jsonResponse({ data: { ...inserted, edited: false } });
    }

    // ── mark_issue_report_reply_seen: the reporting member clears their own
    // unread-reply badge. Deliberately its own isolated action rather than a
    // generic issue_reports UPDATE grant — the server computes the new
    // metadata itself (existing metadata + reply_seen_at only) instead of
    // trusting whatever metadata the client sends, so a member can never use
    // this path to alter status/category/description or forge/edit the
    // admin's reply text on their own report.
    if (action === "mark_issue_report_reply_seen") {
      const reportId = String(body.report_id || "");
      if (!reportId) return jsonResponse({ error: "missing_report_id" }, 400);
      const { data: report, error: fetchError } = await supabaseAdmin
        .from("issue_reports")
        .select("id, user_id, metadata")
        .eq("id", reportId)
        .maybeSingle();
      if (fetchError) return jsonResponse({ error: fetchError.message }, 400);
      if (!report || report.user_id !== profile.id) return jsonResponse({ error: "forbidden" }, 403);

      const existingMetadata = (report.metadata && typeof report.metadata === "object") ? report.metadata : {};
      if (!existingMetadata.reply || existingMetadata.reply_seen_at) {
        // Nothing to mark (no reply yet, or already seen) — succeed idempotently.
        return jsonResponse({ data: report });
      }

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("issue_reports")
        .update({ metadata: { ...existingMetadata, reply_seen_at: new Date().toISOString() } })
        .eq("id", reportId)
        .eq("user_id", profile.id)
        .select("id, metadata")
        .single();
      if (updateError) return jsonResponse({ error: updateError.message }, 400);
      return jsonResponse({ data: updated });
    }

    // ── 回報對話串：碰 Storage 的三個 action（SQL RPC 動不到 Storage）──────────
    // 授權一律在 SQL 端（_issue_actor / _issue_is_admin：本人或 admin）。
    const ISSUE_SHOTS_BUCKET = "issue-report-shots";
    const issueShotExt = (mime: string) =>
      mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    const issueDecodeBase64 = (b64: string) => {
      const clean = String(b64 || "").replace(/^data:[^,]*,/, "");
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };

    if (action === "issue_thread_get") {
      const reportId = String(body.report_id || "");
      if (!reportId) return jsonResponse({ error: "missing_report_id" }, 400);
      const { data, error } = await supabaseAdmin.rpc("issue_thread_get", {
        p_report_id: reportId,
        p_actor_id: profile.id,
        p_mark_read: body.mark_read !== false
      });
      if (error) return jsonResponse({ error: error.message, code: error.code }, 400);
      const thread = data || {};
      const messages: any[] = Array.isArray(thread.messages) ? thread.messages : [];
      const paths = messages
        .map((m) => m?.attachmentPath)
        .filter((p): p is string => typeof p === "string" && p.length > 0 && p !== "pending");
      if (paths.length) {
        const { data: signed } = await supabaseAdmin.storage
          .from(ISSUE_SHOTS_BUCKET)
          .createSignedUrls(paths, 300);
        const urlByPath = new Map<string, string>();
        (signed || []).forEach((s: any) => {
          if (s && !s.error && s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
        });
        for (const m of messages) {
          if (m?.attachmentPath && urlByPath.has(m.attachmentPath)) {
            m.attachmentUrl = urlByPath.get(m.attachmentPath);
          }
        }
      }
      return jsonResponse({ data: thread });
    }

    if (action === "issue_thread_post") {
      const reportId = String(body.report_id || "");
      if (!reportId) return jsonResponse({ error: "missing_report_id" }, 400);
      const image = body.image && typeof body.image === "object" ? body.image : null;
      const imgMime = image ? String(image.mime || "") : "";
      if (image && !["image/webp", "image/jpeg", "image/png"].includes(imgMime)) {
        return jsonResponse({ error: "bad_mime" }, 400);
      }
      let imgBytes: Uint8Array | null = null;
      if (image) {
        try {
          imgBytes = issueDecodeBase64(image.base64);
        } catch (_e) {
          return jsonResponse({ error: "bad_image" }, 400);
        }
        if (!imgBytes.length || imgBytes.length > 512000) {
          return jsonResponse({ error: "too_large" }, 400);
        }
      }

      const { data: posted, error: postErr } = await supabaseAdmin.rpc("issue_thread_post", {
        p_report_id: reportId,
        p_body: typeof body.body === "string" ? body.body : "",
        p_is_internal: body.is_internal === true,
        p_has_attachment: !!image,
        p_actor_id: profile.id
      });
      if (postErr) return jsonResponse({ error: postErr.message, code: postErr.code }, 400);
      const messageId = posted?.id;

      if (image && imgBytes && messageId) {
        const path = `${reportId}/${messageId}.${issueShotExt(imgMime)}`;
        const up = await supabaseAdmin.storage
          .from(ISSUE_SHOTS_BUCKET)
          .upload(path, imgBytes, { contentType: imgMime, upsert: true });
        if (up.error) {
          await supabaseAdmin.rpc("issue_thread_drop_attachment", {
            p_message_id: messageId, p_actor_id: profile.id
          });
          return jsonResponse({ error: "upload_failed" }, 500);
        }
        const { error: setErr } = await supabaseAdmin.rpc("issue_thread_set_attachment", {
          p_message_id: messageId, p_path: path, p_mime: imgMime,
          p_bytes: imgBytes.length,
          p_w: Number(image.w) || null, p_h: Number(image.h) || null,
          p_actor_id: profile.id
        });
        if (setErr) {
          await supabaseAdmin.storage.from(ISSUE_SHOTS_BUCKET).remove([path]);
          await supabaseAdmin.rpc("issue_thread_drop_attachment", {
            p_message_id: messageId, p_actor_id: profile.id
          });
          return jsonResponse({ error: setErr.message }, 400);
        }
      }
      return jsonResponse({ data: { id: messageId, reportId } });
    }

    if (action === "issue_thread_attachment_delete") {
      const messageId = String(body.message_id || "");
      if (!messageId) return jsonResponse({ error: "missing_message_id" }, 400);
      const { data, error } = await supabaseAdmin.rpc("issue_thread_drop_attachment", {
        p_message_id: messageId, p_actor_id: profile.id
      });
      if (error) return jsonResponse({ error: error.message, code: error.code }, 400);
      const oldPath = data?.oldPath;
      if (typeof oldPath === "string" && oldPath && oldPath !== "pending") {
        await supabaseAdmin.storage.from(ISSUE_SHOTS_BUCKET).remove([oldPath]);
      }
      return jsonResponse({ data: { ok: true } });
    }

    if (action === "save_profile") {
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const { data: hubIdentity, error: hubIdentityError } = await supabaseAdmin
        .from("user_identities")
        .select("profile_id")
        .eq("profile_id", profile.id)
        .eq("provider", "logto")
        .maybeSingle();
      if (hubIdentityError) return jsonResponse({ error: hubIdentityError.message }, 400);

      // Logto-linked names are owned by Member Hub. Ignore cached names sent by
      // old browser tabs. nlc-session is the only writer of the canonical name.
      if (hubIdentity) {
        return jsonResponse({
          data: profile,
          profile,
          project_url: supabaseUrl,
          profile_id: profile.id,
          canonical_source: "member_hub"
        });
      }

      const nextName = payload.name ?? profile.name ?? "";
      const updatePayload: Record<string, unknown> = {
        name: nextName,
        updated_at: new Date().toISOString()
      };

      let savedProfile: any = null;
      let saveError: any = null;
      ({ data: savedProfile, error: saveError } = await supabaseAdmin
        .from("profiles")
        .update(updatePayload)
        .eq("id", profile.id)
        .select(PROFILE_SELECT)
        .single());

      if (saveError) {
        // Member-journey columns may not be deployed to this database yet —
        // retry with the legacy select rather than blocking every member
        // from saving their own name.
        console.warn("save_profile with PROFILE_SELECT failed; retrying with the legacy select:", saveError);
        ({ data: savedProfile, error: saveError } = await supabaseAdmin
          .from("profiles")
          .update(updatePayload)
          .eq("id", profile.id)
          .select(PROFILE_SELECT_LEGACY)
          .single());
      }

      if (saveError) return jsonResponse({ error: saveError.message, code: saveError.code }, 400);
      if (!savedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);

      if (String((savedProfile as any).name || "") !== String(updatePayload.name || "")) {
        return jsonResponse({
          error: "profile_write_mismatch",
          mismatches: ["name"],
          expected: updatePayload,
          actual: savedProfile,
          project_url: supabaseUrl,
          profile_id: profile.id
        }, 500);
      }

      return jsonResponse({ data: savedProfile, profile: savedProfile, project_url: supabaseUrl, profile_id: profile.id });
    }

    // ── sync_registration_stats_sheet: admin-only, forwards a formatted
    // snapshot of 報名與註冊統計 to a Google Apps Script Web App bound to the
    // church's shared "速讀報名統計" spreadsheet. The client builds the rows
    // (it already has the zone-leader-name lookup used by the org-permissions
    // panel); this function only re-validates shape/admin access and adds the
    // shared secret before forwarding — the Apps Script side never sees a
    // Supabase/Logto token, just this one shared secret.
    if (action === "sync_registration_stats_sheet") {
      const sheetAudit = (result: "ok" | "denied" | "error") => recordAdminAudit(supabaseAdmin, {
        p_action: "sync_registration_stats_sheet", p_result: result, p_actor_id: profile.id,
        p_actor_role: getProfileRoleCode(profile), p_resource: "export", p_target_user_id: null, p_target_id: null,
        p_changes: null, p_reason: null, p_request_id: requestId, p_detail: null
      });
      if (!isAdmin(profile)) {
        await sheetAudit("denied");
        return jsonResponse({ error: "forbidden" }, 403);
      }

      const sheetUrl = Deno.env.get("REGISTRATION_STATS_SHEET_WEBHOOK_URL");
      const sheetSecret = Deno.env.get("REGISTRATION_STATS_SHEET_WEBHOOK_SECRET");
      if (!sheetUrl || !sheetSecret) {
        return jsonResponse({ error: "server_not_configured" }, 500);
      }

      const p = body.payload && typeof body.payload === "object" ? body.payload : {};
      const sanitizeCounts = (row: any) => ({
        label: String(row?.label ?? "").slice(0, 40),
        signupCount: Number(row?.signupCount) || 0,
        registeredCount: Number(row?.registeredCount) || 0,
        team3Count: Number(row?.team3Count) || 0,
        team6Count: Number(row?.team6Count) || 0
      });
      const greatRegions = Array.isArray(p.great_regions) ? p.great_regions.map(sanitizeCounts) : [];
      const pastoralZones = Array.isArray(p.pastoral_zones)
        ? p.pastoral_zones.map((row: any) => ({ ...sanitizeCounts(row), leaderName: String(row?.leaderName ?? "").slice(0, 60) }))
        : [];
      const s = p.summary && typeof p.summary === "object" ? p.summary : {};

      try {
        const sheetResponse = await fetch(sheetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: sheetSecret,
            planName: String(p.plan_name ?? "").slice(0, 60),
            greatRegions,
            pastoralZones,
            summary: {
              withoutPastoralZoneNotJoined: Number(s.withoutPastoralZoneNotJoined) || 0,
              withoutPastoralZoneJoined: Number(s.withoutPastoralZoneJoined) || 0,
              withPastoralZoneNotJoined: Number(s.withPastoralZoneNotJoined) || 0,
              withPastoralZoneJoined: Number(s.withPastoralZoneJoined) || 0,
              totalJoined: Number(s.totalJoined) || 0,
              totalRegistered: Number(s.totalRegistered) || 0
            }
          })
        });
        if (!sheetResponse.ok) {
          const text = await sheetResponse.text().catch(() => "");
          console.error("sync_registration_stats_sheet: sheet webhook rejected the payload", sheetResponse.status, text);
          return jsonResponse({ error: "sheet_webhook_failed" }, 502);
        }
      } catch (err) {
        console.error("sync_registration_stats_sheet: failed to reach sheet webhook", err);
        return jsonResponse({ error: "sheet_webhook_unreachable" }, 502);
      }

      await sheetAudit("ok");
      return jsonResponse({ data: { ok: true } });
    }

    // Any authenticated member may file an issue report (insert only). Reads and
    // deletes stay admin-only via canRead / canAdminWrite below. user_id is forced
    // to the caller in forceUserPayload so a member cannot spoof another user.
    if (["insert", "update", "upsert"].includes(action)
      && table === "profiles"
      && Object.prototype.hasOwnProperty.call(body.payload || {}, "role_id")) {
      await recordAdminAudit(supabaseAdmin, buildTableWriteAuditEvent({
        table, action, filters: body.filters, orFilter: body.or, payload: body.payload, before: null,
        actor: profile, roleCode: getProfileRoleCode(profile), requestId, result: "denied",
        error: { code: "role_assignment_managed_by_member_hub" }
      }));
      return jsonResponse({ error: "role_assignment_managed_by_member_hub" }, 403);
    }
    const canReportInsert = action === "insert" && table === "issue_reports";
    const canReportOwnSelect = action === "select" && table === "issue_reports" && (
      isAdmin(profile) || (
        Array.isArray(body.filters) && body.filters.some((f: any) => f.column === "user_id" && f.value === profile.id)
      )
    );
    const canRead = action === "select" && (READ_TABLES.has(table) || canReportOwnSelect);
    const canOwnWrite = (["insert", "update", "delete", "upsert"].includes(action)
      && OWN_WRITE_TABLES.has(table)
      && !(OWN_WRITE_UPDATE_ONLY_TABLES.has(table) && action !== "update")) || canReportInsert;
    const canAdminWrite = ["insert", "update", "delete", "upsert"].includes(action) && (
      ((ADMIN_WRITE_TABLES.has(table) || table === "issue_reports") && (isAdmin(profile) || canManagePlans(profile)))
      || (ADMIN_ONLY_WRITE_TABLES.has(table) && isAdmin(profile))
    );
    if (!canRead && !canOwnWrite && !canAdminWrite) {
      if (isAuditedTableWrite(table, action)) {
        await recordAdminAudit(supabaseAdmin, buildTableWriteAuditEvent({
          table, action, filters: body.filters, orFilter: body.or, payload: body.payload, before: null,
          actor: profile, roleCode: getProfileRoleCode(profile), requestId, result: "denied"
        }));
      }
      return jsonResponse({ error: "forbidden" }, 403);
    }
    // 新增回報：metadata 只留前端附的診斷資訊（#548），其他鍵一律丟掉
    if (table === "issue_reports" && action === "insert") {
      body.payload = sanitizeReportInsertPayload(body.payload);
    }
    // 管理用資料表的寫入（#549）：單列修改／刪除先讀出修改前的值，寫入後補記一筆
    const auditWrite = canAdminWrite && !canOwnWrite && isAuditedTableWrite(table, action);
    const auditBefore = auditWrite ? await fetchAuditBefore(supabaseAdmin, table, action, body.filters, body.payload) : null;


    const devotionalTables = new Set(["devotional_notes", "devotional_likes", "devotional_comments"]);
    if (devotionalTables.has(table)
      && !(await isFeatureEnabled(supabaseAdmin, "pastoral_sharing_wall"))) {
      if (action === "select") return jsonResponse({ data: [] });
      return jsonResponse({ error: "feature_archived" }, 403);
    }
    let query: any;
    if (action === "select") {
      query = supabaseAdmin.from(table).select(body.select || "*");
    } else if (action === "insert") {
      query = supabaseAdmin.from(table).insert(forceUserPayload(table, body.payload, profile.id, action));
    } else if (action === "update") {
      query = supabaseAdmin.from(table).update(forceUserPayload(table, body.payload, profile.id, action));
    } else if (action === "delete") {
      query = supabaseAdmin.from(table).delete();
    } else if (action === "upsert") {
      query = supabaseAdmin.from(table).upsert(forceUserPayload(table, body.payload, profile.id, action), body.options || undefined);
    } else {
      return jsonResponse({ error: "unsupported_action" }, 400);
    }

    query = applyFilters(query, body.filters || []);
    if (body.or) query = query.or(body.or);
    ({ query } = await applyForcedScope(query, table, action, profile, supabaseAdmin));
    if (["insert", "update", "upsert"].includes(action) && body.select) query = query.select(body.select);
    query = applyOrder(query, body);
    if (body.range && Number.isInteger(body.range.from) && Number.isInteger(body.range.to)) {
      const rangeFrom = Math.max(0, body.range.from);
      const rangeTo = Math.min(Math.max(rangeFrom, body.range.to), rangeFrom + MAX_ROWS_PER_REQUEST - 1);
      query = query.range(rangeFrom, rangeTo);
    }
    if (body.limit) query = query.limit(Math.min(MAX_ROWS_PER_REQUEST, Math.max(1, Number(body.limit) || 1)));
    if (body.returning === "single") query = query.single();
    else if (body.returning === "maybeSingle") query = query.maybeSingle();

    const { data, error } = await query;
    if (auditWrite) {
      await recordAdminAudit(supabaseAdmin, buildTableWriteAuditEvent({
        table, action, filters: body.filters, orFilter: body.or, payload: body.payload, before: auditBefore,
        actor: profile, roleCode: getProfileRoleCode(profile), requestId,
        result: error ? classifyFailure(error) : "ok",
        rowCount: Array.isArray(data) ? data.length : null,
        error
      }));
    }
    if (error) return jsonResponse({ error: error.message, code: error.code }, 400);

    let responseData = data;
    if (table === "profiles" && ["insert", "update", "upsert"].includes(action)) {
      const { data: verifiedProfile, error: verifyError } = await supabaseAdmin
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("id", profile.id)
        .maybeSingle();
      if (verifyError) return jsonResponse({ error: verifyError.message, code: verifyError.code }, 400);
      if (!verifiedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);
      responseData = verifiedProfile;
    }

    return jsonResponse({ data: responseData });
  } catch (err) {
    const errorDetails = err instanceof Error ? err.message : (typeof err === "object" && err !== null ? ((err as any).message || JSON.stringify(err)) : String(err));
    if (errorDetails === "invalid_logto_token") {
      return jsonResponse({ error: "invalid_logto_token", message: "Logto token is invalid or expired" }, 401);
    }
    if (errorDetails === "auth_verification_unavailable") {
      // 拿不到 Logto 公開金鑰（Logto 暫時連不上）：不是 token 壞掉，回 503 讓前端稍後重試、不要登出
      return jsonResponse({ error: "auth_verification_unavailable", message: "Login verification is temporarily unavailable" }, 503);
    }
    if (errorDetails === "profile_identity_not_found") {
      return jsonResponse({ error: "profile_identity_not_found", message: "User profile identity not found" }, 404);
    }
    console.error("nlc-data failed:", errorDetails, err);
    return jsonResponse({ error: "nlc_data_failed", message: errorDetails }, 500);
  }
});
