// 「報表」區（#568）的資料型別與顯示用小工具。數字都由伺服器整理好（admin-api 的 stats.ts），這裡只有日期區間、
// 百分比、圖表設定這些畫面的事，不再算任何統計。

export const MAX_RANGE_DAYS = 180;
export const DEFAULT_RANGE_DAYS = 30;

export type UsageDay = { date: string; dau: number; wau: number; mau: number; stickiness: number | null; chapters: number };
export type L7Week = {
  weekStart: string;
  weekEnd: string;
  coveredEnd: string;
  dayCount: number;
  total: number;
  rows: { days: number; users: number; pct: number | null }[];
};
export type HourProfile = { dayCount: number; users: number[]; chapters: number[] };
export type HourDays = "all" | "weekday" | "weekend";
export type HourMetric = "users" | "chapters";

export type Usage = {
  from: string;
  to: string;
  today: string;
  summary: {
    avgDau: number | null;
    avgChapters: number | null;
    latestDate: string | null;
    wau: number | null;
    mau: number | null;
    avgStickiness: number | null;
    totalChapters: number;
  };
  days: UsageDay[];
  l7: { current: L7Week; previous: L7Week };
  hours: Record<HourDays, HourProfile>;
};

export type RegistrationRow = { label: string; signupCount: number; registeredCount: number; team3Count: number; team6Count: number; leaderName?: string };
export type RegistrationStats = {
  planId: string;
  planName: string;
  summary: Record<string, number>;
  greatRegions: RegistrationRow[];
  pastoralZones: RegistrationRow[];
};
export type RegistrationPlan = { id: string; name: string | null; plan_kind?: string | null; start_date: string | null; end_date: string | null };
export type RegistrationData = { plans: RegistrationPlan[]; planId: string | null; stats: RegistrationStats | null };

// 和 admin-api stats.ts 的 REGISTRATION_SUMMARY_ITEMS 同順序（scripts/admin-api-stats.test.mjs 比對）
export const REGISTRATION_SUMMARY_ITEMS = [
  ["withoutPastoralZoneNotJoined", "無牧區資料未加入計畫"],
  ["withoutPastoralZoneJoined", "無牧區資料已加入計畫"],
  ["withPastoralZoneNotJoined", "有牧區資料未加入計畫"],
  ["withPastoralZoneJoined", "有牧區資料已加入計畫"],
  ["totalJoined", "總參加人數"],
  ["totalRegistered", "總註冊人數"]
] as const;

const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });

export function taipeiToday(now: Date = new Date()): string {
  return TAIPEI_DATE.format(now);
}

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

export function defaultUsageRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), to: today };
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 區間有問題回中文說明，沒問題回 null（伺服器也會再檢查）。 */
export function rangeError(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "請選擇起訖日期。";
  if (from > to) return "起日不能晚於迄日。";
  if (Math.round((utc(to) - utc(from)) / 86_400_000) + 1 > MAX_RANGE_DAYS) return `日期區間最長 ${MAX_RANGE_DAYS} 天，請縮短後再試。`;
  return null;
}

export function shortDate(iso: string): string {
  if (!isIsoDate(iso)) return iso || "—";
  const date = new Date(utc(iso));
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function formatPct(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? "—" : `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("zh-TW");
}

/** 值最大的幾個小時（同值取早的）；全是 0 回空陣列。 */
export function topHours(values: readonly number[], count = 3): { hour: number; value: number }[] {
  return values.map((value, hour) => ({ hour, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.hour - b.hour)
    .slice(0, count);
}

export function weekLabel(week: L7Week): string {
  return week.weekStart ? `${shortDate(week.weekStart)}～${shortDate(week.weekEnd)}` : "";
}
