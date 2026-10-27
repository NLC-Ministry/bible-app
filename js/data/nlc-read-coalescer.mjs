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

// 跟 supabase/functions/nlc-data/index.ts 的 BATCH_RPC_FUNCTIONS 一致（測試會比對）
export const BATCHABLE_RPC_FUNCTIONS = new Set([
  "get_todays_lightning_quiz",
  "get_lightning_quiz_week_ranking",
  "exam_home_exams",
  "exam_home_banner",
  "get_org_structure_tree"
]);

export const MAX_BATCH_QUERIES = 25;
export const DEFAULT_BATCH_WINDOW_MS = 10;

export function isCoalescableNlcRead(request) {
  if (!request || typeof request !== "object") return false;
  const action = request.action || "select";
  if (action === "select") return typeof request.table === "string" && request.table.length > 0;
  if (action === "rpc") return BATCHABLE_RPC_FUNCTIONS.has(String(request.function || ""));
  return false;
}

// 伺服器還不認得 action:"batch"（前端先上線、Edge Function 還沒部署）
function isBatchUnsupported(error) {
  const code = error && (error.error || error.message || error);
  return code === "missing_table" || code === "unsupported_action";
}

export function createReadCoalescer({
  sendOne,
  sendBatch,
  isBatchable = isCoalescableNlcRead,
  windowMs = DEFAULT_BATCH_WINDOW_MS,
  maxBatch = MAX_BATCH_QUERIES,
  schedule = (fn, ms) => setTimeout(fn, ms)
}) {
  let pending = [];
  let scheduled = false;
  let batchUnsupported = false;

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

  return {
    send(request) {
      if (batchUnsupported || !isBatchable(request)) return sendOne(request);
      return new Promise((resolve, reject) => {
        // 先拍下這一刻的請求內容：等到送出時呼叫端就算再改 builder 也不影響
        pending.push({ request: JSON.parse(JSON.stringify(request)), resolve, reject });
        if (!scheduled) {
          scheduled = true;
          schedule(flush, windowMs);
        }
      });
    }
  };
}
