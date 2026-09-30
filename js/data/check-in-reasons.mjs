// 打卡 RPC（record_chapter_read / unrecord_chapter_read，#355）回傳的 reason 代碼。
// SQL 端定義在 supabase/migrations/20260930042246_record_chapter_read.sql；兩邊一起改。
//
// ok=false 的是「業務上拒絕」（規則不允許），跟網路／登入失敗（會 throw）分開處理。
// ok=true 也可能帶 reason：already_read / already_unread 表示這次沒有改動任何資料（冪等重送）。

export const CHECK_IN_REASONS = Object.freeze({
  NOT_OWNER: "not_owner",
  INVALID_CHAPTER: "invalid_chapter",
  STAGE_NOT_OPEN: "stage_not_open",
  PLAN_CLOSED: "plan_closed",
  OLD_ROUND: "old_round",
  ALREADY_READ: "already_read",
  ALREADY_UNREAD: "already_unread"
});

const FALLBACK_MESSAGES = Object.freeze({
  not_owner: "這不是你的計畫，無法記錄",
  invalid_chapter: "章節資料不正確，無法記錄",
  stage_not_open: "這個階段尚未開放，無法記錄已讀",
  plan_closed: "計畫已截止，無法再修改打卡",
  old_round: "這是已完成的舊一遍，不能再修改",
  already_read: "這章已經記錄過了",
  already_unread: "這章本來就沒有記錄"
});

const DEFAULT_MESSAGE = "進度沒同步成功，等一下再試試";

export function checkInReasonMessage(reason, copy = globalThis.APP_COPY) {
  const key = String(reason || "");
  const fromCopy = copy && copy.plan && copy.plan.checkInReasons && copy.plan.checkInReasons[key];
  return fromCopy || FALLBACK_MESSAGES[key] || DEFAULT_MESSAGE;
}

// RPC 回傳的 data 正規化成 { ok, reason }。形狀不對 → null（呼叫端當成傳輸錯誤）。
export function normalizeCheckInResult(data) {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object" || typeof value.ok !== "boolean") return null;
  return { ok: value.ok, reason: value.reason == null ? null : String(value.reason) };
}

// 「這支 RPC 在這個環境呼叫不到」：nlc-data 還沒重新部署（forbidden_rpc）、
// migration 還沒套（PGRST202 / 42883 找不到函式），或本機 dev 用真 Supabase client
// 以 authenticated 身分呼叫 service_role-only 函式（42501）。這些情況退回舊的直接寫表路徑。
export function isCheckInRpcUnavailable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const text = String(error.error || error.message || error || "").toLowerCase();
  return code === "PGRST202" || code === "42883" || code === "42501"
    || text === "forbidden_rpc"
    || text.includes("could not find the function")
    || text.includes("permission denied for function");
}
