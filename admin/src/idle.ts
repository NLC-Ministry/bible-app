// 閒置自動登出（#555）：30 分鐘沒有操作就登出，登出前 1 分鐘提醒。
// 用實際經過的時間判斷（不是倒數計時器），筆電闔上、分頁在背景一段時間後回來也會馬上判定。

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;
const CHECK_EVERY_MS = 15 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

type EventTargetLike = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type DocumentLike = EventTargetLike & { visibilityState?: string };

export type IdleWatchOptions = {
  target: EventTargetLike;
  doc: DocumentLike;
  onIdle: () => void;
  onWarn?: (remainingMs: number) => void;
  onActive?: () => void;
  now?: () => number;
  timeoutMs?: number;
  warnBeforeMs?: number;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (id: unknown) => void;
};

/** 開始監看；回傳停止函式。 */
export function startIdleWatch(options: IdleWatchOptions): () => void {
  const now = options.now || (() => Date.now());
  const timeoutMs = options.timeoutMs ?? IDLE_TIMEOUT_MS;
  const warnBeforeMs = options.warnBeforeMs ?? IDLE_WARNING_MS;
  const setIntervalImpl = options.setIntervalImpl || ((fn, ms) => setInterval(fn, ms));
  const clearIntervalImpl = options.clearIntervalImpl || ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  let lastActivity = now();
  let warned = false;
  let stopped = false;

  const check = () => {
    if (stopped) return;
    const idleFor = now() - lastActivity;
    if (idleFor >= timeoutMs) {
      stop();
      options.onIdle();
      return;
    }
    if (!warned && idleFor >= timeoutMs - warnBeforeMs) {
      warned = true;
      options.onWarn?.(timeoutMs - idleFor);
    }
  };
  const onActivity = () => {
    if (stopped) return;
    // 已經超過時間的話先登出，不能因為回來動一下滑鼠就續命
    if (now() - lastActivity >= timeoutMs) {
      check();
      return;
    }
    lastActivity = now();
    if (warned) {
      warned = false;
      options.onActive?.();
    }
  };
  const onVisibility = () => {
    if (options.doc.visibilityState !== "hidden") check();
  };

  const listenerOptions: AddEventListenerOptions = { passive: true, capture: true };
  ACTIVITY_EVENTS.forEach((name) => options.target.addEventListener(name, onActivity, listenerOptions));
  options.doc.addEventListener("visibilitychange", onVisibility);
  const timer = setIntervalImpl(check, CHECK_EVERY_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearIntervalImpl(timer);
    ACTIVITY_EVENTS.forEach((name) => options.target.removeEventListener(name, onActivity, listenerOptions));
    options.doc.removeEventListener("visibilitychange", onVisibility);
  }
  return stop;
}
