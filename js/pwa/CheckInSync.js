// 把 CheckInOutbox（純邏輯）接到 app 上（#356）：
//  - 送出：db.logChapterRead(..., { direct: true }) → 走 #355 的 record/unrecord RPC（RPC 不可用時退回直接寫表）
//  - 何時送：app 啟動、每次 enqueue、online、回前景（app.js onAppForeground）、SW Background Sync、
//    登入身分確認後（db.syncNlcSessionWithSupabase）。沒有輪詢計時器。
//  - 伺服器拒絕：退回那一章的本機狀態、重算進度、重畫、toast 顯示原因
//  - 「N 章等待同步」小提示：outbox 有東西才出現
import { CheckInOutbox, createOfflineOperationsStore } from "./CheckInOutbox.js";
import { checkInReasonMessage } from "../data/check-in-reasons.mjs";

const CHIP_ID = "checkin-pending-chip";
const BACKGROUND_SYNC_TAG = "newlife-reading-sync";

function copyText(key, fallback) {
  const plan = globalThis.window?.APP_COPY?.plan;
  return (plan && plan[key]) || fallback;
}

export function formatPendingCheckIns(template, count) {
  return String(template).split("{count}").join(String(count));
}

function currentUserId() {
  return globalThis.window?.state?.currentProfileId || null;
}

function isOnline() {
  const offlineFlag = Boolean(globalThis.window?.state?.offlineMode);
  const navigatorOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  return navigatorOnline && !offlineFlag;
}

function findPlan(planId) {
  const plans = globalThis.window?.state?.activePlans || [];
  return plans.find(plan => plan && plan.id === planId) || null;
}

export async function sendQueuedCheckIn(item, { db = globalThis.window?.db } = {}) {
  if (!db || typeof db.logChapterRead !== "function") throw new Error("check_in_sender_unavailable");
  const plan = findPlan(item.planId) || { id: item.planId, currentRound: item.round };
  try {
    await db.logChapterRead(item.book, item.chapter, item.checked, item.round, plan, {
      direct: true,
      readAt: item.pressedAt,
      clientId: item.clientId
    });
    return { ok: true, reason: null };
  } catch (error) {
    if (error && error.code === "CHECK_IN_REJECTED") return { ok: false, reason: error.reason || null };
    throw error;
  }
}

// 伺服器拒絕 → 那一章回到按下前的狀態。進度旗標（isReadR{n}）由 calculateAllPlansProgress
// 從 state.readingLogs 重算，所以只要改 readingLogs。
export function revertRejectedCheckIn(item, reason, { win = globalThis.window } = {}) {
  const state = win?.state;
  if (!state) return;
  const sameChapter = log => log && log.plan_id === item.planId && String(log.book) === String(item.book) &&
    Number(log.chapter) === Number(item.chapter) && Number(log.round || 1) === Number(item.round);
  const logs = Array.isArray(state.readingLogs) ? state.readingLogs : [];
  if (item.checked) {
    state.readingLogs = logs.filter(log => !sameChapter(log));
  } else if (!logs.some(sameChapter)) {
    const plan = findPlan(item.planId);
    state.readingLogs = [...logs, {
      book: item.book,
      chapter: Number(item.chapter),
      round: Number(item.round),
      plan_id: item.planId,
      presetKey: plan?.presetKey || null,
      read_at: item.pressedAt
    }];
  }
  if (state.currentUser) state.currentUser.chapters_read = state.readingLogs.length;

  try { win.calculatePlanProgress?.(); } catch (error) { console.warn("[CheckInOutbox] Progress recalculation failed", error); }
  try { win.db?.saveLocalUserStats?.(); } catch (_) { /* stats are best-effort */ }
  const planViewVisible = win.appRouter?.currentTab === "plan-view";
  if (planViewVisible) {
    try { win.renderPlanScheduleTracker?.(true); } catch (error) { console.warn("[CheckInOutbox] Tracker re-render failed", error); }
  }
  try { win.setDataVersion?.(previous => previous + 1); } catch (_) { /* optional */ }
  const EventCtor = win.CustomEvent || CustomEvent;
  win.dispatchEvent?.(new EventCtor("app:dataRefresh", { detail: { scope: "plan", source: "check-in-rejected" } }));
  const message = `${item.book} ${item.chapter}章：${checkInReasonMessage(reason, win.APP_COPY)}`;
  win.showToast?.(message);
}

