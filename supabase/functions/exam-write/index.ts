// 大測驗作答寫入（暫存 / 送出）——不依賴登入 token。
//
// 為什麼要有這支：作答中的暫存與送出原本都走 nlc-data，要帶 Logto access token。
// token 約 15 分鐘就要續期，75 分鐘的測驗要續好幾次，任何一次續期失敗（尖峰、
// refresh token 輪替衝突…）前端就會清掉登入，後面的暫存 / 送出全部失敗。
// 改成：nlc-data 在 exam_get_for_attempt 回傳時簽一張「這份作答專用」的寫入憑證
// （見 ../_shared/exam-write-token.ts），作答中的寫入帶這張憑證打這裡。
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
import { verifyExamWriteToken } from "../_shared/exam-write-token.ts";

const MAX_BODY_BYTES = 512 * 1024;   // 整份卷含簡答也遠小於此；擋異常大 payload
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBMIT_REASONS = new Set(["manual", "timeout"]);

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
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
