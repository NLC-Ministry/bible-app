// 回報的狀態與結案原因（#683）。後台和 App 泡泡的回覆模式共用；後端的合法值在 _issue_close_report 和 admin-api policy。

/** 可以直接切換的狀態；已結案只能走結案流程。 */
export const REPORT_OPEN_STATUSES = ["pending", "waiting_member", "processing"] as const;

export const REPORT_STATUS_LABEL: Record<string, string> = {
  pending: "待回覆",
  waiting_member: "等會友",
  processing: "等開發",
  resolved: "已結案・已解決",
  ignored: "已結案・已存檔"
};

/** 可以手動選的結案原因。no_response 只有自動結案會用。 */
export const REPORT_CLOSE_REASONS = ["fixed", "answered", "cannot_reproduce", "suggestion_noted", "other"] as const;
export type ReportCloseReason = typeof REPORT_CLOSE_REASONS[number];

export const REPORT_CLOSE_REASON_LABEL: Record<string, string> = {
  fixed: "已修復",
  answered: "已解答",
  cannot_reproduce: "無法重現",
  suggestion_noted: "建議已記錄",
  other: "其他",
  no_response: "會友未回覆"
};

// 伺服器會清掉控制字元，所以預設文字不放換行。
const CLOSE_MESSAGE: Record<ReportCloseReason, string> = {
  fixed: "這個問題已經修好了。請重新開啟 App 確認；如果還有狀況，直接回覆這則訊息就好。",
  answered: "你的問題已經回覆了，先把這則回報結案。如果還有疑問，直接回覆這則訊息就好。",
  cannot_reproduce: "我們查過後重現不出這個狀況，先把這則回報結案。如果再發生，直接回覆這則訊息，並附上截圖會更好查。",
  suggestion_noted: "謝謝你的建議，我們已經記錄下來了，先把這則回報結案。之後如有補充，直接回覆這則訊息就好。",
  other: "這則回報先結案。如果問題還在，直接回覆這則訊息就好。"
};

export function isClosedStatus(status: string): boolean {
  return status === "resolved" || status === "ignored";
}

/** 狀態的顯示文字；已結案且知道原因時寫原因（較早結案的回報沒有原因）。 */
export function reportStatusText(status: string, closeReason?: string | null): string {
  if (isClosedStatus(status) && closeReason && REPORT_CLOSE_REASON_LABEL[closeReason]) {
    return `已結案・${REPORT_CLOSE_REASON_LABEL[closeReason]}`;
  }
  return REPORT_STATUS_LABEL[status] || status;
}

function defaultMessage(reason: string): string {
  return CLOSE_MESSAGE[reason as ReportCloseReason] || "";
}

/** 換原因時帶入新的預設文字；已經手改過的內容不覆蓋。 */
export function closeMessageForReason(currentBody: string, previousReason: string, nextReason: string): string {
  const untouched = !currentBody.trim() || currentBody === defaultMessage(previousReason);
  return untouched ? defaultMessage(nextReason) : currentBody;
}
