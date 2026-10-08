// 打卡截止寬限期（#412）。
// 「計畫已結束」（isPlanExpired）仍照原截止日：顯示、統計參考日、退出、進下一遍都不變。
// 這裡只管「還能不能打卡／取消打卡」：固定日期計畫在 endDate + graceDays 之後才關閉。
// 伺服器觸發器 enforce_reading_log_stage_progress_open 用同一條規則（台北時間），
// 前端只是提早擋、給對的提示；真正的把關在伺服器。

export const MAX_PLAN_GRACE_DAYS = 30;
export const PLAN_CHECKIN_CLOSED_CODE = "reading_log_plan_closed";

function taiwanTodayISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeGraceDays(value) {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(days, MAX_PLAN_GRACE_DAYS);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function getFixedPlanEndDate(plan) {
  if (!plan) return null;
  if (plan.isFixed === false || plan.is_fixed === false) return null;
  const endDate = String(plan.endDate || plan.end_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
}

// 最後一天可以打卡的日期（YYYY-MM-DD）；彈性計畫或沒有截止日 → null。
export function getPlanCheckInDeadline(plan) {
  const endDate = getFixedPlanEndDate(plan);
  if (!endDate) return null;
  return addDaysToDateKey(endDate, normalizeGraceDays(plan.graceDays ?? plan.grace_days));
}

function resolveToday(options) {
  return String(options.todayISO || taiwanTodayISO(options.now)).slice(0, 10);
}

export function isPlanCheckInClosed(plan, options = {}) {
  const deadline = getPlanCheckInDeadline(plan);
  return Boolean(deadline) && resolveToday(options) > deadline;
}

// 已過原截止日、但還在寬限期內。
export function isPlanInGracePeriod(plan, options = {}) {
  const endDate = getFixedPlanEndDate(plan);
  if (!endDate) return false;
  const today = resolveToday(options);
  return today > endDate && today <= getPlanCheckInDeadline(plan);
}

export function isPlanCheckInClosedError(error) {
  if (!error) return false;
  if (error.code === PLAN_CHECKIN_CLOSED_CODE) return true;
  const text = String(error.message || error.error || error.details || error);
  return text.includes(PLAN_CHECKIN_CLOSED_CODE);
}
