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
// 把 1..roundCount 遍鋪到同一條日曆上。
//   · 已完成的遍：每章擺在「實際打卡那天」（completedChapterOffsets）。允許多遍疊在同一天
//     —— 不再保留「一遍至少一格」，所以遍數可以超過日曆天數。沒打卡紀錄的章落在該遍
//     推得出的日期範圍內平均分布。
//   · 目前這一遍（round === roundCount）：一律拿到「進入這遍那天 → 階段結束」整段日曆。
//   currentRoundStartOffset：目前這遍的起始 offset（＝確認進入那天）。未給則沿用舊的
//     roundEndOffsets 推法，保持既有呼叫端相容。
// 不變的保證：每個 base 章節、每一遍，剛好被放進「某一天」一次（不漏、不重複）。
// 這函式只決定「顯示在哪天」，不碰任何 reading log／已讀狀態（那些之後由
// calculatePlanProgress 依 state.readingLogs 套上），所以重排絕不會讓打卡資料消失。
export function segmentScheduleDaysForRoundCount(
  days, roundCount, roundEndOffsets = [], completedChapterOffsets = [], currentRoundStartOffset
) {
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
  const result = sourceDays.map(day => ({ ...day, chapters: [] }));
  if (sourceDays.length === 0 || baseChapters.length === 0) return result;

  const clampOffset = value => Math.max(0, Math.min(lastOffset, Math.round(Number(value))));
  const pushChapter = (offset, chapter, round) => {
    const at = Number.isFinite(offset) ? clampOffset(offset) : 0;
    result[at].chapters.push({
      ...chapter,
      round,
      key: `${chapter.book}_${chapter.chapter}_${round}`
    });
  };

  // 目前這遍的起點：優先用呼叫端傳進來的確認進入 offset；否則沿用舊推法。
  const legacyCurrentStart = Number(roundEndOffsets[rounds - 2]);
  const currentStart = Number.isFinite(Number(currentRoundStartOffset))
    ? clampOffset(currentRoundStartOffset)
    : (Number.isFinite(legacyCurrentStart) ? clampOffset(legacyCurrentStart + 1) : 0);

  for (let round = 1; round <= rounds; round += 1) {
    const isCurrent = round === rounds;
    const actualOffsets = completedChapterOffsets[round - 1] instanceof Map
      ? completedChapterOffsets[round - 1]
      : new Map(Object.entries(completedChapterOffsets[round - 1] || {}));

    // 這一遍的參考視窗（用來平均分布「沒有實際打卡紀錄」的章節）
    let winStart;
    let winEnd;
    if (isCurrent) {
      winStart = currentStart;                 // 進入這遍那天
      winEnd = lastOffset;                      // 階段結束
    } else {
      const seen = Array.from(actualOffsets.values()).map(Number).filter(Number.isFinite);
      if (seen.length > 0) {
        winStart = clampOffset(Math.min(...seen)); // 這遍第一次打卡那天
        winEnd = clampOffset(Math.max(...seen));   // 這遍最後一次打卡那天
      } else {
        const prevBoundary = Number(roundEndOffsets[round - 2]);
        const thisBoundary = Number(roundEndOffsets[round - 1]);
        winStart = round === 1
          ? 0
          : (Number.isFinite(prevBoundary) ? clampOffset(prevBoundary + 1) : clampOffset(Math.floor((round - 1) * sourceDays.length / rounds)));
        winEnd = Number.isFinite(thisBoundary)
          ? clampOffset(thisBoundary)
          : clampOffset(Math.floor(round * sourceDays.length / rounds) - 1);
      }
    }
    if (!Number.isFinite(winStart)) winStart = 0;
    if (!Number.isFinite(winEnd) || winEnd < winStart) winEnd = winStart;

    let spreadOffsets = sourceDays
      .map((day, index) => ({ day, index }))
      .filter(({ day, index }) => index >= winStart && index <= winEnd && !day.isRestDay)
      .map(({ index }) => index);
    if (spreadOffsets.length === 0) {
      spreadOffsets = [];
      for (let i = winStart; i <= winEnd; i += 1) spreadOffsets.push(i);
    }
    if (spreadOffsets.length === 0) spreadOffsets = [clampOffset(winStart)];

    // 已完成的遍：每章擺在「當天實際打卡的那一天」（照 reading log 推出的 offset）；
    // 多遍可以疊在同一天（key = book_chapter_round，彼此不衝突）。
    // 沒有打卡紀錄的章（例如目前這遍、或舊資料缺紀錄）→ 在該遍視窗內照閱讀順序平均分配。
    const unplacedChapters = [];
    baseChapters.forEach(chapter => {
      const actualOffset = Number(actualOffsets.get(`${chapter.book}_${chapter.chapter}`));
      if (!isCurrent && Number.isFinite(actualOffset)) {
        pushChapter(actualOffset, chapter, round);
      } else {
        unplacedChapters.push(chapter);
      }
    });
    unplacedChapters.forEach((chapter, index) => {
      const slot = spreadOffsets[Math.floor(index * spreadOffsets.length / Math.max(1, unplacedChapters.length))];
      pushChapter(slot === undefined ? spreadOffsets[0] : slot, chapter, round);
    });
  }
  return result;
}
// 別人的打卡只用 plan_id 撈，不保證書卷在計畫範圍內（例：0142 月度拆分時，開著舊版的
// 使用者把民數記記到了改指 9 月出埃及記的同一筆 enrollment）。只留計畫書卷內的打卡，
// 和自己那邊 uniquePlanLogs 只算 plan.days 章節的口徑一致。沒有書卷清單就不過濾。
export function filterLogsToPlanBooks(logs, books) {
  const list = Array.isArray(logs) ? logs : [];
  const scope = new Set((Array.isArray(books) ? books : []).filter(Boolean).map(String));
  if (scope.size === 0) return list;
  return list.filter(log => log && scope.has(String(log.book)));
}
