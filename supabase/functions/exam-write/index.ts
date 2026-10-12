// 大測驗作答寫入（暫存 / 送出）——不依賴登入 token。
//
// 為什麼要有這支：作答中的暫存與送出原本都走 nlc-data，要帶 Logto access token。
// token 約 15 分鐘就要續期，75 分鐘的測驗要續好幾次，任何一次續期失敗（尖峰、
// refresh token 輪替衝突…）前端就會清掉登入，後面的暫存 / 送出全部失敗。
// 改成：nlc-data 在 exam_get_for_attempt 回傳時簽一張「這份作答專用」的寫入憑證
// （見下方 exam-write-token 區塊），作答中的寫入帶這張憑證打這裡。
//
//   POST { action: "save",   attemptId, token, answers }
//   POST { action: "submit", attemptId, token, answers, reason }
//
// 權限刻意很窄：
//   · 只能呼叫 exam_save_progress / exam_submit_attempt 兩支，actor 固定是 attempt 的主人。
//   · 截止時間、狀態（已送出 / 已鎖）等規則全部照 DB 函式原本的檢查，這裡不另外放寬。
//   · 功能開關 speed_reading_exam 關閉時一樣擋。
//
// 回應：成功 200 { data }；RPC 業務錯誤 400 { error, code }（跟 nlc-data 同形狀，前端照常處理）；
//       憑證不符 401；其他 4xx/5xx。前端遇到 401 / 404 / 5xx / 連不上會退回 nlc-data 路徑。
//
// 需要的 secrets：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（平台內建）
//   EXAM_WRITE_SECRET（自訂；nlc-data 也要設同一個值才會簽發憑證）
// supabase/config.toml：[functions.exam-write] verify_jwt = false（憑證不是 Supabase JWT）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    "Vary": "Origin"
  };
}
// <<< cors-allowlist

const MAX_BODY_BYTES = 512 * 1024;   // 整份卷含簡答也遠小於此；擋異常大 payload
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBMIT_REASONS = new Set(["manual", "timeout"]);

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("EXAM_WRITE_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !secret) return json({ error: "server_not_configured" }, 503);

  const raw = await req.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  let body: any;
  try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "invalid_json" }, 400); }

  const action = body?.action;
  const attemptId = typeof body?.attemptId === "string" ? body.attemptId : "";
  const answers = body?.answers;
  if (action !== "save" && action !== "submit") return json({ error: "invalid_action" }, 422);
  if (!UUID_RE.test(attemptId)) return json({ error: "invalid_attempt_id" }, 422);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return json({ error: "invalid_answers" }, 422);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const { data: attempt, error: attemptErr } = await admin
      .from("exam_attempts")
      .select("id, user_id")
      .eq("id", attemptId)
      .maybeSingle();
    if (attemptErr) return json({ error: "lookup_failed" }, 500);
    // 找不到跟憑證不符回同一個錯，不透露 attempt 存不存在
    if (!attempt || !(await verifyExamWriteToken(secret, attempt.id, attempt.user_id, body?.token))) {
      return json({ error: "invalid_exam_write_token" }, 401);
    }

    const { data: feature, error: featureErr } = await admin
      .from("app_feature_settings")
      .select("enabled")
      .eq("key", "speed_reading_exam")
      .maybeSingle();
    if (featureErr || feature?.enabled !== true) return json({ error: "speed_reading_exam_feature_disabled" }, 403);

    const { data, error } = action === "save"
      ? await admin.rpc("exam_save_progress", {
          p_attempt_id: attempt.id, p_answers: answers, p_actor_id: attempt.user_id
        })
      : await admin.rpc("exam_submit_attempt", {
          p_attempt_id: attempt.id, p_answers: answers, p_actor_id: attempt.user_id,
          p_reason: SUBMIT_REASONS.has(body?.reason) ? body.reason : "manual"
        });
    if (error) return json({ error: error.message, code: error.code }, 400);
    return json({ data });
  } catch (err) {
    console.error("[exam-write] failed", err);
    return json({ error: "internal_error" }, 500);
  }
});
