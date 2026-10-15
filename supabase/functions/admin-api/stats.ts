// 後台「報表」區（#568）：讀經使用率（含每日趨勢）與報名註冊統計。
//
// · reading_usage：SQL（admin_api_reading_usage）回舊頁三支函式的原始數字＋每天章數，這裡整理成畫面直接用的形狀
//   （黏著度、L7 佔比、各時段平均），前端不再算。整理規則照舊頁 js/modules/admin-reading-activity.mjs
//   （部署只打包函式自己的資料夾，所以搬過來；scripts/admin-api-stats.test.mjs 比對兩邊結果一致）。只有數字，不記稽核。
// · registration_stats：數字與排序都在 SQL；只有數字與牧區長姓名，不記稽核（同舊頁）。順便帶計畫選單
//   （admin_api_plan_options，同計畫區：不含隱藏的與總表），沒指定計畫就用預設計畫——打開分頁只要 1 個請求。
// · registration_export：CSV 由這裡產生（欄位同舊頁），先記一筆 export，記不成就不回檔案。
// · registration_sheet_sync：把同一份數字送到 Google Apps Script（網址與密鑰是伺服器的環境變數，同 nlc-data 的
//   sync_registration_stats_sheet），成功或失敗都記一筆 sync_registration_stats_sheet；前端不送任何數字。
import { taipeiDate, toCsv, withExportTime } from "./exports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner, RpcResult, RunOutcome } from "./types.ts";

export const MAX_USAGE_RANGE_DAYS = 180;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const time = parseIsoDate(value);
  return new Date(time).toISOString().slice(0, 10) === value;
}

/** 起訖日期：都要是真的日期、起日不晚於迄日、最長 180 天（SQL 再檢查一次）。 */
export function usageRange(params: Record<string, unknown>): { ok: true; from: string; to: string } | { ok: false; error: string } {
  if (!isIsoDate(params.from) || !isIsoDate(params.to) || params.from > params.to) return { ok: false, error: "invalid_range" };
  const days = Math.round((parseIsoDate(params.to) - parseIsoDate(params.from)) / 86_400_000) + 1;
  if (days > MAX_USAGE_RANGE_DAYS) return { ok: false, error: "range_too_long" };
  return { ok: true, from: params.from, to: params.to };
}

const num = (value: unknown) => Number(value) || 0;
const round1 = (value: number) => Math.round(value * 10) / 10;

// ── 每天的數字（#452 DAU／WAU／MAU＋每日趨勢的章數）────────────────────────────
export type UsageDay = { date: string; dau: number; wau: number; mau: number; stickiness: number | null; chapters: number };

export function buildUsageDays(days: unknown): UsageDay[] {
  return (Array.isArray(days) ? days : []).map((day: Record<string, unknown>) => {
    const dau = num(day?.dau);
    const mau = num(day?.mau);
    return { date: String(day?.date || ""), dau, wau: num(day?.wau), mau, stickiness: mau > 0 ? dau / mau : null, chapters: num(day?.chapters) };
  });
}

export function summarizeUsage(days: readonly UsageDay[]) {
  if (!days.length) return { avgDau: null, avgChapters: null, latestDate: null, wau: null, mau: null, avgStickiness: null, totalChapters: 0 };
  const latest = days[days.length - 1];
  const ratios = days.map((day) => day.stickiness).filter((value): value is number => value !== null);
  const totalChapters = days.reduce((sum, day) => sum + day.chapters, 0);
  return {
    avgDau: round1(days.reduce((sum, day) => sum + day.dau, 0) / days.length),
    avgChapters: round1(totalChapters / days.length),
    latestDate: latest.date,
    wau: latest.wau,
    mau: latest.mau,
    avgStickiness: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null,
    totalChapters
  };
}

// ── #453 一週讀幾天（本週 vs 上週）──────────────────────────────────────────────
function buildL7Week(week: Record<string, unknown> | null | undefined) {
  const total = num(week?.total);
  const buckets = Array.isArray(week?.buckets) ? week?.buckets as Record<string, unknown>[] : [];
  const byDays = new Map(buckets.map((bucket) => [num(bucket.days), num(bucket.users)]));
  return {
    weekStart: String(week?.weekStart || ""),
    weekEnd: String(week?.weekEnd || ""),
    coveredEnd: String(week?.coveredEnd || ""),
    dayCount: num(week?.dayCount),
    total,
    rows: [1, 2, 3, 4, 5, 6, 7].map((days) => {
      const users = byDays.get(days) || 0;
      return { days, users, pct: total > 0 ? users / total : null };
    })
  };
}

export function buildL7(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, Record<string, unknown>> : {};
  return { current: buildL7Week(record.current), previous: buildL7Week(record.previous) };
}

// ── #454 讀經時段（星期 × 小時 → 全部／平日／週末各 24 小時的平均）──────────────────
export const HOUR_DAY_FILTERS = { all: [1, 2, 3, 4, 5, 6, 7], weekday: [1, 2, 3, 4, 5], weekend: [6, 7] } as const;
export type HourDays = keyof typeof HOUR_DAY_FILTERS;

