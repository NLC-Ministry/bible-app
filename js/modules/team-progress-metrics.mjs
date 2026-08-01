function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function getMemberOverallPlanProgress(member, totalChapters) {
  const chaptersPerRound = toNonNegativeNumber(totalChapters);
  const round = Math.max(1, Math.floor(toNonNegativeNumber(member && member.currentRound) || 1));
  const currentRoundRead = Math.min(chaptersPerRound, toNonNegativeNumber(member && member.chaptersRead));
  const completedPreviousRounds = (round - 1) * chaptersPerRound;
  const completedChapters = completedPreviousRounds + currentRoundRead;
  const journeyChapters = round * chaptersPerRound;
  const progress = chaptersPerRound > 0
    ? Math.min(100, Math.round(currentRoundRead / chaptersPerRound * 100))
    : 0;

  return { currentRoundRead, completedChapters, journeyChapters, progress, round };
}

export function getTeamOverallPlanProgress(members, totalChapters) {
  const rows = (Array.isArray(members) ? members : []).map(member =>
    getMemberOverallPlanProgress(member, totalChapters)
  );
  const completedChapters = rows.reduce((sum, row) => sum + row.completedChapters, 0);
  const currentRoundReadChapters = rows.reduce((sum, row) => sum + row.currentRoundRead, 0);
  const currentRoundTargetChapters = rows.length * toNonNegativeNumber(totalChapters);
  const journeyChapters = rows.reduce((sum, row) => sum + row.journeyChapters, 0);
  const averageProgress = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length)
    : 0;

  return {
    averageProgress,
    completedChapters,
    currentRoundReadChapters,
    currentRoundTargetChapters,
    journeyChapters,
    rows
  };
}