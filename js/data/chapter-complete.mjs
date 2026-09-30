// 「完成本章」按鈕（#357）的共用判斷。讀經頁與計畫內嵌閱讀器共用。
//
// 原則（#360 打卡模型）：「讀完」只由會友按「完成本章」決定。
//   - 讀到底、換章、朗讀唸完都不會寫入，只讓按鈕閃一下提醒。
//   - 不猜要記到哪個計畫：從計畫進來 → 記到那個計畫；自由閱讀 → 列出「目前這一遍」含這章的
//     計畫，只有一個就直接標在按鈕上，有好幾個就由會友選，沒選之前按鈕不會寫入。
//   - 不限順序（#331 的照順序規則已拿掉），「進入下一遍」仍要整遍都完成。

export const CHAPTER_COMPLETE_REASONS = Object.freeze({
  NO_PLAN: "no_plan",
  CHOOSE_PLAN: "choose_plan",
  OFFLINE: "offline",
  EXPIRED: "expired",
  LOCKED: "locked",
  OLD_ROUND: "old_round"
});

// 這次按下可不可以寫入。回傳 reason 或 null。
// 鎖住的階段只擋「完成」，不擋「取消」（允許收回先前誤記的已讀，跟計畫頁勾選一致）。
export function getChapterCheckInBlock({
  hasTask = false,
  willCheck = true,
  offline = false,
  expired = false,
  locked = false,
  isOldRound = false
} = {}) {
  if (!hasTask) return CHAPTER_COMPLETE_REASONS.NO_PLAN;
  if (isOldRound) return CHAPTER_COMPLETE_REASONS.OLD_ROUND;
  if (expired) return CHAPTER_COMPLETE_REASONS.EXPIRED;
  if (willCheck && locked) return CHAPTER_COMPLETE_REASONS.LOCKED;
  if (offline) return CHAPTER_COMPLETE_REASONS.OFFLINE;
  return null;
}

// 讀經頁與內嵌閱讀器共用：這個 task 按下去會不會被擋。
//   isExpired / isLocked 由呼叫端注入（isPlanExpired 是 app 全域、isPlanProgressLocked 要 hidden 旗標）。
export function getChapterTaskBlock(task, willCheck, {
  offlineMode = false,
  isExpired = () => false,
  isLocked = () => false,
  db = globalThis.db
} = {}) {
  if (!task || !task.plan) return getChapterCheckInBlock({ hasTask: false });
  const plan = task.plan;
  return getChapterCheckInBlock({
    hasTask: true,
    willCheck,
    offline: isCheckInBlockedOffline({ offlineMode, plan, db }),
    expired: Boolean(isExpired(plan)),
    locked: Boolean(isLocked(plan)),
    isOldRound: normalizeRound(task.round) < normalizeRound(plan.currentRound)
  });
}

// 寫入失敗時給會友看的一句話：規則／離線／鎖住這類有中文訊息的照用，其他（網路、401）用通用文案。
const USER_FACING_ERROR_CODES = new Set(["CHECK_IN_REJECTED", "OFFLINE_READ_ONLY", "PLAN_PROGRESS_LOCKED"]);
export function describeCheckInError(error, copy = {}) {
  const fallback = copy.syncFail || "進度沒同步成功，等一下再試試";
  if (error && USER_FACING_ERROR_CODES.has(error.code) && error.message) return error.message;
  return fallback;
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

export function planNameOf(plan) {
  return String((plan && (plan.name || plan.title)) || "");
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

// 自由閱讀：所有「目前這一遍」含這章、還能打卡的計畫（isUsable 排除已結束／鎖住的）。
// 回傳 [{ plan, day, chapter, round }]，照 plans 原本的順序；不排序、不挑。
export function findFreeReadingPlanChoices({
  plans = [],
  bookName,
  chapterNum,
  isUsable = () => true
} = {}) {
  const choices = [];
  const seen = new Set();
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (!plan || !isUsable(plan)) return;
    const id = planIdOf(plan);
    if (id && seen.has(id)) return;
    const found = findChapterInPlan(plan, bookName, chapterNum, { round: plan.currentRound });
    if (!found) return;
    if (id) seen.add(id);
    choices.push({ plan, ...found, bookName: String(bookName), chapterNum: Number(chapterNum) });
  });
  return choices;
}

