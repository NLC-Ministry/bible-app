// 後台「計畫」的總覽與名單（#564）：plan_summary 只有數字、不記稽核；plan_roster 打開名單、SQL 記一筆
// view_plan_roster。範圍一律全教會，由 SQL 依操作者重查是不是系統管理員（不是就 42501 → 403）。
//
// 兩步：admin_api_plan_info（計畫本身）→ 用 _shared 的規則推出比對尺與 preset key → admin_api_plan_people
// （每人事實）→ 執行和會友 App 同一份 plan-progress.mjs 算出每個人的狀態。
//
// #565：測驗作答（plan_quiz）、名單匯出（plan_roster_export，伺服器用和畫面同一份篩選規則產生 CSV、記稽核）、
// 關心提醒（care_remind）。三個都要先從計畫推出 preset key——和 App 的 plan.presetKey 相同，
// 小測驗作答、會友 App 送出的關心提醒都用這個 key。
import { careReasonText } from "../_shared/progress/plan-progress.mjs";
import {
  ROSTER_SORTS,
  buildPlanRoster,
  buildPlanSummary,
  filterPlanRoster,
  parseRosterFilters,
  parseScopeFilter,
  preparePlanReport,
  resolvePlanForReport,
  sortPlanRoster
} from "../_shared/progress/plan-report.mjs";
import { taipeiDate, taipeiDateTime, toCsv, withExportTime } from "./exports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner, RpcResult, RunOutcome } from "./types.ts";

function planFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "42501") return { ok: false, status: 403, error: "forbidden" };
  return sqlFailure(stage, error);
}

type Rpc = Parameters<ActionRunner>[0]["rpc"];

// 計畫本身 → 比對尺；preset key 沒有時（一般計畫）就是計畫 id，同 App 的 presetKey || globalPlanId
async function loadPlan(args: Record<string, unknown>, rpc: Rpc) {
  const info = await rpc("admin_api_plan_info", { p_actor_id: args.p_actor_id, p_global_plan_id: args.p_global_plan_id });
  if (info.error) return { outcome: planFailure("admin_api_plan_info", info.error) };
  if (!info.data || typeof info.data !== "object") return { outcome: { ok: false, status: 404, error: "plan_not_found" } as RunOutcome };
  const resolved = resolvePlanForReport(info.data);
  return { resolved, planKey: String(resolved.plan.presetKey || args.p_global_plan_id || "") };
}

// 首頁（#569）也用這一支：需要關心、還沒滿的隊、本期進度和計畫總覽同一份規則
export async function loadReport(args: Record<string, unknown>, rpc: Rpc) {
  const loaded = await loadPlan(args, rpc);
  if (!loaded.resolved) return { outcome: loaded.outcome };
  const { resolved } = loaded;
  const people = await rpc("admin_api_plan_people", { ...args, p_preset_key: resolved.plan.presetKey || null });
  if (people.error) return { outcome: planFailure("admin_api_plan_people", people.error) };
  return { report: preparePlanReport({ resolved, overview: people.data }) };
}

export const runPlanSummary: ActionRunner = async ({ args, params, rpc }) => {
  const scope = parseScopeFilter(params.scope);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };
  const loaded = await loadReport(args, rpc);
  if (!loaded.report) return loaded.outcome as RunOutcome;
  return { ok: true, data: buildPlanSummary(loaded.report, scope.scope) };
};

export const runPlanRoster: ActionRunner = async ({ args, rpc }) => {
  const loaded = await loadReport(args, rpc);
  if (!loaded.report) return loaded.outcome as RunOutcome;
  return { ok: true, data: buildPlanRoster(loaded.report) };
};

export const runPlanQuiz: ActionRunner = async ({ args, rpc }) => {
  const loaded = await loadPlan(args, rpc);
  if (!loaded.resolved) return loaded.outcome as RunOutcome;
  const result = await rpc("admin_api_plan_quiz", { ...args, p_preset_key: loaded.planKey });
  if (result.error) return planFailure("admin_api_plan_quiz", result.error);
  return { ok: true, data: result.data };
};

