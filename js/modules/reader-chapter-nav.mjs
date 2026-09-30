// js/modules/reader-chapter-nav.mjs
//
// 讀經頁換章的輸入方式（#314、#347）：左右滑動、鍵盤 ← →，以及預載用的「相鄰章」計算。
// 實際換章一律交給 bible.js 的 navigateToChapter(±1)，這裡只判斷「使用者是不是要換章」，
// 並在拖動中回報位移，讓翻頁動畫（reader-page-flip.mjs）跟著手指走。

// 從螢幕最邊緣起手的滑動留給系統（Android 返回、iOS 邊緣滑動），不當成換章。
export const SWIPE_EDGE_GUARD_PX = 24;
// 手指移動超過這個距離才開始判斷方向；之前的晃動一律視為點擊／捲動。
export const SWIPE_AXIS_SLOP_PX = 10;
// 水平位移要明顯大於垂直位移（約 34° 以內）才算橫向滑動，斜著滑不算。
export const SWIPE_AXIS_RATIO = 1.5;

// 放開就換章的距離：螢幕寬的 22%，但不少於 56px、不多於 96px。
export function getSwipeCommitDistance(viewportWidth) {
  const width = Number(viewportWidth) || 0;
  return Math.max(56, Math.min(96, width * 0.22));
}

// 快速輕撥（#347）：沒拖到上面的距離，但往同一個方向撥得夠快，也算要換章。
export const FLICK_MIN_VELOCITY = 0.4;   // px/ms
export const FLICK_MIN_DISTANCE_PX = 16;
// 用放開前這段時間內的移動算速度；太短（同一格內連發的事件）不算，免得除以接近 0。
const VELOCITY_WINDOW_MS = 100;
const VELOCITY_MIN_SPAN_MS = 8;

export function shouldCommitSwipe({ dx, velocity = 0, commitDistance }) {
  const distance = Math.abs(Number(dx) || 0);
  if (distance >= Number(commitDistance)) return true;
  const v = Number(velocity) || 0;
  return Math.abs(v) >= FLICK_MIN_VELOCITY
    && distance >= FLICK_MIN_DISTANCE_PX
    && Math.sign(v) === Math.sign(dx);
}

// samples: [{ x, t }]，回傳最後一段的水平速度（px/ms，往左為負）。
export function computeSwipeVelocity(samples) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length < 2) return 0;
  const last = list[list.length - 1];
  let first = list[0];
  for (const sample of list) {
    if (last.t - sample.t <= VELOCITY_WINDOW_MS) { first = sample; break; }
  }
  const span = last.t - first.t;
  if (!(span >= VELOCITY_MIN_SPAN_MS)) return 0;
  return (last.x - first.x) / span;
}

// 往左滑（dx < 0）＝下一章 (+1)；往右滑（dx > 0）＝上一章 (-1)。
export function swipeDirectionFromDelta(dx) {
  if (!dx) return 0;
  return dx < 0 ? 1 : -1;
}

export function isInSwipeEdgeGuard(startX, viewportWidth, guard = SWIPE_EDGE_GUARD_PX) {
  const width = Number(viewportWidth) || 0;
  return startX < guard || (width > 0 && startX > width - guard);
}

// 還沒鎖定方向時回傳 "pending"；鎖定後回傳 "horizontal" 或 "vertical"，
// 一次手勢只鎖一次，鎖成 vertical 就整段交給捲動。
export function resolveSwipeAxis(dx, dy, { slop = SWIPE_AXIS_SLOP_PX, ratio = SWIPE_AXIS_RATIO } = {}) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "pending";
  return ax > ay * ratio ? "horizontal" : "vertical";
}

// 目前在第 bookId 卷第 chapter 章，往 direction 走一章會到哪裡；到聖經頭尾回傳 null。
// 跟 navigateToChapter 一樣跨書卷連續。
export function resolveAdjacentChapter(books, bookId, chapter, direction) {
  if (!Array.isArray(books) || !direction) return null;
  const current = books.find(b => Number(b.id) === Number(bookId));
  if (!current) return null;
  const target = Number(chapter) + (direction > 0 ? 1 : -1);
  if (target >= 1 && target <= current.chapters) {
    return { book: current, chapter: target };
  }
  const neighbor = books.find(b => Number(b.id) === Number(current.id) + (direction > 0 ? 1 : -1));
  if (!neighbor) return null;
  return { book: neighbor, chapter: direction > 0 ? 1 : neighbor.chapters };
}

const INTERACTIVE_TARGET_SELECTOR = [
  "button", "a[href]", "input", "textarea", "select", "label",
  "[contenteditable]:not([contenteditable='false'])", "[role='slider']", "[role='progressbar']",
  "[data-swipe-ignore]"
].join(",");

// 經文 .bible-verse 本身是 role="button"（點一下選取），所以刻意不把 [role=button] 列進來。
function startsOnInteractiveControl(target) {
  return Boolean(target && typeof target.closest === "function" && target.closest(INTERACTIVE_TARGET_SELECTOR));
}

function hasActiveTextSelection(win) {
  try {
    const selection = win.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  } catch {
    return false;
  }
}