// 這一章的按鈕要記到哪裡：
//   context — 從計畫進來，記到那個計畫
//   single  — 自由閱讀、只有一個計畫含這章，按鈕標出計畫名
//   choose  — 自由閱讀、好幾個計畫含這章；selectedPlanId 對得上才有 task，否則等會友選
//   none    — 自由閱讀、沒有計畫含這章：不顯示按鈕
export function resolveChapterCompleteTarget({ contextTask = null, choices = [], selectedPlanId = "" } = {}) {
  if (contextTask) return { mode: "context", task: contextTask, choices: [] };
  const list = Array.isArray(choices) ? choices : [];
  if (list.length === 0) return { mode: "none", task: null, choices: [] };
  if (list.length === 1) return { mode: "single", task: list[0], choices: list };
  const wanted = String(selectedPlanId || "");
  const task = wanted ? list.find(choice => planIdOf(choice.plan) === wanted) || null : null;
  return { mode: "choose", task, choices: list };
}

export function isChapterTaskRead(task) {
  if (!task || !task.chapter) return false;
  const round = normalizeRound(task.round);
  return Boolean(task.chapter[`isReadR${round}`] || (round === 1 && task.chapter.isRead));
}

// outbox 裡這一章最後的意圖：true＝等著送「完成」、false＝等著送「取消」、null＝沒有待送。
export function getPendingCheckIn(task, outbox, bookName) {
  if (!task || !task.plan || !outbox || typeof outbox.pendingItems !== "function") return null;
  const planId = task.plan.id;
  if (!planId) return null;
  const book = String(bookName ?? task.chapter?.book ?? "");
  const chapterNum = Number(task.chapterNum ?? task.chapter?.chapter);
  const round = normalizeRound(task.round);
  let items = [];
  try {
    items = outbox.pendingItems({ planId }) || [];
  } catch {
    return null;
  }
  const item = items.filter(entry =>
    String(entry.book) === book && Number(entry.chapter) === chapterNum && Number(entry.round || 1) === round
  ).pop();
  return item ? Boolean(item.checked) : null;
}

function fill(template, values) {
  return Object.keys(values).reduce((text, key) => text.split(`{${key}}`).join(values[key]), String(template));
}

// 按鈕與狀態列要顯示什麼（純資料，方便測）。
//   target        — resolveChapterCompleteTarget 的結果
//   read          — 這章在目標計畫是否已完成（本機狀態，含待送的）
//   pending       — getPendingCheckIn 的結果
//   notice        — 上一次按下的結果訊息（被擋／被伺服器拒絕），{ text } 或 null
export function getChapterCompleteView({ target, read = false, pending = null, notice = null, copy = {} } = {}) {
  if (!target || target.mode === "none") return { visible: false };
  const task = target.task;
  const planName = task ? planNameOf(task.plan) : "";
  const choose = target.mode === "choose";
  const view = {
    visible: true,
    mode: target.mode,
    pressed: Boolean(task && read),
    needsChoice: choose && !task,
    choices: choose
      ? target.choices.map(choice => ({
        id: planIdOf(choice.plan),
        name: planNameOf(choice.plan),
        read: isChapterTaskRead(choice),
        selected: Boolean(task && planIdOf(task.plan) === planIdOf(choice.plan))
      }))
      : [],
    label: "",
    status: "",
    statusKind: ""
  };
  if (view.pressed) {
    view.label = fill(copy.chapterCompleteDone || "已記錄到〈{plan}〉", { plan: planName });
  } else if (target.mode === "single") {
    view.label = fill(copy.chapterCompleteButtonTo || "完成本章 · 記到〈{plan}〉", { plan: planName });
  } else {
    view.label = copy.chapterCompleteButton || "完成本章";
  }

  if (notice && notice.text) {
    view.status = notice.text;
    view.statusKind = "blocked";
  } else if (view.pressed && pending === true) {
    view.status = copy.chapterCompletePending || "已完成（等待同步）";
    view.statusKind = "pending";
  } else if (view.needsChoice) {
    view.status = copy.chapterCompleteChooseFirst || "請先選要記到哪個計畫";
    view.statusKind = "hint";
  }
  return view;
}

