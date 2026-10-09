// 經文注釋審核（#471）的純函式：狀態標籤、通知文字、錯誤訊息、審核頁分組。
// 審核頁（js/modules/commentary-review.mjs）、後台（js/modules/admin-commentary*.mjs）、
// js/db.js 與通知鈴（js/app.js）共用。
//
// 流程：待審 pending → 通過待發布 approved → 已發布 published（維護者按「最終發布」）
//                  ↘ 退回 returned（附意見）→ 維護者修改後重新送審 → pending

export const REVIEW_STATUSES = Object.freeze(["pending", "returned", "approved", "published"]);
// 審核頁的三個分頁（已發布的不再出現在審核頁）。
export const REVIEW_QUEUE_STATUSES = Object.freeze(["pending", "returned", "approved"]);

export const REVIEW_STATUS_LABELS = Object.freeze({
  pending: "待審",
  returned: "退回",
  approved: "通過待發布",
  published: "已發布"
});

export function isInReview(row) {
  return REVIEW_QUEUE_STATUSES.includes(row?.review_status);
}

export function reviewStatusLabel(status) {
  return REVIEW_STATUS_LABELS[status] || "";
}

// 審核頁：依書卷、狀態篩選，回傳 { counts, items }（items 依經文順序，已由伺服器排好）。
export function filterReviewItems(items, { book = "", status = "pending" } = {}) {
  const inBook = (Array.isArray(items) ? items : []).filter(item => !book || item.book === book);
  const counts = Object.fromEntries(REVIEW_QUEUE_STATUSES.map(key => [key, 0]));
  for (const item of inBook) if (counts[item.review_status] !== undefined) counts[item.review_status] += 1;
  return { counts, items: inBook.filter(item => item.review_status === status) };
}

// 通知鈴的文字。kind：assigned（被指派）、pending（新的待審）、approved（通過待發布）、returned（退回）。
export function commentaryReviewNotificationMessage(notification) {
  const book = `《${notification?.book || ""}》`;
  const count = Math.max(0, Number(notification?.item_count) || 0);
  switch (notification?.kind) {
    case "assigned":
      return count > 0
        ? `你被指派審核${book}的經文注釋，目前有 ${count} 則待審。`
        : `你被指派審核${book}的經文注釋。`;
    case "pending":
      return `${book}有 ${count} 則經文注釋等你審核。`;
    case "approved":
      return `${book}有 ${count} 則經文注釋審核通過，等你最終發布。`;
    case "returned":
      return `${book}有 ${count} 則經文注釋被退回，請查看審核意見。`;
    default:
      return "經文注釋審核有新的消息。";
  }
}

// 審核者收到的（被指派、待審）點了去「我的審核」；管理員收到的（通過、退回）點了去後台。
export function commentaryReviewNotificationTarget(kind) {
  return kind === "approved" || kind === "returned" ? "admin" : "review";
}

// 轉成通知鈴共用的格式（同 care／quiz／exam 通知）。
export function toBellNotification(notification) {
  const updated = notification?.updated_at || notification?.created_at || "";
  return {
    id: notification?.id,
    type: "commentary-review",
    kind: notification?.kind,
    book: notification?.book,
    status: notification?.read_at ? "read" : "unread",
    message: commentaryReviewNotificationMessage(notification),
    createdAt: updated,
    sent_on: formatNotificationDate(updated),
    sender: { role: "admin" }
  };
}

function formatNotificationDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(date);
}

const ERROR_MESSAGES = Object.freeze({
  commentary_review_forbidden: "你沒有被指派審核這一卷。",
  commentary_review_admin_required: "只有系統管理員可以做這件事。",
  commentary_review_not_found: "找不到這則注釋，可能已經被處理過了，請重新整理。",
  commentary_review_note_required: "退回時請寫下審核意見。",
  commentary_review_content_required: "注釋內容不能是空的。",
  commentary_review_profile_not_found: "有選到的會友找不到或已停用，請重新選擇。",
  commentary_review_book_required: "請選擇書卷。",
  commentary_review_target_required: "請選擇要發布的注釋。"
});

export function commentaryReviewErrorMessage(error) {
  const text = String(error?.message || error?.error || error || "");
  const code = Object.keys(ERROR_MESSAGES).find(key => text.includes(key));
  return code ? ERROR_MESSAGES[code] : "操作失敗，請稍後再試。";
}
