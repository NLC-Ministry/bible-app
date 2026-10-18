// 「目前讀第幾遍」的確認規則（#564 從 js/data/current-round-progress.mjs 搬來，App 那邊轉出）。
// 伺服器（admin-api、nlc-data 的計畫總覽／名單）和會友 App 共用這一份。

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function getConfirmedReadingRound({ currentRound, upgradePromptHandled = false, logs = [] } = {}) {
  const storedRound = Math.max(1, Math.floor(toNonNegativeNumber(currentRound) || 1));
  if (storedRound === 1) return 1;
  const hasAdvancedRoundReading = (Array.isArray(logs) ? logs : []).some(log =>
    Number(log && (log.round || 1)) >= storedRound
  );
  return upgradePromptHandled || hasAdvancedRoundReading ? storedRound : 1;
}
