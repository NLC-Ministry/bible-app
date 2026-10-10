// 打卡紀錄按需載入（#474）。
//
// 開機只抓「還能打卡的計畫」＋無歸屬紀錄（plan_id 為空）的逐筆紀錄；已關閉的計畫只拿
// 「每一遍讀過哪些章」的摘要（get_my_reading_log_digest），點進那個計畫才抓逐筆紀錄。
// 摘要讓獎章、鐵獎、已結束清單、遍數確認、連續天數在沒有逐筆紀錄時也算得跟以前一樣——
// 這些開機就會讀已結束計畫的 progress／currentRound，而獎章還會把結果寫回本機快取，
// 少算一次就會把已拿到的獎章熄掉。
//
// scope.mode：
//   "all"  ：state.readingLogs 是全部紀錄（本機模式、摘要拿不到時的退路、#474 之前的離線快照）
//   "open" ：只有 openPlanIds＋無歸屬紀錄＋按需載入過的 loadedPlanIds；其餘計畫看 digest
import { MAX_PLAN_GRACE_DAYS, isPlanCheckInClosed } from "./plan-checkin-window.mjs";

export const READING_LOG_SELECT = "book, chapter, read_at, plan_id, round";
export const READING_LOG_DIGEST_RPC = "get_my_reading_log_digest";

const ALL_SCOPE = Object.freeze({ mode: "all", openPlanIds: [], loadedPlanIds: [] });

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
}

export function createReadingLogScope({ mode = "all", openPlanIds = [], loadedPlanIds = [] } = {}) {
  if (mode !== "open") return ALL_SCOPE;
  const open = uniqueIds(openPlanIds);
  return { mode: "open", openPlanIds: open, loadedPlanIds: uniqueIds([...open, ...loadedPlanIds]) };
}

export function addLoadedPlanToScope(scope, planId) {
  if (!scope || scope.mode !== "open" || !planId) return scope || ALL_SCOPE;
  return createReadingLogScope({ ...scope, loadedPlanIds: [...scope.loadedPlanIds, planId] });
}

// 從離線快照還原的 scope：沒有、或格式不對 → 當成舊快照（全部紀錄）。
export function parseReadingLogScope(value) {
  if (!value || typeof value !== "object" || value.mode !== "open") return ALL_SCOPE;
  return createReadingLogScope({ mode: "open", openPlanIds: value.openPlanIds });
}

// 按需載入過的計畫（不含開機範圍）。
export function getLazilyLoadedPlanIds(scope) {
  if (!scope || scope.mode !== "open") return [];
  return scope.loadedPlanIds.filter(id => !scope.openPlanIds.includes(id));
}

export function isPlanReadingLogsLoaded(scope, planId) {
  if (!scope || scope.mode !== "open" || !planId) return true;
  return scope.loadedPlanIds.includes(String(planId));
}

// ── 哪些計畫開機要載逐筆紀錄 ─────────────────────────────────────────────
// 跟伺服器觸發器 enforce_reading_log_stage_progress_open 同一條規則：連結的 global_plan
// 是固定日期、台北今天 > end_date + grace_days 才算關閉。
//   · 沒連結 global_plan（個人計畫）：用報名列自己的 end_date——前端打卡（logChapterRead
//     的 isPlanCheckInClosed）也是這樣擋。
//   · 有 global_plan_id 但這個人看不到那一列（隱藏計畫被 nlc-data 濾掉）：寬限期不知道，
//     保守給最長的，寧可多載也不要把還能打卡的計畫當成已關閉。
export function isEnrollmentCheckInClosed(enrollment, globalPlanRow = null, options = {}) {
  if (!enrollment) return false;
  if (globalPlanRow) {
    return isPlanCheckInClosed({
      endDate: globalPlanRow.end_date,
      isFixed: globalPlanRow.is_fixed !== false,
      graceDays: globalPlanRow.grace_days
    }, options);
  }
  return isPlanCheckInClosed({
    endDate: enrollment.end_date,
    isFixed: enrollment.is_fixed !== false,
    graceDays: enrollment.global_plan_id ? MAX_PLAN_GRACE_DAYS : 0
  }, options);
}

