function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function getCurrentRoundChapterProgress(logs, currentRound, totalChapters) {
  const round = Math.max(1, Math.floor(toNonNegativeNumber(currentRound) || 1));
  const total = toNonNegativeNumber(totalChapters);
  const read = (Array.isArray(logs) ? logs : []).filter(log =>
    Number(log && (log.round || 1)) === round
  ).length;
  const progress = total > 0 ? Math.min(100, Math.round(read / total * 100)) : 0;
  return { round, read, total, progress };
}
export function getConfirmedReadingRound({ currentRound, upgradePromptHandled = false, logs = [] } = {}) {
  const storedRound = Math.max(1, Math.floor(toNonNegativeNumber(currentRound) || 1));
  if (storedRound === 1) return 1;
  const hasAdvancedRoundReading = (Array.isArray(logs) ? logs : []).some(log =>
    Number(log && (log.round || 1)) >= storedRound
  );
  return upgradePromptHandled || hasAdvancedRoundReading ? storedRound : 1;
}