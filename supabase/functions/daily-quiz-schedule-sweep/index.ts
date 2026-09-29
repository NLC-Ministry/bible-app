// 小測驗自動發佈掃描器（migration 0189 建立；#306 起負責每天 00:00 的自動發佈，
// #308 拿掉舊的排程發佈）。由 pg_cron 每 5 分鐘呼叫一次。verify_jwt = false ——
// 用共享密鑰 header 守門，不是 Logto/Supabase token。
//
//   POST { }   → 呼叫 run_daily_quiz_schedule_sweep()，回傳 { autoPublish }
//
// 需要的 secrets：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（平台內建）
//   DAILY_QUIZ_SCHEDULE_SWEEP_SECRET（自訂；排程呼叫時放在 x-cron-secret）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  const invocationId = crypto.randomUUID();
  console.info("daily_quiz_schedule_sweep_invocation_received", JSON.stringify({
    invocationId, method: req.method, hasCronSecret: Boolean(req.headers.get("x-cron-secret"))
  }));

  if (req.method !== "POST") {
    console.warn("daily_quiz_schedule_sweep_method_rejected", JSON.stringify({ invocationId, method: req.method }));
    return jsonResponse({ error: "method_not_allowed", invocationId }, 405);
  }

  const secret = Deno.env.get("DAILY_QUIZ_SCHEDULE_SWEEP_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.warn("daily_quiz_schedule_sweep_not_configured", JSON.stringify({ invocationId }));
    return jsonResponse({ error: "server_not_configured", invocationId }, 500);
  }
  if (req.headers.get("x-cron-secret") !== secret) {
    console.warn("daily_quiz_schedule_sweep_auth_rejected", JSON.stringify({ invocationId }));
    return jsonResponse({ error: "unauthorized", invocationId }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await supabase.rpc("run_daily_quiz_schedule_sweep");
  if (error) {
    console.error("daily_quiz_schedule_sweep_failed", JSON.stringify({ invocationId, message: error.message || String(error) }));
    return jsonResponse({ error: "sweep_failed", invocationId }, 500);
  }

  console.info("daily_quiz_schedule_sweep_finished", JSON.stringify({ invocationId, ...data }));
  return jsonResponse({ ok: true, invocationId, ...data });
});