export function partitionEnrollmentsByCheckIn(enrollments, globalPlanRows = [], options = {}) {
  const globalById = new Map((Array.isArray(globalPlanRows) ? globalPlanRows : [])
    .filter(row => row && row.id)
    .map(row => [String(row.id), row]));
  const openPlanIds = [];
  const closedPlanIds = [];
  (Array.isArray(enrollments) ? enrollments : []).forEach(enrollment => {
    if (!enrollment || !enrollment.id) return;
    const globalRow = enrollment.global_plan_id ? globalById.get(String(enrollment.global_plan_id)) : null;
    (isEnrollmentCheckInClosed(enrollment, globalRow, options) ? closedPlanIds : openPlanIds).push(String(enrollment.id));
  });
  return { openPlanIds: uniqueIds(openPlanIds), closedPlanIds: uniqueIds(closedPlanIds) };
}

// 開機查詢的篩選：還能打卡的計畫＋無歸屬紀錄。分頁的唯一排序（.order("id")，#348）由呼叫端加。
export function applyOpenReadingLogFilter(query, openPlanIds) {
  const ids = uniqueIds(openPlanIds);
  return ids.length
    ? query.or(`plan_id.in.(${ids.join(",")}),plan_id.is.null`)
    : query.is("plan_id", null);
}

// IndexedDB 快取 key：開機範圍一份、每個按需載入的計畫各一份。寫入時兩個都失效。
export function readingLogOpenCacheKey(userId) {
  return `reading_logs:${userId}:open`;
}

export function readingLogPlanCacheKey(userId, planId) {
  return `reading_logs:${userId}:plan:${planId}`;
}

export function readingLogCacheKeys(userId, planId = null) {
  if (!userId) return [];
  return planId
    ? [readingLogOpenCacheKey(userId), readingLogPlanCacheKey(userId, planId)]
    : [readingLogOpenCacheKey(userId)];
}

// #474 之前整包紀錄的快取 key；開機成功後順手清掉。
export function legacyReadingLogCacheKey(userId) {
  return `reading_logs:${userId}`;
}

