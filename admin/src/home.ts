// 後台首頁（#569）：home_summary 的型別與顯示規則（純函式，測試直接測）。
// 數字都由伺服器算（admin-api home.ts）；這裡只決定怎麼寫、哪一格要提醒。
import type { PlanSummary } from "./plans.ts";

export type HomePlan = Pick<PlanSummary, "plan" | "today" | "schedule" | "funnel" | "care" | "teams" | "meta">;

export type QuizDayStatus = "open" | "ended" | "outside_plan" | "skipped" | "not_published" | "scheduled" | "generating" | "failed" | "waiting";

export type HomeSummary = {
  /** 預設計畫（和計畫區同一個預設）；沒有任何計畫是 null */
  plan: HomePlan | null;
  reports: { open: number; unread: number; oldest_open_at: string | null } | null;
  commentary: { pending: number; approved: number } | null;
  /** 預設計畫明天的小測驗；沒有計畫是 null */
  quiz: { enabled: boolean; configured: boolean; date: string; status: QuizDayStatus | null; needs_attention: boolean } | null;
  /** 最近 30 天的設定變更：只有動作與時間，沒有操作者 */
  changes: { action: string; label: string; occurredAt: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 最舊的未結案回報等了幾天（未滿一天是 0）；沒有就 null */
export function waitingDays(oldest: string | null | undefined, now: Date): number | null {
  if (!oldest) return null;
  const at = Date.parse(oldest);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

export function waitingText(days: number | null): string {
  if (days === null) return "";
  return days === 0 ? "最舊的今天送出" : `最舊的已等 ${days} 天`;
}

// 和「內容 → 小測驗」日曆同一套狀態（get_daily_quiz_calendar）
export const QUIZ_STATUS_LABEL: Readonly<Record<QuizDayStatus, string>> = {
  scheduled: "已準備好",
  skipped: "這天不發",
  waiting: "還沒出題",
  generating: "出題中",
  failed: "出題失敗",
  open: "作答中",
  ended: "已結束",
  not_published: "沒有發佈",
  outside_plan: "不在計畫期間"
};

/** 首頁要不要顯示小測驗那一格：功能開著、這個計畫有設定小測驗、明天在計畫期間 */
export function showQuiz(quiz: HomeSummary["quiz"]): quiz is NonNullable<HomeSummary["quiz"]> {
  return !!quiz && quiz.enabled && quiz.configured && !!quiz.status && quiz.status !== "outside_plan";
}

/** 明天還沒準備好（日曆上會標紅的那幾種，或還沒到標紅時間但仍沒題目） */
export function quizNotReady(status: QuizDayStatus | null): boolean {
  return status === "waiting" || status === "generating" || status === "failed";
}