// 被擋下時的中文原因（CHAPTER_COMPLETE_REASONS → 文案）。
export function formatChapterCompleteBlock(reason, copy = {}) {
  const reasonText = {
    [CHAPTER_COMPLETE_REASONS.OFFLINE]: copy.chapterCompleteReasonOffline || "離線中",
    [CHAPTER_COMPLETE_REASONS.EXPIRED]: copy.chapterCompleteReasonExpired || "計畫已結束",
    [CHAPTER_COMPLETE_REASONS.LOCKED]: copy.chapterCompleteReasonLocked || "這個階段尚未開放",
    [CHAPTER_COMPLETE_REASONS.OLD_ROUND]: copy.chapterCompleteReasonOldRound || "這是已完成的舊一遍，不能再修改",
    [CHAPTER_COMPLETE_REASONS.CHOOSE_PLAN]: copy.chapterCompleteChooseFirst || "請先選要記到哪個計畫",
    [CHAPTER_COMPLETE_REASONS.NO_PLAN]: copy.chapterCompleteReasonNoPlan || "這章不在進行中的計畫裡"
  }[reason];
  if (!reasonText) return "";
  if (reason === CHAPTER_COMPLETE_REASONS.CHOOSE_PLAN) return reasonText;
  return fill(copy.chapterCompleteNotRecorded || "未記錄：{reason}", { reason: reasonText });
}

// 按下「完成本章」／「取消」的共用寫入。不看順序、不猜計畫；寫入一律走 db.logChapterRead
// （#356：計畫內打卡進 outbox，立即回傳 { queued: true }，離線也收）。
//   task    — { plan, chapter(計畫裡那一章的物件), round, bookName, chapterNum }
//   deps    — { db, state, recalc }：recalc 重算進度與重畫（calculatePlanProgress 等）
// 回傳 { ok: true, queued } 或 { ok: false, reason?, error?, message }。
export async function submitChapterCheckIn(task, willCheck, {
  db = globalThis.db,
  state = globalThis.state,
  recalc = () => {},
  block = null
} = {}) {
  if (block) return { ok: false, reason: block, message: "" };
  if (!task || !task.plan || !task.chapter) return { ok: false, reason: CHAPTER_COMPLETE_REASONS.NO_PLAN, message: "" };
  const round = normalizeRound(task.round);
  const readKey = `isReadR${round}`;
  const previousRoundRead = Boolean(task.chapter[readKey]);
  const previousRead = Boolean(task.chapter.isRead);
  const logsBefore = state && Array.isArray(state.readingLogs) ? state.readingLogs.slice() : null;

  task.chapter[readKey] = Boolean(willCheck);
  if (round === 1) task.chapter.isRead = Boolean(willCheck);
  try { recalc(); } catch (error) { console.warn("[ChapterComplete] Progress recalculation failed", error); }

  try {
    const result = await db.logChapterRead(task.bookName, task.chapterNum, Boolean(willCheck), round, task.plan);
    try { recalc(); } catch (error) { console.warn("[ChapterComplete] Progress recalculation failed", error); }
    return { ok: true, queued: Boolean(result && result.queued) };
  } catch (error) {
    task.chapter[readKey] = previousRoundRead;
    task.chapter.isRead = previousRead;
    if (logsBefore && state) state.readingLogs = logsBefore;
    try { recalc(); } catch (recalcError) { console.warn("[ChapterComplete] Progress recalculation failed", recalcError); }
    return { ok: false, error, message: (error && error.message) || "" };
  }
}