/** 值＝該小時的加總 ÷ 選到的天數＝平均每天的人數（或章數），四捨五入到小數一位。 */
export function buildHourProfile(data: unknown, days: HourDays) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const dows: readonly number[] = HOUR_DAY_FILTERS[days];
  const dayCounts = record.dayCounts && typeof record.dayCounts === "object" ? record.dayCounts as Record<string, unknown> : {};
  const dayCount = dows.reduce((sum, dow) => sum + num(dayCounts[String(dow)]), 0);
  const users = new Array(24).fill(0);
  const chapters = new Array(24).fill(0);
  for (const cell of Array.isArray(record.cells) ? record.cells as Record<string, unknown>[] : []) {
    const hour = num(cell.hour);
    if (!dows.includes(num(cell.dow)) || hour < 0 || hour > 23) continue;
    users[hour] += num(cell.sumUsers);
    chapters[hour] += num(cell.sumChapters);
  }
  const average = (sum: number) => (dayCount > 0 ? round1(sum / dayCount) : 0);
  return { dayCount, users: users.map(average), chapters: chapters.map(average) };
}

export function buildUsage(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const days = buildUsageDays(record.days);
  return {
    from: String(record.from || ""),
    to: String(record.to || ""),
    today: String(record.today || ""),
    summary: summarizeUsage(days),
    days,
    l7: buildL7(record.l7),
    hours: {
      all: buildHourProfile(record.hours, "all"),
      weekday: buildHourProfile(record.hours, "weekday"),
      weekend: buildHourProfile(record.hours, "weekend")
    }
  };
}

export const runReadingUsage: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_reading_usage", args);
  if (result.error) return statsFailure("admin_api_reading_usage", result.error);
  return { ok: true, data: buildUsage(result.data) };
};

// ── 報名註冊統計 ─────────────────────────────────────────────────────────────
export const REGISTRATION_SUMMARY_ITEMS = [
  ["withoutPastoralZoneNotJoined", "無牧區資料未加入計畫"],
  ["withoutPastoralZoneJoined", "無牧區資料已加入計畫"],
  ["withPastoralZoneNotJoined", "有牧區資料未加入計畫"],
  ["withPastoralZoneJoined", "有牧區資料已加入計畫"],
  ["totalJoined", "總參加人數"],
  ["totalRegistered", "總註冊人數"]
] as const;

type RegistrationRow = { label: string; signupCount: number; registeredCount: number; team3Count: number; team6Count: number; leaderName?: string };
export type RegistrationStats = {
  planId: string;
  planName: string;
  summary: Record<string, number>;
  greatRegions: RegistrationRow[];
  pastoralZones: RegistrationRow[];
};

// 名稱裡的「/」換成全形、換行換成空白（同舊頁 sanitizeRegistrationStatisticsText：試算表那邊用它當分頁的鍵）
export function registrationLabel(value: unknown): string {
  return String(value || "未設定").replaceAll("/", "／").replace(/[\r\n]+/g, " ").trim() || "未設定";
}

function normalizeRow(row: Record<string, unknown>, withLeader: boolean): RegistrationRow {
  const base = {
    label: registrationLabel(row?.label),
    signupCount: num(row?.signupCount),
    registeredCount: num(row?.registeredCount),
    team3Count: num(row?.team3Count),
    team6Count: num(row?.team6Count)
  };
  return withLeader ? { ...base, leaderName: String(row?.leaderName || "") } : base;
}

export function normalizeRegistrationStats(data: unknown): RegistrationStats {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const summary = record.summary && typeof record.summary === "object" ? record.summary as Record<string, unknown> : {};
  const rows = (value: unknown, withLeader: boolean) => (Array.isArray(value) ? value : []).map((row) => normalizeRow(row, withLeader));
  return {
    planId: String(record.planId || ""),
    planName: String(record.planName || ""),
    summary: Object.fromEntries(REGISTRATION_SUMMARY_ITEMS.map(([key]) => [key, Math.max(0, num(summary[key]))])),
    greatRegions: rows(record.greatRegions, false),
    pastoralZones: rows(record.pastoralZones, true)
  };
}

async function loadRegistration(args: Record<string, unknown>, rpc: Parameters<ActionRunner>[0]["rpc"]) {
  const result = await rpc("admin_api_registration_stats", { p_actor_id: args.p_actor_id, p_global_plan_id: args.p_global_plan_id });
  if (result.error) return { outcome: statsFailure("admin_api_registration_stats", result.error) };
  if (!result.data || typeof result.data !== "object") return { outcome: { ok: false, status: 404, error: "plan_not_found" } as RunOutcome };
  return { stats: normalizeRegistrationStats(result.data) };
}

