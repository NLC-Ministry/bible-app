// 未預期例外對外的回應 body：固定訊息 + request id，細節只留在伺服器 log。
// err.message 可能帶出 Postgres／內部錯誤字串，所以最外層 catch 不再把它回給呼叫端（#606）。
export const INTERNAL_ERROR_MESSAGE = "Internal error. Please retry later and quote the request id if it persists.";

export function buildInternalErrorBody(code, requestId) {
  return { error: code, message: INTERNAL_ERROR_MESSAGE, request_id: requestId };
}
