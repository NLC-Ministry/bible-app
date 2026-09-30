// #358：未完成章節、截止倒數、App 內進度提醒橫幅的純邏輯（不碰 DOM／state／log 寫入）。
//
// 日期一律用 "YYYY-MM-DD" 字串（台灣本地日），日差用 UTC 換算避免 DST／時區位移。

export const DEFAULT_GRACE_DAYS = 3;
export const URGENT_DAYS_LEFT = 3; // 截止前 3 天起：強調樣式
export const FINAL_DAYS_LEFT = 1; // 截止前 1 天（含當天）：最強提示
export const DISMISS_STORAGE_KEY = "plan_reminder_dismissed";

const NON_SPEED_PLAN_KINDS = new Set(["devotional", "group_meeting"]);

export function toDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** to - from 的日曆天數（to 較晚為正）。任一無效回 NaN。 */
export function diffDays(fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (from === null || to === null) return NaN;
  return Math.round((to - from) / 86400000);
}

/** "2026-10-31" → "10/31" */
export function formatMonthDay(key) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(key || ""));
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

/** 寬限天數：plan.graceDays ?? plan.grace_days ?? 3（欄位還沒上線時安全退回預設）。 */
export function resolveGraceDays(plan) {
  const raw = plan ? (plan.graceDays ?? plan.grace_days ?? DEFAULT_GRACE_DAYS) : DEFAULT_GRACE_DAYS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_GRACE_DAYS;
}

/** 一般速讀計畫（排除靈修／小組聚會週）。 */
export function isSpeedReadingPlan(plan) {
  if (!plan) return false;
  const kind = plan.planKind || plan.plan_kind;
  return !NON_SPEED_PLAN_KINDS.has(kind);
}

function planRound(plan) {
  return Math.max(1, Number(plan && plan.currentRound) || 1);
}

function isChapterRead(chapter, round) {
  return Boolean(chapter && (chapter["isReadR" + round] || chapter.isRead));
}

