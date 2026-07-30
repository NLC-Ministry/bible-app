export function formatUpcomingPlanCountdown(startDate, now = new Date()) {
  const match = String(startDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(year, month, day);
  const today = new Date(now);
  if (
    Number.isNaN(today.getTime())
    || start.getFullYear() !== year
    || start.getMonth() !== month
    || start.getDate() !== day
  ) {
    return "";
  }

  today.setHours(0, 0, 0, 0);
  const remainingDays = Math.ceil((start.getTime() - today.getTime()) / 86400000);
  return remainingDays > 0 ? `倒數 ${remainingDays} 天` : "";
}