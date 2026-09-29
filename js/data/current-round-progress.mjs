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

// ── 日期：一律換成「本地日期」──────────────────────────────────────────
// reading_logs.read_at 是 timestamptz（寫入時 new Date().toISOString()，UTC）。
// 直接 slice(0, 10) 取到的是 UTC 日期——台灣凌晨 00:00–07:59 打的卡會被算成前一天。
// 純日期字串（YYYY-MM-DD）本來就是本地日期，原樣回傳。
export function toLocalDateKey(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return toLocalDateKey(new Date(text));
}

// ── 當天閱讀紀錄（#330）─────────────────────────────────────────────────
// 直接看打卡紀錄：這天（本地日期）在「這個計畫」讀了哪些章，依遍數分組。
// 只算明確歸屬本計畫的紀錄（plan_id / global_plan_id / preset_key），
// 沒有歸屬的紀錄（閱讀器裡 plan_id = NULL 的打卡）不列入。
//   scope：{ planId, globalPlanId, presetKey, chapterOrder }
//     chapterOrder：["book_chapter", ...] 計畫的閱讀順序；有給就只留計畫內的章、照這個順序排。
//   excludeKeys：已經出現在「本遍進度」清單的 book_chapter_round，不重複列。
// 回傳 { total, groups: [{ round, chapters: [{book, chapter}], ranges: [{book, from, to}] }] }，
// 遍數由大到小（最近的遍數在上面）。
function logBelongsToPlan(log, { planId, globalPlanId, presetKey } = {}) {
  if (!log) return false;
  if (planId && log.plan_id && String(log.plan_id) === String(planId)) return true;
  if (globalPlanId && log.global_plan_id && String(log.global_plan_id) === String(globalPlanId)) return true;
  const logPresetKey = log.presetKey || log.preset_key || null;
  if (presetKey && logPresetKey && String(logPresetKey) === String(presetKey)) return true;
  return false;
}

export function getDayReadingRecords(logs, scope = {}, dateKey, excludeKeys = []) {
  const targetDate = toLocalDateKey(dateKey);
  const empty = { total: 0, groups: [] };
  if (!targetDate) return empty;
  const order = Array.isArray(scope.chapterOrder) ? scope.chapterOrder : null;
  const orderIndex = order ? new Map(order.map((key, index) => [String(key), index])) : null;
  const excluded = new Set((excludeKeys || []).map(String));
  const seen = new Set();
  const byRound = new Map();

  (Array.isArray(logs) ? logs : []).forEach(log => {
    if (!logBelongsToPlan(log, scope)) return;
    if (toLocalDateKey(log.read_at || log.readAt) !== targetDate) return;
    const book = String(log.book || "");
    const chapter = Number(log.chapter);
    if (!book || !Number.isFinite(chapter)) return;
    const chapterKey = `${book}_${chapter}`;
    if (orderIndex && !orderIndex.has(chapterKey)) return;
    const round = Math.max(1, Math.floor(Number(log.round) || 1));
    const key = `${chapterKey}_${round}`;
    if (seen.has(key) || excluded.has(key)) return;
    seen.add(key);
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push({ book, chapter, sortIndex: orderIndex ? orderIndex.get(chapterKey) : null });
  });

  const groups = Array.from(byRound.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([round, items]) => {
      const chapters = items
        .sort((a, b) => {
          if (a.sortIndex !== null && b.sortIndex !== null) return a.sortIndex - b.sortIndex;
          if (a.book !== b.book) return a.book.localeCompare(b.book);
          return a.chapter - b.chapter;
        })
        .map(({ book, chapter }) => ({ book, chapter }));
      const ranges = [];
      chapters.forEach(({ book, chapter }) => {
        const last = ranges[ranges.length - 1];
        if (last && last.book === book && last.to + 1 === chapter) last.to = chapter;
        else ranges.push({ book, from: chapter, to: chapter });
      });
      return { round, chapters, ranges };
    });
  return { total: seen.size, groups };
}

// 日曆格用：一次把本計畫的打卡依本地日期算好章數（book_chapter_round 去重），
// 不用每一格各掃一次全部紀錄。口徑和 getDayReadingRecords 一致。
export function countDayReadingRecordsByDate(logs, scope = {}) {
  const order = Array.isArray(scope.chapterOrder) ? new Set(scope.chapterOrder.map(String)) : null;
  const seenByDate = new Map();
  (Array.isArray(logs) ? logs : []).forEach(log => {
    if (!logBelongsToPlan(log, scope)) return;
    const dateKey = toLocalDateKey(log.read_at || log.readAt);
    if (!dateKey) return;
    const chapterKey = `${log.book}_${Number(log.chapter)}`;
    if (order && !order.has(chapterKey)) return;
    if (!seenByDate.has(dateKey)) seenByDate.set(dateKey, new Set());
    seenByDate.get(dateKey).add(`${chapterKey}_${Math.max(1, Math.floor(Number(log.round) || 1))}`);
  });
  const counts = new Map();
  seenByDate.forEach((keys, dateKey) => counts.set(dateKey, keys.size));
  return counts;
}