export const runCareRemind: ActionRunner = async ({ args, rpc }) => {
  const loaded = await loadPlan(args, rpc);
  if (!loaded.resolved) return loaded.outcome as RunOutcome;
  const result = await rpc("admin_api_care_remind", { ...args, p_plan_key: loaded.planKey });
  if (result.error) return planFailure("admin_api_care_remind", result.error);
  return { ok: true, data: result.data };
};

// ── 名單匯出：欄位和畫面展開的一列相同；不含 email ─────────────────────────────
export const PLAN_ROSTER_EXPORT_HEADERS = [
  "大區", "牧區", "小組", "姓名", "報名", "進度", "目前第幾遍", "本遍進度（%）", "累計章數", "落後天數",
  "最後打卡（台灣時間）", "幾天沒打卡", "近 7 天有讀的天數", "需要關心", "團隊", "小測驗（交卷／已發布）"
] as const;

type ExportRow = ReturnType<typeof buildPlanRoster>["people"][number];

export function planRosterCsv(rows: readonly ExportRow[]): string {
  return toCsv(PLAN_ROSTER_EXPORT_HEADERS, rows.map((row) => [
    row.greatRegion || "未設定",
    row.pastoralZone || "未設定",
    row.smallGroup || "未設定",
    row.name || "未設定",
    row.enrolled ? "是" : "否",
    row.statusLabel,
    row.enrolled ? row.round : "",
    row.enrolled ? row.progress : "",
    row.chapters,
    row.enrolled ? row.behindDays : "",
    taipeiDateTime(row.lastReadAt),
    row.daysSinceRead ?? "",
    row.enrolled ? row.readDays7 : "",
    (row.careReasons || []).map(careReasonText).filter(Boolean).join("、"),
    (row.teams || []).map((team) => `${team.captain ? "[隊長] " : ""}${team.name || "未命名隊伍"}`).join("、"),
    row.enrolled ? `${row.quiz.submitted}／${row.quiz.published}` : ""
  ]));
}

function safeFilenamePart(value: unknown): string {
  return String(value || "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || "計畫";
}

// 名單匯出：條件與排序用和畫面同一份規則（plan-report.mjs），伺服器重算；SQL 那步不記 view_plan_roster，
// 改記一筆 export（條件、筆數）。記稽核失敗就不回檔案。
export const runPlanRosterExport: ActionRunner = async ({ args, params, rpc }) => {
  const filters = parseRosterFilters(params.filters);
  if (!filters.ok) return { ok: false, status: 400, error: filters.error };
  const sort = params.sort === undefined || params.sort === null ? "behind" : params.sort;
  if (!(ROSTER_SORTS as readonly unknown[]).includes(sort)) return { ok: false, status: 400, error: "invalid_roster_sort" };
  const loaded = await loadReport(args, rpc);
  if (!loaded.report) return loaded.outcome as RunOutcome;
  const roster = buildPlanRoster(loaded.report);
  const rows = sortPlanRoster(filterPlanRoster(roster.people, filters.filters), sort as string);
  const recorded = await rpc("admin_api_record_event", {
    p_action: "export",
    p_result: "ok",
    p_actor_id: args.p_actor_id,
    p_actor_role: args.p_actor_role,
    p_resource: "global_plans",
    p_target_user_id: null,
    p_reason: null,
    p_request_id: args.p_request_id,
    p_detail: { kind: "plan_roster", global_plan_id: args.p_global_plan_id, plan_name: roster.plan.name, filters: filters.filters, sort, rows: rows.length }
  });
  if (recorded.error) return sqlFailure("admin_api_record_event", recorded.error);
  const now = new Date();
  return {
    ok: true,
    data: {
      filename: `計畫名單_${safeFilenamePart(roster.plan.name)}_${taipeiDate(now)}.csv`,
      csv: withExportTime(planRosterCsv(rows), now),
      rows: rows.length,
      total: roster.people.length,
      truncated: false
    }
  };
};
