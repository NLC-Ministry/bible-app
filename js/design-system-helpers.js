/**
 * Design system helpers — browser bundle (window globals).
 * ESM twin: design-system-helpers.mjs (Vitest).
 */

function isChapterReadForRound(ch, round) {
  if (!ch) return false;
  const chRound = ch.round || 1;
  if (chRound < round) return true;
  if (chRound > round) return false;
  if (round === 1) return Boolean(ch.isReadR1 || ch.isRead);
  if (round === 2) return Boolean(ch.isReadR2);
  if (round >= 3) return Boolean(ch.isReadR3);
  return Boolean(ch.isRead);
}

function isPlanDayCompletedForRound(day, round) {
  if (!day || !day.chapters || day.chapters.length === 0) return false;
  return day.chapters.every(ch => isChapterReadForRound(ch, round));
}

function getNextReadingPlanDayPure(plan) {
  if (!plan || !plan.days || plan.days.length === 0) return null;
  const currentRound = plan.currentRound || 1;
  return (
    plan.days.find(day => !isPlanDayCompletedForRound(day, currentRound)) ||
    plan.days[plan.days.length - 1]
  );
}

function getExpectedPlanDayCountPure(plan, now = new Date()) {
  if (!plan || !plan.days) return 0;
  const planStart = new Date(plan.startDate);
  if (isNaN(planStart.getTime())) return 0;
  planStart.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((today - planStart) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(0, Math.min(plan.days.length, elapsedDays));
}

function getPlanProgressStatusFromDesignSystem(plan) {
  if (!plan || !plan.days || plan.days.length === 0) {
    return { label: "進度一致", badgeClass: "stat-badge--brand", diff: 0 };
  }

  const currentRound = plan.currentRound || 1;
  if (currentRound > 1 || plan.isPlanCompleted) {
    return {
      label: "第" + currentRound + "遍",
      badgeClass: currentRound === 2 ? "stat-badge--brand" : "stat-badge--warning",
      diff: 0,
    };
  }

  const nextDay = getNextReadingPlanDayPure(plan);
  const nextDayNum = nextDay ? Number(nextDay.dayNum || 1) : 1;
  const completedBeforeNext = Math.max(0, nextDayNum - 1);
  const expectedDays = getExpectedPlanDayCountPure(plan);
  const diff = completedBeforeNext - expectedDays;

  if (diff > 0) {
    return { label: "超前 " + diff + "天", badgeClass: "stat-badge--success", diff };
  }
  if (diff < 0) {
    return { label: "落後 " + Math.abs(diff) + "天", badgeClass: "stat-badge--danger", diff };
  }
  return { label: "進度一致", badgeClass: "stat-badge--brand", diff: 0 };
}

const STAT_METRIC_CONFIG = {
  streak: { icon: "fire", modifier: "warning" },
  today: { icon: "bookOpen", modifier: "brand" },
  progress: { icon: "trendTwo", modifier: "success" },
  chapters: { icon: "journalText", modifier: "brand" },
  days: { icon: "calendarCheck", modifier: "neutral" },
  round: { icon: "refresh", modifier: "warning" },
  makeup: { icon: "exclamationCircle", modifier: "danger" },
  group: { icon: "people", modifier: "brand" },
};

function getStatMetricConfig(metricKey) {
  return (
    STAT_METRIC_CONFIG[metricKey] || {
      icon: "barChart",
      modifier: "neutral",
    }
  );
}

function getHonorBadgeItemClasses(isUnlocked) {
  return isUnlocked ? "honor-badge-item unlocked" : "honor-badge-item locked";
}

function getMobileNavAriaState(activeTabId, tabTargetId) {
  const isActive = activeTabId === tabTargetId;
  return {
    ariaSelected: isActive ? "true" : "false",
    ariaCurrent: isActive ? "page" : null,
    className: isActive ? "mobile-nav-btn active" : "mobile-nav-btn",
  };
}

window.getPlanProgressStatusFromDesignSystem = getPlanProgressStatusFromDesignSystem;
window.getStatMetricConfig = getStatMetricConfig;
window.getHonorBadgeItemClasses = getHonorBadgeItemClasses;
window.getMobileNavAriaState = getMobileNavAriaState;
