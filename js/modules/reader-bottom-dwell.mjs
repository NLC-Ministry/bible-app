export function isReaderSurfaceAtBottom(surface, threshold = 24) {
  if (!surface) return false;
  const remaining = Number(surface.scrollHeight || 0)
    - Number(surface.scrollTop || 0)
    - Number(surface.clientHeight || 0);
  return remaining <= Math.max(0, Number(threshold) || 0);
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

  const cancel = () => {
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
    pendingTargetKey = null;
    pendingSurface = null;
  };

  const reset = () => {
    cancel();
    completedTargetKey = null;
    completingTargetKey = null;
  };

  const handleScroll = (surface, { eligible = false, targetKey = "" } = {}) => {
    const resolvedTargetKey = String(targetKey || "");
    if (!eligible || !resolvedTargetKey || !isReaderSurfaceAtBottom(surface, bottomThreshold)) {
      cancel();
      return;
    }
    if (completedTargetKey === resolvedTargetKey || completingTargetKey === resolvedTargetKey) return;
    if (timerId !== null && pendingTargetKey === resolvedTargetKey) return;

    cancel();
    pendingTargetKey = resolvedTargetKey;
    pendingSurface = surface;
    timerId = setTimeout(() => {
      const completedKey = pendingTargetKey;
      const completedSurface = pendingSurface;
      timerId = null;
      pendingTargetKey = null;
      pendingSurface = null;
      if (!completedKey || !isReaderSurfaceAtBottom(completedSurface, bottomThreshold)) return;

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