export const runRegistrationStats: ActionRunner = async ({ args, rpc }) => {
  const options = await rpc("admin_api_plan_options", { p_actor_id: args.p_actor_id });
  if (options.error) return statsFailure("admin_api_plan_options", options.error);
  const record = options.data && typeof options.data === "object" ? options.data as Record<string, unknown> : {};
  const plans = Array.isArray(record.plans) ? record.plans : [];
  const planId = args.p_global_plan_id || record.default_plan_id || null;
  if (!planId) return { ok: true, data: { plans, planId: null, stats: null } };
  const loaded = await loadRegistration({ ...args, p_global_plan_id: planId }, rpc);
  return loaded.stats ? { ok: true, data: { plans, planId, stats: loaded.stats } } : loaded.outcome as RunOutcome;
};

const REGISTRATION_TABLE_HEADERS = ["報名人數", "註冊人數", "3 人團隊人數", "6 人團隊人數"] as const;

/** 欄位、順序同舊頁的「匯出 CSV」（convertAdminRegistrationStatisticsToCSV）。 */
export function registrationCsv(stats: RegistrationStats): string {
  const counts = (row: RegistrationRow) => [row.label, row.signupCount, row.registeredCount, row.team3Count, row.team6Count];
  return [
    toCsv(["統計項目", "人數"], REGISTRATION_SUMMARY_ITEMS.map(([key, label]) => [label, stats.summary[key] || 0])),
    toCsv(["大區", ...REGISTRATION_TABLE_HEADERS], stats.greatRegions.map(counts)),
    toCsv(["牧區", ...REGISTRATION_TABLE_HEADERS], stats.pastoralZones.map(counts))
  ].join("\r\n\r\n");
}

function safeFilenamePart(value: unknown): string {
  return String(value || "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-").trim().slice(0, 60) || "讀經計畫";
}

export const runRegistrationExport: ActionRunner = async ({ args, rpc }) => {
  const loaded = await loadRegistration(args, rpc);
  if (!loaded.stats) return loaded.outcome as RunOutcome;
  const { stats } = loaded;
  const rows = stats.greatRegions.length + stats.pastoralZones.length;
  const recorded = await rpc("admin_api_record_event", {
    p_action: "export",
    p_result: "ok",
    p_actor_id: args.p_actor_id,
    p_actor_role: args.p_actor_role,
    p_resource: "global_plans",
    p_target_user_id: null,
    p_reason: null,
    p_request_id: args.p_request_id,
    p_detail: { kind: "registration_stats", global_plan_id: args.p_global_plan_id, plan_name: stats.planName, rows }
  });
  if (recorded.error) return sqlFailure("admin_api_record_event", recorded.error);
  const now = new Date();
  return {
    ok: true,
    data: {
      filename: `報名與註冊統計-${safeFilenamePart(stats.planName)}-${taipeiDate(now)}.csv`,
      csv: withExportTime(registrationCsv(stats), now),
      rows,
      total: rows,
      truncated: false
    }
  };
};

/** 送給 Apps Script 的內容：格式同 nlc-data 的 sync_registration_stats_sheet（試算表那邊不用改）。 */
export function sheetPayload(stats: RegistrationStats) {
  const counts = ({ label, signupCount, registeredCount, team3Count, team6Count }: RegistrationRow) => ({
    label: label.slice(0, 40), signupCount, registeredCount, team3Count, team6Count
  });
  return {
    planName: stats.planName.slice(0, 60),
    greatRegions: stats.greatRegions.map(counts),
    pastoralZones: stats.pastoralZones.map((row) => ({ ...counts(row), leaderName: String(row.leaderName || "").slice(0, 60) })),
    summary: Object.fromEntries(REGISTRATION_SUMMARY_ITEMS.map(([key]) => [key, stats.summary[key] || 0]))
  };
}

export const runRegistrationSheetSync: ActionRunner = async ({ args, rpc, sheetSync }) => {
  if (!sheetSync) return { ok: false, status: 500, error: "admin_api_failed", stage: "sheet_sync", detail: { message: "server_not_configured" } };
  const loaded = await loadRegistration(args, rpc);
  if (!loaded.stats) return loaded.outcome as RunOutcome;
  const sent = await sheetSync(sheetPayload(loaded.stats));
  const recorded = await rpc("admin_api_record_event", {
    p_action: "sync_registration_stats_sheet",
    p_result: sent.ok ? "ok" : "error",
    p_actor_id: args.p_actor_id,
    p_actor_role: args.p_actor_role,
    p_resource: "export",
    p_target_user_id: null,
    p_reason: null,
    p_request_id: args.p_request_id,
    p_detail: { global_plan_id: args.p_global_plan_id, plan_name: loaded.stats.planName, ...(sent.ok ? {} : { error: sent.error }) }
  });
  if (!sent.ok) {
    return sent.error === "server_not_configured"
      ? { ok: false, status: 500, error: "admin_api_failed", stage: "sheet_sync", detail: { message: sent.error } }
      : { ok: false, status: 502, error: "sheet_sync_failed" };
  }
  if (recorded.error) return sqlFailure("admin_api_record_event", recorded.error);
  return { ok: true, data: { synced: true, planName: loaded.stats.planName } };
};

function statsFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "42501") return { ok: false, status: 403, error: "forbidden" };
  return sqlFailure(stage, error);
}