export function renderPendingCheckInChip(count, { doc = globalThis.document, onTap = null } = {}) {
  if (!doc) return;
  if (doc.documentElement) doc.documentElement.dataset.checkInPending = String(count || 0);
  let chip = doc.getElementById(CHIP_ID);
  if (!count) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = doc.createElement("button");
    chip.id = CHIP_ID;
    chip.type = "button";
    chip.className = "checkin-pending-chip";
    chip.setAttribute("role", "status");
    chip.setAttribute("aria-live", "polite");
    if (typeof onTap === "function") chip.addEventListener("click", onTap);
    doc.body.appendChild(chip);
  }
  const text = formatPendingCheckIns(copyText("checkInPending", "{count} 章等待同步"), count);
  const icon = globalThis.window?.renderIcon?.("refresh", { size: 14 }) || "";
  chip.innerHTML = `${icon}<span></span>`;
  chip.lastElementChild.textContent = text;
  chip.setAttribute("aria-label", `${text}，點一下立即同步`);
}

// 登出前（#356）：outbox 還有東西 → 連線中就先送一次；還剩下的要使用者確認，確認後清掉。
// 回傳 true = 可以登出。
export async function confirmLogoutWithPendingCheckIns({
  outbox = globalThis.window?.checkInOutbox,
  confirm = globalThis.window?.showConfirmDialog,
  online = isOnline
} = {}) {
  if (!outbox || typeof outbox.pendingCount !== "function") return true;
  let pending = outbox.pendingCount();
  if (pending > 0 && online()) {
    try { await outbox.flush({ force: true }); } catch (_) { /* counted below */ }
    pending = outbox.pendingCount();
  }
  if (pending === 0) return true;
  const message = formatPendingCheckIns(
    copyText("checkInLogoutMessage", "還有 {count} 章的打卡還沒送到伺服器，現在登出這些紀錄會遺失。確定要登出嗎？"),
    pending
  );
  const ok = typeof confirm === "function"
    ? await confirm({
      title: copyText("checkInLogoutTitle", "還有打卡沒同步"),
      message,
      confirmText: copyText("checkInLogoutConfirm", "仍要登出"),
      cancelText: copyText("checkInLogoutCancel", "先不要"),
      isDestructive: true
    })
    : globalThis.window?.confirm?.(message);
  if (!ok) return false;
  await outbox.clear();
  return true;
}

function requestBackgroundSync() {
  try {
    const container = navigator.serviceWorker;
    if (!container || !container.controller) return;
    container.ready
      .then(registration => registration.sync?.register(BACKGROUND_SYNC_TAG))
      .catch(() => {});
  } catch (_) { /* Background Sync is optional */ }
}

// app.js 在建立 IndexedDbClient 後呼叫一次。回傳 outbox（也掛在 window.checkInOutbox）。
export function installCheckInSync({ dbClient = null } = {}) {
  if (window.checkInOutbox) return window.checkInOutbox;
  const outbox = new CheckInOutbox({
    store: createOfflineOperationsStore(dbClient),
    send: item => sendQueuedCheckIn(item),
    getUserId: currentUserId,
    isOnline,
    onRejected: (item, reason) => revertRejectedCheckIn(item, reason)
  });
  const flushNow = () => outbox.flush({ force: true }).catch(error => console.warn("[CheckInOutbox] Flush failed", error));

  outbox.addEventListener("change", event => {
    renderPendingCheckInChip(event.detail.pending, { onTap: flushNow });
  });
  const originalEnqueue = outbox.enqueue.bind(outbox);
  outbox.enqueue = async (...args) => {
    const item = await originalEnqueue(...args);
    requestBackgroundSync();
    return item;
  };

  window.addEventListener("online", flushNow);
  try {
    navigator.serviceWorker?.addEventListener?.("message", event => {
      if (event.data && event.data.type === "SYNC_REQUEST") flushNow();
    });
  } catch (_) { /* no service worker support */ }

  window.checkInOutbox = outbox;
  outbox.loadPromise = outbox.load().then(() => {
    // outbox 比 reading_logs 晚讀完時，把待送的打卡補疊上去。
    const state = window.state;
    if (state && outbox.pendingCount() > 0 && typeof window.db?._overlayPendingCheckIns === "function") {
      state.readingLogs = window.db._overlayPendingCheckIns(state.readingLogs || []);
      try { window.calculatePlanProgress?.(); } catch (_) { /* plans may not be loaded yet */ }
    }
    return outbox;
  });
  return outbox;
}
