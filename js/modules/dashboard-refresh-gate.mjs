// 決定一次「請重整首頁」要不要真的做（#672）。
// 不在畫面上：不重整。在畫面上：第一次立刻做（畫面不用等），delayMs 內再來的併成最後補一次。
export const DEFAULT_REFRESH_DELAY_MS = 500;

export function createDashboardRefreshGate({
  isVisible,
  refresh,
  whenHidden = () => {},
  delayMs = DEFAULT_REFRESH_DELAY_MS,
  schedule = (fn, ms) => setTimeout(fn, ms)
}) {
  let cooling = false;
  let requestedAgain = false;

  const request = () => {
    if (!isVisible()) {
      whenHidden();
      return;
    }
    if (cooling) {
      requestedAgain = true;
      return;
    }
    cooling = true;
    schedule(() => {
      cooling = false;
      if (!requestedAgain) return;
      requestedAgain = false;
      if (isVisible()) request();
    }, delayMs);
    refresh();
  };

  return { request };
}
