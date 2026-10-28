// 把同一瞬間發出的 nlc-data 讀取併成一支 action:"batch"（#631）。
//
// 首頁畫面一出來，各區塊會同時發十幾支讀取；每支都要各自付一次 Edge Function
// 轉發層的延遲（約 250ms）和一次 Logto 驗證。這裡在短時間窗（預設 10ms，同
// Apollo BatchHttpLink 的 batchInterval）內收集可合併的讀取，一次送出，再依原
// 順序把每一格的結果還給各自的呼叫端。呼叫端不用改：回傳的 { data, error } 形狀
// 和單支請求一樣（錯誤時 error 就是伺服器回的 { error, code } 本身）。
//
// 只要不是「這一格自己的錯誤」（整支失敗、逾時、斷線、伺服器還不認得 batch），
// 就退回逐支送出，行為跟沒合併時一模一樣。
//
// 相同的讀取在進行中、或成功回來 3 秒內再發，直接共用那一次的結果（同 SWR 的
// dedupingInterval）。開機先用快照畫首頁、網路資料回來再重畫一次（#630），兩次
// 畫面的各區塊會發一模一樣的讀取，不共用就每次開機多 7～9 支請求。任何寫入
// （送出時和完成時各一次）都清掉共用結果，寫完之後的讀取一定重新抓。

// 跟 supabase/functions/nlc-data/index.ts 的 BATCH_RPC_FUNCTIONS 一致（測試會比對）
export const BATCHABLE_RPC_FUNCTIONS = new Set([
  "get_todays_lightning_quiz",
  "get_lightning_quiz_week_ranking",
  "exam_home_exams",
  "exam_home_banner",
  "get_org_structure_tree",
  // 開首頁時就會發的通知鈴鐺
  "get_quiz_notifications",
  "get_exam_notifications",
  "issue_thread_unread_summary",
  "get_commentary_review_notifications"
]);

export const MAX_BATCH_QUERIES = 25;
export const DEFAULT_BATCH_WINDOW_MS = 10;
export const DEFAULT_DEDUPE_MS = 3000;

// nlc-data 允許的 RPC 裡，名稱帶 get_／list_ 的都只讀（get_xxx、exam_get_xxx、admin_list_xxx…）
const READ_ONLY_RPC_NAME = /(^|_)(get|list)_/;

export function isCoalescableNlcRead(request) {
  if (!request || typeof request !== "object") return false;
  const action = request.action || "select";
  if (action === "select") return typeof request.table === "string" && request.table.length > 0;
  if (action === "rpc") return BATCHABLE_RPC_FUNCTIONS.has(String(request.function || ""));
  return false;
}

// 只讀的請求可以共用結果；其餘一律當寫入，會清掉共用結果
export function isReadOnlyNlcRequest(request) {
  if (isCoalescableNlcRead(request)) return true;
  return Boolean(request && request.action === "rpc" && READ_ONLY_RPC_NAME.test(String(request.function || "")));
}

// 伺服器還不認得 action:"batch"（前端先上線、Edge Function 還沒部署）
function isBatchUnsupported(error) {
  const code = error && (error.error || error.message || error);
  return code === "missing_table" || code === "unsupported_action";
}

// 共用的結果每個呼叫端各拿一份，誰改了自己那份都不影響別人
const copyResult = (value) => {
  if (value === undefined) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
};

export function createReadCoalescer({
  sendOne,
  sendBatch,
  isBatchable = isCoalescableNlcRead,
  isReadOnly = isReadOnlyNlcRequest,
  windowMs = DEFAULT_BATCH_WINDOW_MS,
  maxBatch = MAX_BATCH_QUERIES,
  dedupeMs = DEFAULT_DEDUPE_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
  now = () => Date.now()
}) {
  let pending = [];
  let scheduled = false;
  let batchUnsupported = false;
  // 舊版伺服器的 batch 只收 select：被退一次之後 RPC 就直接單支送，不再每批多繞一趟
  let rpcBatchUnsupported = false;
  // 請求內容（JSON）→ { settledAt, shared }；settledAt 為 null 表示還在路上
  const recent = new Map();

  const invalidate = () => recent.clear();

  const sendEach = (entries) => {
    for (const entry of entries) {
      Promise.resolve().then(() => sendOne(entry.request)).then(entry.resolve, entry.reject);
    }
  };

  const flushChunk = async (entries) => {
    if (entries.length === 1 || batchUnsupported) {
      sendEach(entries);
      return;
    }
    let outcome;
    try {
      outcome = await sendBatch(entries.map(entry => entry.request));
    } catch (_batchError) {
      sendEach(entries);
      return;
    }
    const rows = outcome && Array.isArray(outcome.data) ? outcome.data : null;
    if (!rows) {
      if (isBatchUnsupported(outcome && outcome.error)) batchUnsupported = true;
      sendEach(entries);
      return;
    }
    entries.forEach((entry, index) => {
      const row = rows[index];
      // 舊版伺服器還不收 batch 裡的 RPC：這一格改成單支送
      if (!row || row.error === "batch_read_only") {
        if (row && entry.request.action === "rpc") rpcBatchUnsupported = true;
        sendEach([entry]);
        return;
      }
      if (row.error) {
        const { data: _unused, ...error } = row;
        entry.resolve({ data: null, error });
        return;
      }
      entry.resolve({ data: row.data, error: null });
    });
  };

  const flush = () => {
    scheduled = false;
    const entries = pending;
    pending = [];
    for (let start = 0; start < entries.length; start += maxBatch) {
      flushChunk(entries.slice(start, start + maxBatch));
    }
  };

  const sendRead = (request) => {
    if (batchUnsupported || !isBatchable(request)) return sendOne(request);
    if (rpcBatchUnsupported && request.action === "rpc") return sendOne(request);
    return new Promise((resolve, reject) => {
      pending.push({ request, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        schedule(flush, windowMs);
      }
    });
  };

  const isFresh = (entry, at) => entry.settledAt === null || at - entry.settledAt < dedupeMs;

  return {
    invalidate,
    send(request) {
      if (!isReadOnly(request)) {
        invalidate();
        const result = sendOne(request);
        Promise.resolve(result).then(invalidate, invalidate);
        return result;
      }
      // 先拍下這一刻的請求內容：等到送出時呼叫端就算再改 builder 也不影響
      const snapshot = JSON.parse(JSON.stringify(request));
      const key = JSON.stringify(snapshot);
      const at = now();
      const hit = recent.get(key);
      if (hit && isFresh(hit, at)) return hit.shared.then(copyResult);
      if (recent.size > 100) {
        for (const [oldKey, entry] of recent) if (!isFresh(entry, at)) recent.delete(oldKey);
      }

      const result = sendRead(snapshot);
      const entry = { settledAt: null, shared: null };
      const drop = () => { if (recent.get(key) === entry) recent.delete(key); };
      // 先掛上這一段：在第一個呼叫端拿到結果、可能改動它之前就留一份
      entry.shared = result.then(value => {
        if (!value || value.error) drop();
        else entry.settledAt = now();
        return copyResult(value);
      }, error => {
        drop();
        throw error;
      });
      entry.shared.catch(() => {});
      recent.set(key, entry);
      return result;
    }
  };
}
