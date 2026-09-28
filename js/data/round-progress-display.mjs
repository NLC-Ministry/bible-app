// #293：第 2 遍以後不要單獨顯示「0%」，改用「第幾遍」代表進度，避免使用者
// 誤以為前一遍的紀錄不見了。三個顯示點（首頁進行中計畫卡片 home.js、讀經計畫
// 分頁卡片 plan.js 的 renderPlanCardProgressHero、讀經小組名冊
// team-registration.js）共用這裡的文字與門檻，不要各自重複判斷邏輯。
//
// 只管「怎麼顯示」：round/progress/read/total 一律沿用呼叫端已經算好的
// 本遍（current round）資料（例如 plan.progress / plan.completedChapters /
// plan.currentRoundTotalChapters，皆已是 current-round-scoped，見
// js/utils.js 的 calculatePlanProgress），不碰資料庫或排行榜/徽章計算。
//
// 每一格文字都刻意壓在 5 個中文字以內（不含數字）。

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * @param {{round?: number, progress?: number, read?: number, total?: number}} input
 *   round: 目前遍數（1 起算）。progress/read/total 一律是「本遍」的百分比與章數，
 *   不是全計畫累計。
 */
export function getRoundProgressDisplay({ round = 1, progress = 0, read = 0, total = 0 } = {}) {
  const roundNum = Math.max(1, Math.floor(toNonNegativeNumber(round) || 1));
  const isMultiRound = roundNum > 1;
  const clampedProgress = Math.max(0, Math.min(100, Math.round(toNonNegativeNumber(progress))));
  const readCount = Math.round(toNonNegativeNumber(read));
  const totalCount = Math.round(toNonNegativeNumber(total));

  return {
    round: roundNum,
    isMultiRound,
    // 「第 N 遍」：搭配皇冠圖示（data-icon="crown"）取代單獨的 0%／百分比數字。
    roundLabel: `第 ${roundNum} 遍`,
    // 「本遍 X/Y 章」：取代「已完成第 N-1 遍 | 第 N 遍：0%」這類會讓人誤會
    // 紀錄不見的字句。
    roundStatusText: `本遍 ${readCount}/${totalCount} 章`,
    // 「已完成 N 遍」：戳一下提醒卡用，避免把讀完第 1 遍、第 2 遍才剛開始
    // 的人講成「尚未開始」。
    completedRoundsLabel: `已完成 ${roundNum - 1} 遍`,
    // 兩層進度條：底層淡色滿格＝前一遍已完成；上層品牌色＝本遍進度。
    // round 1 時 previousRoundPercent 是 0，呼叫端應維持原本單層進度條（畫面不變）。
    progressLayers: {
      previousRoundPercent: isMultiRound ? 100 : 0,
      currentRoundPercent: clampedProgress
    }
  };
}
