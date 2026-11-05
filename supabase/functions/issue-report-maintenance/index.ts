// 回報對話串維護（migration 0153）。由排程（Supabase Scheduled Function / Cron）
// 每天呼叫一次。verify_jwt = false —— 用共享密鑰 header 守門。
//
//   POST { }                → 只跑 autoclose（管理員回覆後 14 天無回應 → 結案）
//   POST { "purge": true }   → 另外跑 purge（結案 180 天 → 刪訊息列）+ 掃孤兒截圖
//
// 需要的 secrets：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（平台內建）
//   ISSUE_REPORT_MAINTENANCE_SECRET（自訂；排程呼叫時放在 x-maintenance-secret）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "issue-report-shots";
const PAGE_SIZE = 1000;
const LIST_CONCURRENCY = 5;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// 列出某一層的全部項目。一邊翻頁一邊刪會讓 offset 位移，所以呼叫端要全部列完才能開始刪。
async function listAllEntries(supabase: any, prefix: string): Promise<any[]> {
  const entries: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error(`storage list returned no data: ${prefix || "(root)"}`);
    entries.push(...data);
    if (data.length < PAGE_SIZE) return entries;
  }
}

// 上傳後才寫回 attachment_path，而且看不出時間的項目（子資料夾）也不是檔案：
// 只有確定放超過寬限期的才算候選。
function isPastGracePeriod(entry: any, now: number): boolean {
  const uploadedAt = Math.max(Date.parse(entry?.created_at), Date.parse(entry?.updated_at));
  return Number.isFinite(uploadedAt) && now - uploadedAt >= ORPHAN_MIN_AGE_MS;
}

// DB 端所有還在用的路徑。漏掉一筆就會誤刪檔案，所以：
// - 用 id 當游標（不用 offset）：順序穩定，翻頁途中有列被刪也不會跳過後面的列（#351 同類問題）。
// - 讀到空頁才算結束：伺服器每頁上限比 PAGE_SIZE 小時，短頁不代表讀完了。
// - 讀取失敗一律往外丟，呼叫端就不會走到刪除。
async function readUsedPaths(supabase: any): Promise<Set<string>> {
  const used = new Set<string>();
  let lastId: string | null = null;
  for (;;) {
    let query = supabase
      .from("issue_report_messages")
      .select("id, attachment_path")
      .not("attachment_path", "is", null);
    if (lastId !== null) query = query.gt("id", lastId);
    const { data, error } = await query.order("id", { ascending: true }).limit(PAGE_SIZE);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("issue_report_messages page returned no data");
    if (data.length === 0) return used;
    for (const row of data) {
      if (row.attachment_path && row.attachment_path !== "pending") used.add(row.attachment_path);
    }
    lastId = data[data.length - 1].id;
  }
}

async function sweepOrphanShots(supabase: any): Promise<number> {
  // Storage 端：<report_id>/<file> 兩層。任何一頁失敗就整次放棄，下次排程再掃。
  const now = Date.now();
  const candidates: string[] = [];
  const folders = (await listAllEntries(supabase, "")).filter((folder) => folder?.name);
  for (let i = 0; i < folders.length; i += LIST_CONCURRENCY) {
    const batch = folders.slice(i, i + LIST_CONCURRENCY);
    const listed = await Promise.all(batch.map((folder) => listAllEntries(supabase, folder.name)));
    listed.forEach((entries, index) => {
      for (const entry of entries) {
        if (entry?.name && isPastGracePeriod(entry, now)) {
          candidates.push(`${batch[index].name}/${entry.name}`);
        }
      }
    });
  }

  // 列完才讀 DB：候選檔案都比這份路徑清單舊，不會把清掃途中新上傳的附件當孤兒。
  const used = await readUsedPaths(supabase);
  const orphans = candidates.filter((path) => !used.has(path));

  let removed = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (!error) removed += batch.length;
  }
  return removed;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("ISSUE_REPORT_MAINTENANCE_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "server_not_configured" }, 500);
  }
  if (req.headers.get("x-maintenance-secret") !== secret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const out: Record<string, unknown> = {};

  try {
    const { data: closed, error: closeErr } = await supabase.rpc("issue_threads_autoclose");
    if (closeErr) throw closeErr;
    out.autoclosed = closed ?? 0;

    if (body?.purge === true) {
      const days = Number.isInteger(body.older_than_days) ? body.older_than_days : 180;
      const { data: purged, error: purgeErr } = await supabase.rpc("issue_threads_purge_messages", {
        p_older_than_days: days
      });
      if (purgeErr) throw purgeErr;
      out.purgedMessages = purged ?? 0;
      out.orphanShotsRemoved = await sweepOrphanShots(supabase);
    }
  } catch (err) {
    console.error("issue-report-maintenance failed:", err);
    return jsonResponse({ error: String((err as any)?.message || err) }, 500);
  }

  return jsonResponse({ ok: true, ...out });
});