// ── 照順序打卡（#331）───────────────────────────────────────────────────
// 速讀系列（教會階段計畫、延後大區梯次）的目前這遍：只能勾「下一章」
// （照讀經順序第一個還沒勾的章），只能取消「最後勾的那一章」。
// 舊資料有缺口時，下一章就停在最早的缺口，自然引導先補完。
const SEQUENTIAL_CHECK_PLAN_KINDS = new Set([
  "church_campaign",
  "church_campaign_stage",
  "church_campaign_stage_cohort"
]);

export function isSequentialCheckPlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  return SEQUENTIAL_CHECK_PLAN_KINDS.has(String(plan.planKind || plan.plan_kind || ""));
}

// 目前這遍的閱讀順序：先按日期、同一天內按清單順序。
export function getRoundCheckState(days, round) {
  const targetRound = Math.max(1, Math.floor(Number(round) || 1));
  const order = [];
  const seen = new Set();
  (Array.isArray(days) ? days : []).forEach(day => {
    (day && Array.isArray(day.chapters) ? day.chapters : []).forEach(chapter => {
      if (!chapter || Number(chapter.round || targetRound) !== targetRound) return;
      const key = `${chapter.book}_${Number(chapter.chapter)}`;
      if (seen.has(key)) return;
      seen.add(key);
      order.push(chapter);
    });
  });
  const isRead = chapter => Boolean(chapter[`isReadR${targetRound}`]);
  const nextIndex = order.findIndex(chapter => !isRead(chapter));
  let lastReadIndex = -1;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (isRead(order[i])) { lastReadIndex = i; break; }
  }
  return {
    round: targetRound,
    order,
    nextIndex,
    next: nextIndex >= 0 ? order[nextIndex] : null,
    lastReadIndex,
    lastRead: lastReadIndex >= 0 ? order[lastReadIndex] : null,
    readCount: order.filter(isRead).length,
    total: order.length,
    isComplete: order.length > 0 && nextIndex === -1
  };
}

// 回傳 { ok: true } 或 { ok: false, reason: "not_next" | "not_last", target: {book, chapter} }。
// 不在這遍清單裡的章不受限（例如閱讀器裡讀計畫外的章）。
export function canToggleRoundChapter(checkState, book, chapter, willCheck) {
  if (!checkState || !Array.isArray(checkState.order)) return { ok: true };
  const index = checkState.order.findIndex(item =>
    String(item.book) === String(book) && Number(item.chapter) === Number(chapter)
  );
  if (index < 0) return { ok: true };
  const alreadyRead = Boolean(checkState.order[index][`isReadR${checkState.round}`]);
  if (willCheck) {
    if (alreadyRead || index === checkState.nextIndex) return { ok: true };
    const target = checkState.next;
    return { ok: false, reason: "not_next", target: target ? { book: target.book, chapter: Number(target.chapter) } : null };
  }
  if (!alreadyRead || index === checkState.lastReadIndex) return { ok: true };
  const target = checkState.lastRead;
  return { ok: false, reason: "not_last", target: target ? { book: target.book, chapter: Number(target.chapter) } : null };
}

// 給四個寫入點共用：這次打卡／取消可不可以。不是速讀計畫、不是目前這遍 → 不限。
export function getSequentialCheckBlock(plan, book, chapter, round, willCheck) {
  if (!isSequentialCheckPlan(plan)) return null;
  const currentRound = Math.max(1, Math.floor(Number(plan.currentRound) || 1));
  if (Number(round || currentRound) !== currentRound) return null;
  const result = canToggleRoundChapter(getRoundCheckState(plan.days, currentRound), book, chapter, willCheck);
  return result.ok ? null : result;
}

export function formatSequentialCheckMessage(block, copy = {}) {
  if (!block) return "";
  const label = block.target ? `${block.target.book} ${block.target.chapter}章` : "";
  if (block.reason === "not_last") {
    return String(copy.sequentialUncheckBlocked || "只能取消最後勾的那一章（{chapter}）").replace("{chapter}", label);
  }
  return String(copy.sequentialCheckBlocked || "請照順序打卡，先讀完 {chapter}").replace("{chapter}", label);
}
