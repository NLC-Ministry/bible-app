function chapterKey(book, chapter) {
  return `${book || ""}_${Number(chapter) || 0}`;
}

export function getPlanChapterKeys(plan) {
  const keys = new Set();
  (plan && Array.isArray(plan.days) ? plan.days : []).forEach(day => {
    (Array.isArray(day && day.chapters) ? day.chapters : []).forEach(chapter => {
      keys.add(chapterKey(chapter.book, chapter.chapter));
    });
  });
  return keys;
}

export function isReadingLogForPlan(log, plan, planChapterKeys = getPlanChapterKeys(plan)) {
  if (!log || !plan) return false;
  const logPlanId = log.plan_id || null;
  const logPresetKey = log.presetKey || log.preset_key || null;
  if (plan.id && logPlanId === plan.id) return true;
  if (plan.presetKey && logPresetKey === plan.presetKey) return true;
  if (logPlanId || logPresetKey) return false;
  return planChapterKeys.has(chapterKey(log.book, log.chapter));
}

export function removePlanReadingLogs(logs, plan) {
  const planChapterKeys = getPlanChapterKeys(plan);
  return (Array.isArray(logs) ? logs : []).filter(log =>
    !isReadingLogForPlan(log, plan, planChapterKeys)
  );
}

export function resetPlanProgressState(plan) {
  if (!plan) return plan;
  plan.level = "normal";
  plan.currentRound = 1;
  plan.upgradePromptHandled = false;
  plan.lastUpgradedRound = null;
  plan.lastPromptedRound = null;
  plan.upgradeOverlayDismissedRound = null;
  plan.progress = 0;
  plan.completedChapters = 0;
  plan.isPlanCompleted = false;
  plan.isRound2Completed = false;
  plan.round2UpgradePromptHandled = false;

  (Array.isArray(plan.days) ? plan.days : []).forEach(day => {
    (Array.isArray(day.chapters) ? day.chapters : []).forEach(chapter => {
      chapter.isRead = false;
      Object.keys(chapter).forEach(key => {
        if (/^isReadR\d+$/.test(key)) chapter[key] = false;
      });
    });
  });
  return plan;
}
