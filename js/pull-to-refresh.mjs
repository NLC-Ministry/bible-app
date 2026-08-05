// Pull-to-refresh functionality has been completely disabled and removed at user request.
// This module provides safe no-op stub exports for backwards compatibility.

export function installPullToRefresh() {
  if (typeof window !== "undefined") {
    window.registerPullToRefresh = (handler) => () => {};
  }
  return () => {};
}
