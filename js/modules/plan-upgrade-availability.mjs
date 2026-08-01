function formatReadingRound(round) {
  const labels = { 1: "第一遍", 2: "第二遍", 3: "第三遍" };
  return labels[Number(round)] || `第 ${Number(round) || 1} 遍`;
}

export function getPlanUpgradeAvailability(plan, { expired = false } = {}) {
  const currentRound = Math.max(1, Number(plan && plan.currentRound) || 1);
  const nextRound = currentRound + 1;
  const total = Number(plan && (plan.currentRoundTotalChapters || plan.totalChapters)) || 0;
  const completed = Number(plan && plan.completedChapters) || 0;
  const progress = Number(plan && plan.progress) || 0;
  const explicitCompletion = currentRound === 1
    ? Boolean(plan && plan.isPlanCompleted)
    : (currentRound === 2
      ? Boolean(plan && plan.isRound2Completed)
      : Boolean(plan && plan[`isRound${currentRound}Completed`]));
  const completedCurrentRound = explicitCompletion
    || progress >= 100
    || (total > 0 && completed >= total);

  return {
    eligible: Boolean(plan) && !expired && completedCurrentRound,
    completedCurrentRound,
    currentRound,
    nextRound,
    currentRoundLabel: formatReadingRound(currentRound),
    nextRoundLabel: formatReadingRound(nextRound)
  };
}
