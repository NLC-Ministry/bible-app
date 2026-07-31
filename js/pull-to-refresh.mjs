const REFRESH_THRESHOLD = 80;
const MAX_PULL_DISTANCE = 104;
const RESET_DELAY_MS = 450;

export function installPullToRefresh({
  window,
  document,
  fallbackRefresh = () => window.location.reload()
} = {}) {
  if (!window || !document || window.__nlcPullToRefreshInstalled) {
    return () => {};
  }

  window.__nlcPullToRefreshInstalled = true;

  let refreshHandler = null;
  let startPoint = null;
  let pullDistance = 0;
  let status = "idle";

  const indicator = document.createElement("div");
  indicator.className = "pull-to-refresh-status";
  indicator.setAttribute("aria-live", "polite");
  indicator.setAttribute("aria-atomic", "true");
  indicator.textContent = "下拉更新";
  document.body.appendChild(indicator);

  function render(nextStatus = status) {
    status = nextStatus;
    indicator.dataset.status = status;
    indicator.style.setProperty("--pull-distance", `${Math.max(0, pullDistance - 48)}px`);
    indicator.textContent = status === "ready"
      ? "放開更新"
      : status === "refreshing"
        ? "更新中"
        : status === "done"
          ? "已更新"
          : "下拉更新";
  }

  window.registerPullToRefresh = handler => {
    const previousHandler = refreshHandler;
    refreshHandler = handler;

    return () => {
      if (refreshHandler === handler) {
        refreshHandler = previousHandler;
      }
    };
  };

  async function refresh() {
    if (status === "refreshing") return;

    pullDistance = REFRESH_THRESHOLD;
    render("refreshing");

    try {
      await (refreshHandler || fallbackRefresh)();
      render("done");
    } catch (error) {
      console.error("[PullToRefresh] Refresh failed:", error);
      render("idle");
    } finally {
      window.setTimeout(() => {
        pullDistance = 0;
        render("idle");
      }, RESET_DELAY_MS);
    }
  }

  function onTouchStart(event) {
    if (window.scrollY > 0 || status === "refreshing") {
      startPoint = null;
      return;
    }

    const touch = event.touches && event.touches[0];
    startPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchMove(event) {
    const touch = event.touches && event.touches[0];
    if (!startPoint || !touch || window.scrollY > 0) return;

    const deltaY = touch.clientY - startPoint.y;
    const deltaX = Math.abs(touch.clientX - startPoint.x);
    if (deltaY <= 0 || deltaX > deltaY) return;

    event.preventDefault();
    pullDistance = Math.min(deltaY, MAX_PULL_DISTANCE);
    render(pullDistance >= REFRESH_THRESHOLD ? "ready" : "pulling");
  }

  function onTouchEnd() {
    if (!startPoint) return;
    startPoint = null;

    if (pullDistance >= REFRESH_THRESHOLD) {
      refresh();
    } else {
      pullDistance = 0;
      render("idle");
    }
  }

  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("touchcancel", onTouchEnd);

  return () => {
    window.__nlcPullToRefreshInstalled = false;
    delete window.registerPullToRefresh;
    indicator.remove();
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
  };
}
