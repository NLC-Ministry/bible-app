export function chunkUniqueValues(values = [], batchSize = 40) {
  const normalizedBatchSize = Math.max(1, Number(batchSize) || 40);
  const uniqueValues = Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean)));
  const chunks = [];
  for (let index = 0; index < uniqueValues.length; index += normalizedBatchSize) {
    chunks.push(uniqueValues.slice(index, index + normalizedBatchSize));
  }
  return chunks;
}

export async function fetchReadingLogsByPlanIds(client, planIds = [], options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize) || 40);
  const pageSize = Math.max(1, Math.min(200, Number(options.pageSize) || 200));
  const chunks = chunkUniqueValues(planIds, batchSize);
  if (!client || chunks.length === 0) return { data: [], error: null };

  const results = await Promise.all(chunks.map(async chunk => {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from("reading_logs")
        .select("id, user_id, book, chapter, read_at, plan_id, round")
        .in("plan_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { data: [], error };
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return { data: rows, error: null };
  }));

  const failed = results.find(result => result.error);
  if (failed) return { data: [], error: failed.error };
  return { data: results.flatMap(result => result.data), error: null };
}

export const PLAN_READING_LOG_DIGEST_RPC = "get_plan_reading_log_digest";

// get_plan_reading_log_digest 的回傳 [{ u, p, l: [[book, chapter, round, read_at], …] }, …]
// 還原成跟 fetchReadingLogsByPlanIds 相同欄位的紀錄（不含 log id，下游沒有用到）。
export function expandReadingLogDigest(digest) {
  const rows = [];
  (Array.isArray(digest) ? digest : []).forEach(group => {
    if (!group || !group.u || !Array.isArray(group.l)) return;
    group.l.forEach(entry => {
      if (!Array.isArray(entry)) return;
      const [book, chapter, round, readAt] = entry;
      rows.push({ user_id: group.u, book, chapter, round, read_at: readAt, plan_id: group.p ?? null });
    });
  });
  return rows;
}

// 計畫統計／組員總覽用（#394）：一次 RPC 拿回精簡紀錄。RPC 還沒部署、本機開發
// 用真的 Supabase client（這支只給 service_role）或任何失敗時，退回舊的分頁查詢，
// 所以前後端部署順序不拘。
export async function fetchPlanReadingLogs(client, planIds = [], options = {}) {
  const uniquePlanIds = chunkUniqueValues(planIds, Number.MAX_SAFE_INTEGER)[0] || [];
  if (!client || uniquePlanIds.length === 0) return { data: [], error: null };
  if (typeof client.rpc === "function") {
    try {
      const { data, error } = await client.rpc(PLAN_READING_LOG_DIGEST_RPC, { p_plan_ids: uniquePlanIds });
      if (!error && Array.isArray(data)) return { data: expandReadingLogDigest(data), error: null };
      if (error) console.warn("Reading log digest RPC failed; falling back to paged reading_logs.", error);
    } catch (err) {
      console.warn("Reading log digest RPC threw; falling back to paged reading_logs.", err);
    }
  }
  return fetchReadingLogsByPlanIds(client, uniquePlanIds, options);
}

export const PLAN_STATS_ROSTER_RPC = "get_plan_stats_roster";

// get_plan_stats_roster 的回傳（#397）還原成舊分頁路徑的四份資料：
// profiles（不含下游沒用到的 email、managed_*）、報名、打卡紀錄（同 expandReadingLogDigest）、
// 今天的靈修筆記 [{ user_id, content }]。格式不對就回 null，呼叫端退回分頁路徑。
export function expandPlanStatsRoster(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { profiles, plans, logs, notes } = payload;
  if (![profiles, plans, logs, notes].every(Array.isArray)) return null;
  return {
    usersProfiles: profiles.filter(profile => profile && profile.id),
    allPlans: plans.filter(plan => plan && plan.id),
    allLogs: expandReadingLogDigest(logs),
    todayNotes: notes
      .filter(note => Array.isArray(note) && note[0])
      .map(([userId, content]) => ({ user_id: userId, content }))
  };
}

// 計畫統計名單一次 RPC 拿回（#397）。planAliases 是 null 代表沒有計畫篩選。
// 可見範圍由 nlc-data 注入，這裡不帶。RPC 還沒部署、本機用真的 Supabase client
// （這支只給 service_role）或任何失敗時回 null，呼叫端退回分頁路徑，所以部署順序不拘。
export async function fetchPlanStatsRoster(client, { planAliases = null, pastoralZone = "", noteDate = null } = {}) {
  if (!client || typeof client.rpc !== "function") return null;
  try {
    const { data, error } = await client.rpc(PLAN_STATS_ROSTER_RPC, {
      p_plan_aliases: Array.isArray(planAliases) ? planAliases : null,
      p_pastoral_zone: pastoralZone || null,
      p_note_date: noteDate || null
    });
    if (error) {
      console.warn("Plan stats roster RPC failed; falling back to paged queries.", error);
      return null;
    }
    const expanded = expandPlanStatsRoster(data);
    if (!expanded) console.warn("Plan stats roster RPC returned an unexpected shape; falling back to paged queries.");
    return expanded;
  } catch (err) {
    console.warn("Plan stats roster RPC threw; falling back to paged queries.", err);
    return null;
  }
}
