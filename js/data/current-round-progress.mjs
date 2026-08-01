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
export function segmentScheduleDaysForRoundCount(days, roundCount, roundEndOffsets = [], completedChapterOffsets = []) {
  const sourceDays = Array.isArray(days) ? days : [];
  const rounds = Math.max(1, Math.floor(toNonNegativeNumber(roundCount) || 1));
  if (rounds === 1) return sourceDays.map(day => ({ ...day, chapters: [...(day.chapters || [])] }));

  const uniqueChapterMap = new Map();
  sourceDays.forEach(day => (day.chapters || []).forEach(chapter => {
    const key = `${chapter.book}_${chapter.chapter}`;
    if (!uniqueChapterMap.has(key)) uniqueChapterMap.set(key, { ...chapter, round: 1 });
  }));
  const baseChapters = Array.from(uniqueChapterMap.values());
  const lastOffset = Math.max(0, sourceDays.length - 1);
  const boundaries = Array.from({ length: rounds - 1 }, (_, index) => {
    const fallback = Math.floor(((index + 1) * sourceDays.length) / rounds) - 1;
    const requested = Number(roundEndOffsets[index]);
    return Math.max(index, Math.min(lastOffset - (rounds - index - 1), Number.isFinite(requested) ? requested : fallback));
  });
  for (let index = 1; index < boundaries.length; index += 1) {
    boundaries[index] = Math.max(boundaries[index], boundaries[index - 1] + 1);
  }

  const result = sourceDays.map(day => ({ ...day, chapters: [] }));
  for (let round = 1; round <= rounds; round += 1) {
    const startOffset = round === 1 ? 0 : boundaries[round - 2] + 1;
    const endOffset = round === rounds ? lastOffset : boundaries[round - 1];
    let offsets = sourceDays
      .map((day, index) => ({ day, index }))
      .filter(({ day, index }) => index >= startOffset && index <= endOffset && !day.isRestDay)
      .map(({ index }) => index);
    if (offsets.length === 0) {
      offsets = sourceDays.map((_, index) => index).filter(index => index >= startOffset && index <= endOffset);
    }
    const actualOffsets = completedChapterOffsets[round - 1] instanceof Map
      ? completedChapterOffsets[round - 1]
      : new Map(Object.entries(completedChapterOffsets[round - 1] || {}));
    const unplacedChapters = [];
    baseChapters.forEach(chapter => {
      const chapterKey = `${chapter.book}_${chapter.chapter}`;
      const actualOffset = Number(actualOffsets.get(chapterKey));
      if (Number.isFinite(actualOffset) && actualOffset >= startOffset && actualOffset <= endOffset) {
        result[actualOffset].chapters.push({
          ...chapter,
          round,
          key: `${chapter.book}_${chapter.chapter}_${round}`
        });
      } else {
        unplacedChapters.push(chapter);
      }
    });
    unplacedChapters.forEach((chapter, index) => {
      const dayOffset = offsets[Math.floor(index * offsets.length / Math.max(1, unplacedChapters.length))];
      if (dayOffset === undefined) return;
      result[dayOffset].chapters.push({
        ...chapter,
        round,
        key: `${chapter.book}_${chapter.chapter}_${round}`
      });
    });
  }
  return result;
}