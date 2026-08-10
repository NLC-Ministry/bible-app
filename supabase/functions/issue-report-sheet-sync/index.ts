// Fires on every new row inserted into public.issue_reports (via a Supabase
// Database Webhook — see supabase/functions/README.md for setup). Forwards
// only the 4 non-personal fields the church's engineering team asked for
// (建立時間/分類/處理狀況/問題描述) to a Google Apps Script Web App bound to
// the shared triage spreadsheet, which appends a row.
//
// Deliberately does NOT forward: user_id, url, user_agent, metadata, or the
// report id — none of that should leave the app for a spreadsheet other
// engineers can see.

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug 錯誤",
  ui: "UI 建議",
  data: "資料問題",
  other: "其他"
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待處理",
  processing: "處理中",
  resolved: "已解決",
  ignored: "已忽略"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const webhookSecret = Deno.env.get("ISSUE_REPORT_WEBHOOK_SECRET");
  const sheetUrl = Deno.env.get("ISSUE_REPORT_SHEET_WEBHOOK_URL");
  const sheetSecret = Deno.env.get("ISSUE_REPORT_SHEET_WEBHOOK_SECRET");
  if (!webhookSecret || !sheetUrl || !sheetSecret) {
    console.error("issue-report-sheet-sync missing required secrets");
    return jsonResponse({ error: "server_not_configured" }, 500);
  }

  // The caller is a Supabase Database Webhook, not an authenticated app user
  // (this function has verify_jwt = false), so it carries no Supabase/Logto
  // token to check. Guard it with a shared secret set as a custom header on
  // the webhook itself instead.
  const receivedSecret = req.headers.get("x-webhook-secret");
  if (receivedSecret !== webhookSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // Only ever act on new reports. The webhook should already be scoped to
  // INSERT-only in the Supabase dashboard, but a table/type check here means
  // a misconfigured webhook (e.g. someone later adds UPDATE) can't leak an
  // edited row through silently.
  if (payload?.table !== "issue_reports" || payload?.type !== "INSERT") {
    return jsonResponse({ ok: true, skipped: true });
  }

  const record = payload.record || {};
  const category = String(record.category || "");
  const status = String(record.status || "pending");
  const description = String(record.description || "");
  const createdAt = String(record.created_at || "");

  if (!description) {
    return jsonResponse({ ok: true, skipped: true, reason: "empty_description" });
  }

  const row = {
    secret: sheetSecret,
    created_at: createdAt,
    category: CATEGORY_LABELS[category] || category || "其他",
    status: STATUS_LABELS[status] || status || "待處理",
    description
  };

  try {
    const sheetResponse = await fetch(sheetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
    if (!sheetResponse.ok) {
      const text = await sheetResponse.text().catch(() => "");
      console.error("issue-report-sheet-sync: sheet webhook rejected the row", sheetResponse.status, text);
      return jsonResponse({ error: "sheet_webhook_failed", status: sheetResponse.status }, 502);
    }
  } catch (err) {
    console.error("issue-report-sheet-sync: failed to reach sheet webhook", err);
    return jsonResponse({ error: "sheet_webhook_unreachable" }, 502);
  }

  return jsonResponse({ ok: true });
});
