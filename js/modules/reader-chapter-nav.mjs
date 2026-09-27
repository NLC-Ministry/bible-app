// js/modules/reader-chapter-nav.mjs
//
// 讀經頁換章的輸入方式（#314）：左右滑動、鍵盤 ← →，以及預載用的「相鄰章」計算。
// 實際換章一律交給 bible.js 的 navigateToChapter(±1)，這裡只判斷「使用者是不是要換章」。

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
 * 在 surface 上綁左右滑動換章。
 * - isEnabled(): 此刻能不能滑（讀經頁在前景、沒有彈窗…）
 * - canNavigate(direction): 那個方向還有章可去（創 1 章 / 啟 22 章回傳 false）
 * - onNavigate(direction): 放手且超過門檻時呼叫
 * - onHint(direction, { progress, armed }): 滑動中更新提示；direction 為 0 代表收起提示
 */
export function createReaderSwipeController({
  surface,
  isEnabled = () => true,
  canNavigate = () => true,
  onNavigate,
  onHint = () => {},
  win = typeof window !== "undefined" ? window : null
} = {}) {
  if (!surface || typeof surface.addEventListener !== "function") {
    return { destroy() {} };
  }

  let gesture = null;

  const viewportWidth = () => Number(win?.innerWidth) || Number(surface.clientWidth) || 0;

  const clearHint = () => onHint(0, { progress: 0, armed: false });

  const abort = () => {
    if (gesture?.hinted) clearHint();
    gesture = null;
  };

  const onTouchStart = event => {
    gesture = null;
    if (!event.touches || event.touches.length !== 1) return;
    if (!isEnabled()) return;
    if (startsOnInteractiveControl(event.target)) return;
    const touch = event.touches[0];
    const width = viewportWidth();
    if (isInSwipeEdgeGuard(touch.clientX, width)) return;
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      width,
      axis: "pending",
      direction: 0,
      armed: false,
      hinted: false
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

    // 長按反白文字後拖曳是在調整選取範圍，不是換章。
    if (hasActiveTextSelection(win)) { abort(); return; }

    const direction = swipeDirectionFromDelta(dx);
    if (!direction || !canNavigate(direction)) {
      if (gesture.hinted) clearHint();
      gesture.hinted = false;
      gesture.direction = 0;
      gesture.armed = false;
      return;
    }

    const commit = getSwipeCommitDistance(gesture.width);
    const progress = Math.min(1, Math.abs(dx) / commit);
    gesture.direction = direction;
    gesture.armed = progress >= 1;
    gesture.hinted = true;
    onHint(direction, { progress, armed: gesture.armed });
  };

  const onTouchEnd = () => {
    if (!gesture) return;
    const { direction, armed, hinted } = gesture;
    gesture = null;
    if (hinted) clearHint();
    if (armed && direction && isEnabled() && canNavigate(direction)) {
      onNavigate?.(direction);
    }
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