export function getDayDateKey(day) {
  if (!day) return "";
  const dayOfMonth = day.date ? Number(String(day.date).split("/")[1]) : NaN;
  if (!day.year || !day.month || !Number.isFinite(dayOfMonth)) return "";
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

/**
 * 本遍尚未打卡的章節，依日程順序（同一章只算一次）。
 * @param {{ untilDateKey?: string }} [options] 只算「排定日 <= untilDateKey」的天（用於「還差」）。
 */
export function getUnfinishedChapters(plan, options = {}) {
  if (!plan || !Array.isArray(plan.days)) return [];
  const round = planRound(plan);
  const { untilDateKey } = options;
  const seen = new Set();
  const result = [];
  plan.days.forEach(day => {
    if (!day || !Array.isArray(day.chapters)) return;
    if (untilDateKey) {
      const key = getDayDateKey(day);
      if (!key || key > untilDateKey) return;
    }
    day.chapters.forEach(chapter => {
      if (!chapter || Number(chapter.round || round) !== round) return;
      if (isChapterRead(chapter, round)) return;
      const id = `${chapter.book}_${Number(chapter.chapter)}`;
      if (seen.has(id)) return;
      seen.add(id);
      result.push({ book: chapter.book, chapter: Number(chapter.chapter) });
    });
  });
  return result;
}

/**
 * 把連續章節合併成區間：[{出埃及記 3..7, 12}] → [{ book, text: "3–7、12" }]。
 * 只合併「日程順序相鄰、同書、章號 +1」的章節，不重排。
 */
export function mergeChapterRanges(chapters) {
  const groups = [];
  (Array.isArray(chapters) ? chapters : []).forEach(item => {
    if (!item || !Number.isFinite(Number(item.chapter))) return;
    const chapter = Number(item.chapter);
    const group = groups[groups.length - 1];
    if (group && group.book === item.book) {
      const last = group.ranges[group.ranges.length - 1];
      if (chapter === last[1] + 1) {
        last[1] = chapter;
      } else {
        group.ranges.push([chapter, chapter]);
      }
    } else {
      groups.push({ book: item.book, ranges: [[chapter, chapter]] });
    }
  });
  return groups.map(group => ({
    book: group.book,
    text: group.ranges.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join("、")
  }));
}

/** "出埃及記 3–7、12；利未記 1–2" */
export function formatUnfinishedRanges(chapters) {
  return mergeChapterRanges(chapters).map(group => `${group.book} ${group.text}`).join("；");
}

/**
 * 截止資訊。end < today 時看是否仍在寬限期內。
 * phase: "upcoming"(未開始) | "open" | "grace" | "closed" | "none"(沒有截止日／彈性計畫)
 */
export function getDeadlineInfo(plan, todayKey) {
  const none = { phase: "none", endKey: "", endLabel: "", daysLeft: NaN, graceDays: 0, graceLeft: 0, text: "", graceNote: "" };
  if (!plan || !plan.endDate) return none;
  if (plan.isFixed === false || plan.is_fixed === false) return none;
  const endKey = String(plan.endDate).slice(0, 10);
  const daysLeft = diffDays(todayKey, endKey);
  if (!Number.isFinite(daysLeft)) return none;

  const graceDays = resolveGraceDays(plan);
  const endLabel = formatMonthDay(endKey);
  const startKey = plan.startDate ? String(plan.startDate).slice(0, 10) : "";
  const notStarted = startKey && diffDays(startKey, todayKey) < 0;
  const graceNote = graceDays > 0 ? `截止後 ${graceDays} 天內仍可補打卡` : "";
  const graceLeft = graceDays + daysLeft; // daysLeft 為負時 = 寬限期剩餘天數

  let phase = "open";
  let text;
  if (notStarted) {
    phase = "upcoming";
    text = `截止 ${endLabel}`;
  } else if (daysLeft > 0) {
    text = `截止 ${endLabel}（還有 ${daysLeft} 天）`;
  } else if (daysLeft === 0) {
    text = `截止 ${endLabel}（今天截止）`;
  } else if (graceLeft >= 0 && graceDays > 0) {
    phase = "grace";
    text = `已截止 ${endLabel}（補打卡期剩 ${graceLeft} 天）`;
  } else {
    phase = "closed";
    text = `已截止 ${endLabel}`;
  }
  return { phase, endKey, endLabel, daysLeft, graceDays, graceLeft, text, graceNote };
}

/** 「還差 N 章」＝本遍排定日 <= 今天 且尚未打卡的章數。 */
export function getBehindChapterCount(plan, todayKey) {
  return getUnfinishedChapters(plan, { untilDateKey: todayKey }).length;
}

function bannerLevel(info) {
  if (info.phase === "grace") return "final";
  if (info.daysLeft <= FINAL_DAYS_LEFT) return "final";
  if (info.daysLeft <= URGENT_DAYS_LEFT) return "urgent";
  return "normal";
}

function bannerMessage(level, info, behind) {
  if (info.phase === "grace") return `已截止，補打卡期剩 ${info.graceLeft} 天，還差 ${behind} 章`;
  if (info.daysLeft === 0) return `今天截止！還差 ${behind} 章`;
  if (level === "final") return `明天截止！還差 ${behind} 章`;
  if (level === "urgent") return `還差 ${behind} 章，只剩 ${info.daysLeft} 天（截止 ${info.endLabel}）`;
  return `本週還差 ${behind} 章，截止 ${info.endLabel}`;
}

export function getPlanReminderKey(plan) {
  return String((plan && (plan.globalPlanId || plan.id || plan.presetKey)) || "");
}

/**
 * 決定要顯示哪些橫幅（每個落後的速讀計畫一則）。
 * @param {{ plans: object[], todayKey: string, dismissed?: {date?: string, keys?: string[]} }} input
 */
export function decideReminderBanners({ plans, todayKey, dismissed } = {}) {
  const dismissedKeys = dismissed && dismissed.date === todayKey && Array.isArray(dismissed.keys)
    ? new Set(dismissed.keys)
    : new Set();
  const banners = [];
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (!isSpeedReadingPlan(plan)) return;
    const info = getDeadlineInfo(plan, todayKey);
    if (info.phase !== "open" && info.phase !== "grace") return;
    const key = getPlanReminderKey(plan);
    if (!key || dismissedKeys.has(key)) return;
    const behind = getBehindChapterCount(plan, todayKey);
    if (behind <= 0) return;
    const level = bannerLevel(info);
    banners.push({
      planKey: key,
      planName: plan.name || "",
      behind,
      level,
      endLabel: info.endLabel,
      daysLeft: info.daysLeft,
      message: bannerMessage(level, info, behind)
    });
  });
  return banners;
}

// ---- 當天不再出現（localStorage；所有存取 try/catch，失敗時當作沒關過）----

export function readDismissed(storage) {
  try {
    const raw = storage && storage.getItem(DISMISS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.date === "string" && Array.isArray(parsed.keys)) return parsed;
  } catch (_) { /* ignore */ }
  return { date: "", keys: [] };
}

export function withDismissal(dismissed, planKey, todayKey) {
  const base = dismissed && dismissed.date === todayKey && Array.isArray(dismissed.keys) ? dismissed.keys : [];
  return { date: todayKey, keys: base.includes(planKey) ? base.slice() : [...base, planKey] };
}

export function saveDismissal(storage, planKey, todayKey) {
  const next = withDismissal(readDismissed(storage), planKey, todayKey);
  try {
    if (storage) storage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(next));
  } catch (_) { /* ignore */ }
  return next;
}
