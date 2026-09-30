// 讀到底自動打卡（#349）的共用判斷。讀經頁與計畫內嵌閱讀器共用。
//
// 原則：讀到底「一定照常記錄」。這裡刻意沒有「照順序打卡」（#331）的條件——
// 那條規則只留在手動勾選；自動打卡遇到還沒輪到的章也照記。
// 其餘無法記錄的情況一律回傳明確的 reason，章末狀態列拿來顯示，不再靜默略過。

export const AUTO_RECORD_REASONS = Object.freeze({
  NO_PLAN: "no_plan",
  ALREADY_READ: "already_read",
  OFFLINE: "offline",
  EXPIRED: "expired",
  LOCKED: "locked",
  OLD_ROUND: "old_round"
});

// 依序判斷；第一個不成立的就是 reason。already_read 排在前面：
// 已經記錄過的章即使計畫後來結束，狀態列也應顯示「已記錄」。
export function getAutoRecordDecision({
  hasTask = false,
  alreadyRead = false,
  offline = false,
  expired = false,
  locked = false,
  isOldRound = false
} = {}) {
  if (!hasTask) return { ok: false, reason: AUTO_RECORD_REASONS.NO_PLAN };
  if (alreadyRead) return { ok: false, reason: AUTO_RECORD_REASONS.ALREADY_READ };
  if (offline) return { ok: false, reason: AUTO_RECORD_REASONS.OFFLINE };
  if (expired) return { ok: false, reason: AUTO_RECORD_REASONS.EXPIRED };
  if (locked) return { ok: false, reason: AUTO_RECORD_REASONS.LOCKED };
  if (isOldRound) return { ok: false, reason: AUTO_RECORD_REASONS.OLD_ROUND };
  return { ok: true, reason: null };
}

// 離線閱讀模式下還能不能打卡（#356）：計畫內的打卡進 outbox、連線後補送，所以照收；
// 只有沒辦法排隊的（自由閱讀、outbox 未就緒）才擋。
export function isCheckInBlockedOffline({ offlineMode = false, plan = null, db = globalThis.db } = {}) {
  if (!offlineMode) return false;
  const canQueue = Boolean(plan && plan.id && db && typeof db.canQueueCheckIn === "function" && db.canQueueCheckIn());
  return !canQueue;
}

export function planIdOf(plan) {
  if (!plan) return "";
  return String(plan.id || plan.globalPlanId || plan.presetKey || "");
}

function normalizeRound(value) {
  const round = Math.floor(Number(value));
  return Number.isFinite(round) && round >= 1 ? round : 1;
}

// 在單一計畫的指定遍數裡找 book+chapter。優先用 preferredDayNum 那天。
// 回傳 { day, chapter, round } 或 null。
export function findChapterInPlan(plan, bookName, chapterNum, { round, preferredDayNum = null } = {}) {
  if (!plan || !Array.isArray(plan.days)) return null;
  const targetRound = normalizeRound(round ?? plan.currentRound);
  const match = day => Array.isArray(day && day.chapters)
    ? day.chapters.find(item =>
      String(item.book) === String(bookName) &&
      Number(item.chapter) === Number(chapterNum) &&
      Number(item.round || targetRound) === targetRound)
    : null;

  if (preferredDayNum != null) {
    const preferred = plan.days.find(day => Number(day.dayNum) === Number(preferredDayNum));
    const chapter = match(preferred);
    if (chapter) return { day: preferred, chapter, round: targetRound };
  }
  for (const day of plan.days) {
    const chapter = match(day);
    if (chapter) return { day, chapter, round: targetRound };
  }
  return null;
}

// 沒有計畫情境（或情境計畫不含這章）時，從所有進行中的計畫挑一個「目前這一遍」含這章的。
// 多個都含時：最近開啟的計畫 > 目前選中的 activePlan > 第一個。
//   plans          — state.activePlans
//   lastOpened     — { [planId]: timestampMs }
//   isUsable(plan) — 排除已結束／鎖住的計畫
// 回傳 { plan, day, chapter, round } 或 null。
export function selectAutoRecordPlanTask({
  plans = [],
  bookName,
  chapterNum,
  activePlanId = "",
  lastOpened = {},
  isUsable = () => true
} = {}) {
  const candidates = [];
  (Array.isArray(plans) ? plans : []).forEach((plan, index) => {
    if (!plan || !isUsable(plan)) return;
    const found = findChapterInPlan(plan, bookName, chapterNum, { round: plan.currentRound });
    if (found) candidates.push({ plan, index, ...found });
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const { plan, day, chapter, round } = candidates[0];
    return { plan, day, chapter, round };
  }

  const opened = lastOpened && typeof lastOpened === "object" ? lastOpened : {};
  const stamp = candidate => Number(opened[planIdOf(candidate.plan)]) || 0;
  const wantedActive = String(activePlanId || "");
  const best = candidates.slice().sort((a, b) => {
    const byOpened = stamp(b) - stamp(a);
    if (byOpened !== 0) return byOpened;
    const aActive = wantedActive && planIdOf(a.plan) === wantedActive ? 1 : 0;
    const bActive = wantedActive && planIdOf(b.plan) === wantedActive ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return a.index - b.index;
  })[0];
  return { plan: best.plan, day: best.day, chapter: best.chapter, round: best.round };
}

// ── 「最近開啟」時間戳（localStorage，一個 key、JSON map）──
export const PLAN_LAST_OPENED_STORAGE_KEY = "plan_last_opened_at";

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readPlanLastOpened(storage) {
  try {
    const store = resolveStorage(storage);
    if (!store) return {};
    const parsed = JSON.parse(store.getItem(PLAN_LAST_OPENED_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function recordPlanOpened(plan, { storage, now = Date.now() } = {}) {
  const id = typeof plan === "string" ? plan : planIdOf(plan);
  if (!id) return false;
  try {
    const store = resolveStorage(storage);
    if (!store) return false;
    const map = readPlanLastOpened(store);
    map[id] = Number(now) || Date.now();
    store.setItem(PLAN_LAST_OPENED_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}
