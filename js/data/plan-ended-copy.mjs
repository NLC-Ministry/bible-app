import { getPlanCheckInDeadline, isPlanCheckInClosed, isPlanInGracePeriod } from "./plan-checkin-window.mjs";

// 計畫過了 endDate 之後的共用文案（#372）。
// 以前各處寫「此計畫已過期，無法再進入進度閱讀」——會友讀成「整個進不去」，
// 以為 App 壞了。統一講清楚：計畫結束了、紀錄都在、可以看、只是不能再打卡。

export function formatPlanEndDate(endDate) {
  const match = String(endDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])}`;
}

export function getPlanEndedNotice(endDate) {
  const date = formatPlanEndDate(endDate);
  const ended = date ? `此計畫已於 ${date} 結束` : "此計畫已結束";
  return `${ended}，紀錄與成績都已保存，可以查看但無法再打卡。`;
}

// 寬限期內（#412）：計畫已結束，但到 deadline 為止仍可補打卡。
export function getPlanGraceNotice(endDate, deadline) {
  const date = formatPlanEndDate(endDate);
  const until = formatPlanEndDate(deadline);
  const ended = date ? `計畫已於 ${date} 結束` : "計畫已結束";
  return until ? `${ended}，寬限期內（到 ${until}）仍可補打卡。` : `${ended}，寬限期內仍可補打卡。`;
}

// 進計畫時要跳的提示：過了寬限期 → 已結束；寬限期內 → 可補打卡；其餘 → null。
export function getPlanCheckInStatusNotice(plan, options = {}) {
  if (isPlanCheckInClosed(plan, options)) return getPlanEndedNotice(plan.endDate || plan.end_date);
  if (isPlanInGracePeriod(plan, options)) {
    return getPlanGraceNotice(plan.endDate || plan.end_date, getPlanCheckInDeadline(plan));
  }
  return null;
}