// ── 摘要 ──────────────────────────────────────────────────────────────────
// RPC 回傳 { chapters: [{ plan_id, round, book, chapters: [int] }], read_dates: ["YYYY-MM-DD"] }
// 正規化成 { byPlan: { [planId]: { [round]: { [book]: [int] } } }, readDates: [...] }。
// 格式不對 → null（呼叫端退回抓逐筆紀錄）。
export function normalizeReadingLogDigest(payload) {
  let value = payload;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (_) { return null; }
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.chapters)) return null;
  const byPlan = {};
  value.chapters.forEach(row => {
    if (!row || !row.plan_id || !row.book || !Array.isArray(row.chapters)) return;
    const planId = String(row.plan_id);
    const round = Math.max(1, Math.floor(Number(row.round) || 1));
    const chapters = row.chapters.map(Number).filter(chapter => Number.isInteger(chapter) && chapter > 0);
    if (!chapters.length) return;
    const rounds = byPlan[planId] || (byPlan[planId] = {});
    const books = rounds[round] || (rounds[round] = {});
    books[row.book] = [...new Set([...(books[row.book] || []), ...chapters])].sort((a, b) => a - b);
  });
  const readDates = [...new Set((Array.isArray(value.read_dates) ? value.read_dates : [])
    .map(date => String(date || "").slice(0, 10))
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  return { byPlan, readDates };
}

export function emptyReadingLogDigest() {
  return { byPlan: {}, readDates: [] };
}

// 從離線快照還原（存的就是正規化後的格式）。
export function parseStoredReadingLogDigest(value) {
  if (!value || typeof value !== "object" || !value.byPlan || typeof value.byPlan !== "object") return null;
  return {
    byPlan: value.byPlan,
    readDates: Array.isArray(value.readDates) ? value.readDates.map(String) : []
  };
}

export function removePlanFromDigest(digest, planId) {
  if (!digest || !planId || !digest.byPlan || !digest.byPlan[String(planId)]) return digest;
  const byPlan = { ...digest.byPlan };
  delete byPlan[String(planId)];
  return { ...digest, byPlan };
}

// 計畫逐筆紀錄還沒載入時，給 getConfirmedReadingRound／最大遍數用的「遍數」假紀錄。
export function digestRoundLogs(digest, planId) {
  const rounds = digest && digest.byPlan && planId ? digest.byPlan[String(planId)] : null;
  if (!rounds) return [];
  return Object.keys(rounds)
    .map(Number)
    .filter(round => Object.values(rounds[round] || {}).some(chapters => chapters && chapters.length))
    .sort((a, b) => a - b)
    .map(round => ({ round }));
}

// 摘要裡這個計畫讀過的章：`${round}_${book}_${chapter}`，跟 calculateAllPlansProgress 的 logSet 對得上。
export function digestChapterKeys(digest, planId) {
  const rounds = digest && digest.byPlan && planId ? digest.byPlan[String(planId)] : null;
  const keys = [];
  if (!rounds) return keys;
  Object.keys(rounds).forEach(round => {
    Object.entries(rounds[round] || {}).forEach(([book, chapters]) => {
      (chapters || []).forEach(chapter => keys.push(`${round}_${book}_${chapter}`));
    });
  });
  return keys;
}

// ── 合併逐筆紀錄 ──────────────────────────────────────────────────────────
function readingLogKey(log) {
  return `${log.book}_${log.chapter}_${log.plan_id || ""}_${log.round || 1}`;
}

// 同一章同一計畫同一遍只留一筆（最新的 read_at）——跟原本 applyReadingLogsSnapshot 的去重一樣。
export function dedupeReadingLogs(logs) {
  const uniqueMap = {};
  (Array.isArray(logs) ? logs : []).forEach(log => {
    if (!log) return;
    const key = readingLogKey(log);
    if (!uniqueMap[key] || new Date(log.read_at) > new Date(uniqueMap[key].read_at)) uniqueMap[key] = log;
  });
  return Object.values(uniqueMap);
}

// 開機範圍的新資料進來：換掉同範圍（open 計畫＋無歸屬）的舊紀錄，保留按需載入過、
// 不在 open 範圍的已關閉計畫紀錄。mode "all" → 整包換掉（原本的行為）。
// keepOtherPlans：開機途中 SWR 先發布的資料只換掉 open 範圍、其他計畫的既有紀錄全留著——
// 這時摘要／計畫清單還沒到，不能讓已關閉計畫的進度暫時歸零（獎章會把 0 寫回快取）。
export function mergeOpenScopeReadingLogs(existingLogs, incomingLogs, scope, { keepOtherPlans = false } = {}) {
  if (!scope || scope.mode !== "open") return dedupeReadingLogs(incomingLogs);
  const open = new Set(scope.openPlanIds);
  const loaded = new Set(scope.loadedPlanIds);
  const kept = (Array.isArray(existingLogs) ? existingLogs : []).filter(log =>
    log && log.plan_id && !open.has(String(log.plan_id)) && (keepOtherPlans || loaded.has(String(log.plan_id)))
  );
  return dedupeReadingLogs([...kept, ...(Array.isArray(incomingLogs) ? incomingLogs : [])]);
}

// 按需載入一個計畫：換掉這個計畫的紀錄，其餘不動。
export function mergePlanReadingLogs(existingLogs, planLogs, planId) {
  const id = String(planId);
  const others = (Array.isArray(existingLogs) ? existingLogs : []).filter(log => !log || String(log.plan_id || "") !== id);
  const own = (Array.isArray(planLogs) ? planLogs : []).filter(log => log && String(log.plan_id || "") === id);
  return dedupeReadingLogs([...others.filter(Boolean), ...own]);
}

// 讀經器「已讀」標記、離線快照：只看還能打卡的計畫＋無歸屬紀錄。
export function isLogInOpenScope(scope, log) {
  if (!log) return false;
  if (!scope || scope.mode !== "open") return true;
  const planId = log.plan_id || null;
  return !planId || scope.openPlanIds.includes(String(planId));
}

export function filterOpenScopeLogs(logs, scope) {
  return (Array.isArray(logs) ? logs : []).filter(log => isLogInOpenScope(scope, log));
}

// 連續天數：已載入紀錄的日期 ∪ 摘要的打卡日期（摘要日期是台北時間）。
export function collectReadDateKeys(logs, digest, toDateKey) {
  const dates = new Set();
  (Array.isArray(logs) ? logs : []).forEach(log => {
    const key = log && toDateKey(log.read_at);
    if (key) dates.add(key);
  });
  ((digest && digest.readDates) || []).forEach(date => { if (date) dates.add(String(date)); });
  return [...dates].sort().reverse();
}

// ── 開機載入 ──────────────────────────────────────────────────────────────
// 拿到計畫清單之後才呼叫（要先知道哪些計畫還能打卡）。兩個請求平行：
//   fetchOpenLogs(openPlanIds)：還能打卡的計畫＋無歸屬紀錄的逐筆紀錄 → { data, error }
//   fetchDigest(closedPlanIds)：已關閉計畫的摘要 RPC → { data, error }
// 摘要拿不到（nlc-data 還沒部署、dev 模式沒權限）→ fetchClosedLogs 把已關閉計畫照舊抓逐筆，
// scope 退回 "all"，行為跟 #474 之前一樣。
// 回傳 { logsResult, scope, digest }；logsResult.error 有值時呼叫端保留既有紀錄。
export async function loadBootReadingLogs({
  enrollments,
  globalPlanRows,
  fetchOpenLogs,
  fetchDigest,
  fetchClosedLogs,
  options = {}
}) {
  const { openPlanIds, closedPlanIds } = partitionEnrollmentsByCheckIn(enrollments, globalPlanRows, options);
  const settle = promise => Promise.resolve()
    .then(promise)
    .catch(error => ({ data: null, error: error || { message: "unknown" } }));
  const [logsResult, digestResult] = await Promise.all([
    settle(() => fetchOpenLogs(openPlanIds)),
    closedPlanIds.length
      ? settle(() => fetchDigest(closedPlanIds))
      : Promise.resolve({ data: { chapters: [], read_dates: [] }, error: null })
  ]);
  if (!logsResult || logsResult.error) {
    return { logsResult: logsResult || { data: null, error: { message: "unknown" } }, scope: null, digest: null, openPlanIds, closedPlanIds };
  }
  const digest = digestResult && !digestResult.error ? normalizeReadingLogDigest(digestResult.data) : null;
  if (digest) {
    return {
      logsResult,
      scope: createReadingLogScope({ mode: "open", openPlanIds }),
      digest,
      openPlanIds,
      closedPlanIds
    };
  }
  const closedResult = await settle(() => fetchClosedLogs(closedPlanIds));
  if (!closedResult || closedResult.error) {
    return { logsResult: closedResult || { data: null, error: { message: "unknown" } }, scope: null, digest: null, openPlanIds, closedPlanIds };
  }
  return {
    logsResult: { data: [...(logsResult.data || []), ...(closedResult.data || [])], error: null },
    scope: createReadingLogScope({ mode: "all" }),
    digest: null,
    openPlanIds,
    closedPlanIds
  };
}

// ── 按需載入一個已關閉計畫 ──────────────────────────────────────────────
// isLoaded(planId)：已經有逐筆紀錄就不抓。同一個計畫同時要好幾次只發一個請求。
// fetchPlanLogs(planId) → { data, error }；SWR 快取命中但網路失敗時 data 仍是快取——
// 已關閉計畫的紀錄不會再變，快取跟伺服器一樣，照樣用。
// 回傳 Promise<boolean>：這次有沒有真的載入新資料（呼叫端據此重畫）。
export function createPlanReadingLogLoader({ isLoaded, fetchPlanLogs, applyPlanLogs }) {
  const inflight = new Map();
  return function ensurePlanReadingLogs(planId) {
    if (!planId) return Promise.resolve(false);
    const id = String(planId);
    if (isLoaded(id)) return Promise.resolve(false);
    if (inflight.has(id)) return inflight.get(id);
    const request = (async () => {
      try {
        const result = await fetchPlanLogs(id);
        if (!result || !Array.isArray(result.data)) return false;
        if (isLoaded(id)) return false;
        applyPlanLogs(id, result.data);
        return true;
      } catch (_) {
        return false;
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, request);
    return request;
  };
}
