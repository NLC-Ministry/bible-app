// 章末偵測（#357）：讀到章末只用來讓「完成本章」按鈕閃一下提醒，不會寫入任何紀錄。
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
