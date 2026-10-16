// 後台「計畫」區（#565）的型別與顯示規則。純函式，測試直接測。
//
// 名單的篩選、排序、從總覽點進名單的條件都用伺服器同一份規則（supabase/functions/_shared/progress/plan-report.mjs）：
// 畫面篩出幾個人，匯出（伺服器重算）就是幾個人；從漏斗、需要關心點進來的人數和總覽一模一樣。
// 這裡只放畫面要的文字：條件的白話句子、今天應讀到哪、狀態的顏色。
import {
  CHECKIN_BUCKETS,
  PROGRESS_BUCKETS,
  activeRosterPreset,
  countRosterConditions,
  defaultRosterFilters,
  drillRosterFilters,
  filterPlanRoster,
  presetRosterFilters,
  sortPlanRoster
} from "../../supabase/functions/_shared/progress/plan-report.mjs";
import { careReasonText } from "../../supabase/functions/_shared/progress/plan-progress.mjs";
import type { PlanOption } from "./types.ts";

export { careReasonText };

export type Bucket = { id: string; label: string };
export type RosterShortcut = "" | "care" | "care_behind" | "care_checkin" | "active7";
export type RosterTeamFilter = "any" | "yes" | "no";
export type RosterSort = "behind" | "chapters_desc" | "chapters_asc";
export type RosterPreset = "enrolled" | "care" | "all";
export type DrillKey = "inScope" | "enrolled" | "active7" | "onTrack" | "completedOnce" | "care" | "careBehind" | "careCheckin";
export type RosterFilters = { shortcut: RosterShortcut; progress: string[]; checkin: string[]; team: RosterTeamFilter; q: string };

// ── admin-api 回應（plan_options／plan_summary／plan_roster／plan_quiz）────────────
export type PlanOptions = { plans: PlanOption[]; default_plan_id: string | null };

export type PlanInfo = { id: string; name: string; planKind: string; startDate: string; endDate: string; books: string[]; presetKey: string };
export type Funnel = { inScope: number; enrolled: number; active7: number; onTrack: number; completedOnce: number; care: number };
export type UnitRow = Funnel & { name: string; withTeam: number };
export type ChapterRange = { book: string; from: number; to: number };
export type PlanMeta = { inScope: number | null; enrolled: number | null; rows: number; rowsEnrolled: number; consistent: boolean };

export type PlanSummary = {
  plan: PlanInfo;
  today: string;
  schedule: {
    totalDays: number; totalChapters: number; dayNumber: number | null; started: boolean; ended: boolean;
    expectedDays: number; today: ChapterRange[];
  };
  funnel: Funnel;
  buckets: { progress: Record<string, number>; checkin: Record<string, number> };
  care: { behind: number; noCheckin: number; neverRead: number; total: number };
  teams: { enrolled: number; withTeam: number; withoutTeam: number; teams: number; unfilled: number };
  units: { level: string | null; rows: UnitRow[]; children: { level: string | null; rows: Record<string, UnitRow[]> } };
  meta: PlanMeta;
};

export type RosterTeam = { id: string; name: string; division: number; status: string; size: number; captain: boolean };
export type CareReason = { type: string; days: number };
export type RosterRow = {
  id: string; name: string; greatRegion: string; pastoralZone: string; smallGroup: string;
  enrolled: boolean; status: string; statusLabel: string; progressBucket: string; checkinBucket: string;
  round: number; progress: number; chapters: number; byRound: Record<string, number>; behindDays: number;
  lastReadAt: string | null; daysSinceRead: number | null; readDays7: number;
  care: boolean; careReasons: CareReason[]; teams: RosterTeam[]; quiz: { published: number; submitted: number };
};
export type PlanRoster = { plan: PlanInfo; today: string; progressBuckets: Bucket[]; checkinBuckets: Bucket[]; people: RosterRow[]; meta: PlanMeta };

export type QuizDay = { date: string; eligible: number; submitted: number };
export type ExamPaper = {
  id: string; title: string | null; status: string | null; open_at: string | null; close_at: string | null;
  started: number; submitted: number; graded: number; pending: number; enrolled_takers: number; average: number | null;
};
export type PlanQuiz = {
  today: string;
  enrolled: number;
  daily: { enabled: boolean; configured: boolean; days: QuizDay[]; participants: number };
  exam: { enabled: boolean; papers: ExamPaper[] };
  lightning: null | { from: string; to: string; questions: number; participants: number; weeks: { week_start: string; questions: number; participants: number }[] };
};

