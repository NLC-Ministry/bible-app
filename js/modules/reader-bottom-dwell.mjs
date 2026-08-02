export function isReaderSurfaceAtBottom(surface, threshold = 24) {
  if (!surface) return false;
  const remaining = Number(surface.scrollHeight || 0)
    - Number(surface.scrollTop || 0)
    - Number(surface.clientHeight || 0);
  return remaining <= Math.max(0, Number(threshold) || 0);
}

export function observeReaderEndSentinel({
  root = null,
  sentinel,
  onChange = () => {},
  rootMargin = "0px",
  Observer = globalThis.IntersectionObserver
} = {}) {
  if (!sentinel || typeof onChange !== "function" || typeof Observer !== "function") {
    return { observer: null, disconnect() {} };
  }

  const observer = new Observer(entries => {
    entries.forEach(entry => {
      if (entry.target === sentinel) onChange(Boolean(entry.isIntersecting));
    });
  }, { root, threshold: 0.01, rootMargin });
  observer.observe(sentinel);
  return { observer, disconnect: () => observer.disconnect() };
}

export function createReaderBottomDwellController({
  dwellMs = 1000,
  bottomThreshold = 24,
  onComplete = () => {}
} = {}) {
  let timerId = null;
  let pendingTargetKey = null;
  let completedTargetKey = null;
  let completingTargetKey = null;
  let pendingSurface = null;
  let pendingIsAtBottom = null;

  const cancel = () => {
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
    pendingTargetKey = null;
    pendingSurface = null;
    pendingIsAtBottom = null;
  };

  const reset = () => {
    cancel();
    completedTargetKey = null;
    completingTargetKey = null;
  };

  const handleScroll = (surface, {
    eligible = false,
    targetKey = "",
    isAtBottom = null
  } = {}) => {
    const resolvedTargetKey = String(targetKey || "");
    const checkAtBottom = typeof isAtBottom === "function"
      ? isAtBottom
      : () => isReaderSurfaceAtBottom(surface, bottomThreshold);
    if (!eligible || !resolvedTargetKey || !checkAtBottom()) {
      cancel();
      return;
    }
    if (completedTargetKey === resolvedTargetKey || completingTargetKey === resolvedTargetKey) return;
    if (timerId !== null && pendingTargetKey === resolvedTargetKey) return;

    cancel();
    pendingTargetKey = resolvedTargetKey;
    pendingSurface = surface;
    pendingIsAtBottom = checkAtBottom;
    timerId = setTimeout(() => {
      const completedKey = pendingTargetKey;
      const completedSurface = pendingSurface;
      const completedIsAtBottom = pendingIsAtBottom;
      timerId = null;
      pendingTargetKey = null;
      pendingSurface = null;
      pendingIsAtBottom = null;
      if (!completedKey || !completedSurface || !completedIsAtBottom || !completedIsAtBottom()) return;

      completingTargetKey = completedKey;
      Promise.resolve(onComplete(completedKey))
        .then(result => {
          if (result !== false) completedTargetKey = completedKey;
        })
        .catch(error => console.error("Unable to complete reader bottom dwell action", error))
        .finally(() => {
          if (completingTargetKey === completedKey) completingTargetKey = null;
        });
    }, Math.max(0, Number(dwellMs) || 0));
  };

  return { cancel, reset, handleScroll, check: handleScroll };
}
