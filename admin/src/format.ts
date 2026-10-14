// 顯示用的格式與中文標籤（#555）。時間一律用台北時區，和會友 App 一致。

const DATE_TIME = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const DATE_ONLY = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: unknown): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

/** 只有日期的欄位（YYYY-MM-DD）原樣顯示，避免時區把日期往前推一天。 */
export function formatDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replace(/-/g, "/");
  const date = toDate(value);
  return date ? DATE_ONLY.format(date) : "—";
}

export function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str ? str : fallback;
}

export function label(map: Record<string, string>, value: unknown): string {
  const key = typeof value === "string" ? value : "";
  return map[key] || text(value);
}

// 個人頁各區（#567）
export const SECTION_LABEL: Record<string, string> = {
  plans: "計畫報名",
  reading_logs: "打卡紀錄",
  teams: "團隊",
  team_events: "團隊異動",
  tests: "測驗",
  vouchers: "兌換券",
  reports: "回報",
  notifications: "通知"
};

export const TEAM_EVENT_LABEL: Record<string, string> = {
  insert: "加入團隊",
  update: "團隊資料變更",
  delete: "離開團隊"
};

export const TEST_KIND_LABEL: Record<string, string> = {
  exam: "速讀大測驗",
  daily_quiz: "每日小測驗",
  lightning_quiz: "雲柱測驗"
};

export const REPORT_CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug 錯誤",
  ui: "UI 建議",
  data: "資料問題",
  other: "其他"
};

// 和會友在 App 回報抽屜看到的字一樣（ignored＝已存檔）
export const REPORT_STATUS_LABEL: Record<string, string> = {
  pending: "待處理",
  processing: "處理中",
  resolved: "已解決",
  ignored: "已存檔"
};

export const PROVIDER_LABEL: Record<string, string> = {
  logto: "NLC 登入",
  google: "Google",
  email: "Email"
};