export const ROSTER_PAGE_SIZE = 100;
export const PROGRESS_OPTIONS = PROGRESS_BUCKETS as readonly Bucket[];
export const CHECKIN_OPTIONS = CHECKIN_BUCKETS as readonly Bucket[];
export const SORT_OPTIONS: readonly { value: RosterSort; label: string }[] = [
  { value: "behind", label: "落後天數 多→少" },
  { value: "chapters_desc", label: "累計章數 多→少" },
  { value: "chapters_asc", label: "累計章數 少→多" }
];
export const TEAM_OPTIONS: readonly { value: RosterTeamFilter; label: string }[] = [
  { value: "any", label: "不限" },
  { value: "yes", label: "有隊" },
  { value: "no", label: "沒有隊" }
];
export const PRESET_OPTIONS: readonly { value: RosterPreset; label: string }[] = [
  { value: "enrolled", label: "報名者" },
  { value: "care", label: "需要關心" },
  { value: "all", label: "全部" }
];
export const UNIT_LEVEL_LABEL: Readonly<Record<string, string>> = { greatRegion: "大區", pastoralZone: "牧區", smallGroup: "小組" };

// 關心提醒：原因與預設內容同會友 App 的關心對話框（js/modules/plan.js openCareReminderDialog）
export type CareReminderReason = "behind" | "inactive" | "care" | "encouragement";
export const CARE_REMINDER_REASONS: readonly { value: CareReminderReason; label: string }[] = [
  { value: "behind", label: "進度落後" },
  { value: "inactive", label: "很久沒打卡" },
  { value: "care", label: "一般關心" },
  { value: "encouragement", label: "特別鼓勵" }
];
export const MAX_CARE_MESSAGE_CHARS = 300;

export function defaultCareReason(row: RosterRow): CareReminderReason {
  if (row.behindDays >= 2) return "behind";
  if (row.chapters === 0 || (row.daysSinceRead ?? 0) >= 3) return "inactive";
  return "care";
}

export function defaultCareMessage(reason: CareReminderReason, name: string): string {
  switch (reason) {
    case "behind": return `Hi ${name}！這週的讀經進度稍微落後囉，有任何困難都可以跟我說喔，加油！`;
    case "inactive": return `${name} 你好，最近都沒看到你打卡讀經，希望一切都好，我們在等你哦！`;
    case "encouragement": return `${name}！你最近讀經很穩定，真的很棒！繼續加油哦，感謝主！`;
    default: return `${name} 你好，只是想關心一下你最近的讀經狀況，如果有任何需要都可以找我！`;
  }
}

// ── 名單條件 ─────────────────────────────────────────────────────────────
export const defaultFilters = (): RosterFilters => defaultRosterFilters() as RosterFilters;
export const presetFilters = (preset: RosterPreset): RosterFilters => presetRosterFilters(preset) as RosterFilters;
export const drillFilters = (key: DrillKey): RosterFilters => drillRosterFilters(key) as RosterFilters;
export const applyRosterFilters = (rows: readonly RosterRow[], filters: RosterFilters): RosterRow[] => filterPlanRoster(rows, filters) as RosterRow[];
export const sortRoster = (rows: readonly RosterRow[], sort: RosterSort): RosterRow[] => sortPlanRoster(rows, sort) as RosterRow[];

/** 目前條件是不是三個快速按鈕之一（不看搜尋字）；規則和 App 管理分頁共用（plan-report.mjs） */
export const activePreset = (filters: RosterFilters): RosterPreset | null => activeRosterPreset(filters) as RosterPreset | null;

/** 篩選區收起來時，標題上寫「幾個條件」（快速鍵算一個；預設的報名者不算） */
export const filterCount = (filters: RosterFilters): number => countRosterConditions(filters);

const SHORTCUT_TEXT: Readonly<Record<Exclude<RosterShortcut, "">, string>> = {
  care: "需要關心（落後 7 天以上，或最後打卡 3 天以上；兩個都符合的只算一次）",
  care_behind: "需要關心：落後 7 天以上",
  care_checkin: "需要關心：最後打卡 3 天以上（含報名後還沒開始讀）",
  active7: "報名、近 7 天有讀"
};

function quoted(options: readonly Bucket[], ids: readonly string[], joiner: string): string {
  return `「${options.filter((option) => ids.includes(option.id)).map((option) => option.label).join(`」${joiner}「`)}」`;
}

// 勾的比沒勾的多時改寫沒勾的那幾格（「不是…也不是…」），句子比較短
function bucketWords(options: readonly Bucket[], ids: readonly string[], what: string): string {
  if (ids.length === options.length) return "";
  if (ids.length === 0) return `沒有勾任何${what}`;
  const missing = options.filter((option) => !ids.includes(option.id)).map((option) => option.id);
  return missing.length < ids.length ? `${what}不是${quoted(options, missing, "也不是")}` : `${what}是${quoted(options, ids, "或")}`;
}

// 沒勾「未報名」＝只看報名者：先說「報名者」，再說報名者裡少了哪幾格
function progressWords(ids: readonly string[]): string {
  if (ids.length === 0 || ids.includes("not_enrolled")) return bucketWords(PROGRESS_OPTIONS, ids, "進度");
  const missing = PROGRESS_OPTIONS.filter((option) => option.id !== "not_enrolled" && !ids.includes(option.id)).map((option) => option.id);
  if (missing.length === 0) return "報名者";
  return missing.length < ids.length ? `報名者，且進度不是${quoted(PROGRESS_OPTIONS, missing, "也不是")}` : `進度是${quoted(PROGRESS_OPTIONS, ids, "或")}`;
}

