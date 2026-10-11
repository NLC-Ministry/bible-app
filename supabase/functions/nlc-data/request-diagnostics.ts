// 請求 log 與回報診斷資訊（#548）：純函式，給 index.ts 用，也給 scripts/report-diagnostics.test.mjs 測。

// 會友回報附的 metadata.diagnostics 上限。前端自己壓在 8 KB，這裡放寬一倍當保險，超過就整包丟掉。
export const REPORT_DIAGNOSTICS_MAX_BYTES = 16 * 1024;

/** log 裡的請求對象：資料表、RPC 名稱或 batch 筆數；不記篩選條件與 payload。 */
export function requestLogTarget(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const spec = body as Record<string, unknown>;
  const action = typeof spec.action === "string" && spec.action ? spec.action : "select";
  if (action === "rpc") return typeof spec.function === "string" ? spec.function.slice(0, 80) : "";
  if (action === "batch") return `queries:${Array.isArray(spec.queries) ? spec.queries.length : 0}`;
  return typeof spec.table === "string" ? spec.table.slice(0, 80) : "";
}

/** 每個請求一行 JSON log；回報裡的 request_id 在 Supabase 的函式 log 搜得到這一行。 */
export function buildRequestLogLine(entry: {
  requestId: string;
  action: string;
  target: string;
  status: number;
  ms: number;
}): string {
  return JSON.stringify({
    event: "nlc_data_request",
    request_id: entry.requestId,
    action: entry.action || "",
    target: entry.target || "",
    status: entry.status,
    ms: Math.max(0, Math.round(entry.ms))
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 新增回報時，metadata 只留 diagnostics（且不超過上限）；reply 之類的其他鍵一律丟掉，
 * 會友不能在自己的回報塞假的管理員回覆。沒有可用的 diagnostics 就不送 metadata，讓欄位用預設值 {}。
 */
export function sanitizeReportInsertPayload(payload: unknown, maxBytes = REPORT_DIAGNOSTICS_MAX_BYTES): unknown {
  const clean = (row: unknown) => {
    if (!isPlainObject(row)) return row;
    const { metadata, ...rest } = row;
    const diagnostics = isPlainObject(metadata) ? metadata.diagnostics : undefined;
    if (!isPlainObject(diagnostics)) return rest;
    const size = new TextEncoder().encode(JSON.stringify(diagnostics)).byteLength;
    return size <= maxBytes ? { ...rest, metadata: { diagnostics } } : rest;
  };
  return Array.isArray(payload) ? payload.map(clean) : clean(payload);
}