/**
 * 在 surface 上偵測左右滑動換章。
 * - isEnabled(): 此刻能不能換章（讀經頁在前景、沒有彈出面板等）
 * - canNavigate(direction): 那個方向有沒有下一章（創 1 章／啟 22 章的邊界回 false）
 * - onGestureStart(): 手指剛放上去（用來把上一個還在播的翻頁動畫直接收尾）
 * - onDragStart(direction): 確定是橫向拖動、要開始跟手了
 * - onDrag(direction, { dx, progress }): 拖動中；progress＝位移佔螢幕寬的比例
 * - onDragEnd({ direction, commit, velocity, immediate }): 放開（或取消）；commit＝要不要換章
 * - onNavigate(direction): 沒給 onDragEnd 時，確定換章就呼叫這個
 */
export function createReaderSwipeController({
  surface,
  isEnabled = () => true,
  canNavigate = () => true,
  onGestureStart = () => {},
  onDragStart = () => {},
  onDrag = () => {},
  onDragEnd = null,
  onNavigate,
  win = typeof window !== "undefined" ? window : null,
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
} = {}) {
  if (!surface || typeof surface.addEventListener !== "function") {
    return { destroy() {} };
  }

  let gesture = null;

  const viewportWidth = () => Number(win?.innerWidth) || Number(surface.clientWidth) || 0;

  const endDrag = (commit, { immediate = false } = {}) => {
    if (!gesture || !gesture.dragging) return;
    const { direction } = gesture;
    const velocity = computeSwipeVelocity(gesture.samples);
    gesture.dragging = false;
    if (typeof onDragEnd === "function") {
      onDragEnd({ direction, commit, velocity, immediate });
    } else if (commit) {
      onNavigate?.(direction);
    }
  };

  const abort = () => {
    endDrag(false, { immediate: true });
    gesture = null;
  };

  const onTouchStart = event => {
    if (gesture?.dragging) abort();
    gesture = null;
    if (!event.touches || event.touches.length !== 1) return;
    if (!isEnabled()) return;
    if (startsOnInteractiveControl(event.target)) return;
    const touch = event.touches[0];
    const width = viewportWidth();
    if (isInSwipeEdgeGuard(touch.clientX, width)) return;
    onGestureStart();
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      width,
      axis: "pending",
      direction: 0,
      dx: 0,
      dragging: false,
      samples: []
    };
  };

  const onTouchMove = event => {
    if (!gesture) return;
    if (!event.touches || event.touches.length !== 1) { abort(); return; }
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (gesture.axis === "pending") {
      gesture.axis = resolveSwipeAxis(dx, dy);
      if (gesture.axis === "pending") return;
      if (gesture.axis === "vertical") { gesture = null; return; }
    }

    // 長按選字後拖動調整選取範圍時，不換章
    if (hasActiveTextSelection(win)) { abort(); return; }

    const direction = swipeDirectionFromDelta(dx);
    if (gesture.dragging && direction !== gesture.direction) {
      // 拖回起點另一側：先把這個方向的翻頁收起來
      endDrag(false, { immediate: true });
    }
    gesture.dx = dx;
    if (!direction || !canNavigate(direction)) {
      gesture.direction = 0;
      return;
    }
    if (!gesture.dragging) {
      gesture.direction = direction;
      gesture.dragging = true;
      gesture.samples = [];
      onDragStart(direction);
    }
    gesture.samples.push({ x: touch.clientX, t: now() });
    if (gesture.samples.length > 12) gesture.samples.shift();
    const progress = gesture.width > 0 ? Math.min(1, Math.abs(dx) / gesture.width) : 0;
    onDrag(direction, { dx, progress });
  };

  const onTouchEnd = () => {
    if (!gesture) return;
    if (gesture.dragging) {
      const commit = shouldCommitSwipe({
        dx: gesture.dx,
        velocity: computeSwipeVelocity(gesture.samples),
        commitDistance: getSwipeCommitDistance(gesture.width)
      }) && isEnabled() && canNavigate(gesture.direction);
      endDrag(commit);
    }
    gesture = null;
  };

  const options = { passive: true };
  surface.addEventListener("touchstart", onTouchStart, options);
  surface.addEventListener("touchmove", onTouchMove, options);
  surface.addEventListener("touchend", onTouchEnd, options);
  surface.addEventListener("touchcancel", abort, options);

  return {
    destroy() {
      abort();
      surface.removeEventListener("touchstart", onTouchStart, options);
      surface.removeEventListener("touchmove", onTouchMove, options);
      surface.removeEventListener("touchend", onTouchEnd, options);
      surface.removeEventListener("touchcancel", abort, options);
    }
  };
}

// 鍵盤 ← → 換章：回傳 -1 / 1，或 0 表示這個按鍵不該處理（打字中、組合鍵、長按重複）。
export function readerArrowKeyDirection(event) {
  if (!event || event.defaultPrevented || event.repeat) return 0;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  const target = event.target;
  if (target && typeof target.closest === "function" &&
      target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider']")) {
    return 0;
  }
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return 0;
}