/** 一句白話寫出目前條件，例如「進度是「落後 2–6 天」或「落後 7 天以上」，且沒有隊」 */
export function describeFilters(filters: RosterFilters): string {
  const parts = filters.shortcut
    ? [SHORTCUT_TEXT[filters.shortcut]]
    : [progressWords(filters.progress), bucketWords(CHECKIN_OPTIONS, filters.checkin, "最後打卡")];
  if (filters.team === "yes") parts.push("有隊");
  if (filters.team === "no") parts.push("沒有隊");
  if (filters.q) parts.push(`姓名或單位含「${filters.q}」`);
  return parts.filter(Boolean).join("，且") || "全部的人";
}

/** 名字旁的紅字：最後打卡 3 天以上；報名後還沒開始讀（已過 3 天）也標 */
export function lateText(row: RosterRow): string {
  if (!row.enrolled) return "";
  if (row.daysSinceRead !== null && row.daysSinceRead >= 3) return `${row.daysSinceRead} 天沒打卡`;
  if (row.careReasons.some((reason) => reason.type === "never_read")) return "還沒開始讀";
  return "";
}

export type StatusTone = "neutral" | "brand" | "warning" | "danger";
export function statusTone(row: RosterRow): StatusTone {
  switch (row.progressBucket) {
    case "behind_long": return "danger";
    case "behind": return "warning";
    case "on_track":
    case "completed": return "brand";
    default: return "neutral";
  }
}

// ── 總覽 ─────────────────────────────────────────────────────────────────
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function rangesText(ranges: readonly ChapterRange[]): string {
  return ranges.map((range) => `${range.book} ${range.from === range.to ? range.from : `${range.from}–${range.to}`} 章`).join("、");
}

/** 狀態列的「第幾天」與「今天應讀到哪」 */
export function scheduleLine(summary: Pick<PlanSummary, "schedule" | "plan">): { day: string; reading: string } {
  const { schedule, plan } = summary;
  if (!schedule.started) return { day: `還沒開始（共 ${schedule.totalDays} 天）`, reading: plan.startDate ? `${plan.startDate.replace(/-/g, "/")} 開始` : "" };
  if (schedule.ended) return { day: `已結束（共 ${schedule.totalDays} 天）`, reading: "" };
  return {
    day: schedule.dayNumber ? `第 ${schedule.dayNumber} 天／共 ${schedule.totalDays} 天` : `共 ${schedule.totalDays} 天`,
    reading: schedule.today.length > 0 ? `今天應讀到 ${rangesText(schedule.today)}` : "今天是補讀／休息日"
  };
}

export type FunnelLayer = { key: DrillKey; label: string; value: number; note: string };
/** 漏斗五層：每層標母體（第一層是範圍內的帳號，其他層的百分比都對「報名的」算，最後兩層除外見 note） */
export function funnelLayers(funnel: Funnel): FunnelLayer[] {
  const ofEnrolled = (value: number) => `報名的 ${pct(value, funnel.enrolled)}%`;
  return [
    { key: "inScope", label: "註冊", value: funnel.inScope, note: "啟用中的帳號" },
    { key: "enrolled", label: "報名", value: funnel.enrolled, note: `註冊的 ${pct(funnel.enrolled, funnel.inScope)}%` },
    { key: "active7", label: "近 7 天有讀", value: funnel.active7, note: ofEnrolled(funnel.active7) },
    { key: "onTrack", label: "跟上進度", value: funnel.onTrack, note: ofEnrolled(funnel.onTrack) },
    { key: "completedOnce", label: "讀完一遍", value: funnel.completedOnce, note: ofEnrolled(funnel.completedOnce) }
  ];
}

/** 選計畫：網址指定的 → 上次選的 → 伺服器挑的預設；都不在清單裡就用第一個 */
export function pickPlanId(options: PlanOptions | null, wanted: readonly (string | null | undefined)[]): string | null {
  const plans = options?.plans || [];
  for (const id of [...wanted, options?.default_plan_id]) {
    if (id && plans.some((plan) => plan.id === id)) return id;
  }
  return plans[0]?.id || null;
}

export function chaptersByRoundText(row: RosterRow): string {
  const rounds = Object.entries(row.byRound).filter(([, count]) => count > 0).sort(([a], [b]) => Number(a) - Number(b));
  if (rounds.length === 0) return `${row.chapters} 章`;
  return rounds.map(([round, count]) => `第 ${round} 遍 ${count} 章`).join("＋");
}

export function teamText(team: RosterTeam): string {
  const missing = team.division > 0 && team.size < team.division ? `（${team.size}／${team.division} 人，還缺 ${team.division - team.size} 人）` : `（${team.size} 人）`;
  return `${team.captain ? "隊長・" : ""}${team.name || "未命名隊伍"}${missing}`;
}
