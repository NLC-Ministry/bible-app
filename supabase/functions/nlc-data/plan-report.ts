// 組長版的計畫總覽與名單（#564）：和後台的 plan_summary／plan_roster 同一份規則與組裝
// （supabase/functions/_shared/progress/plan-report.mjs），差別只在範圍——這裡用 getVisibleProfileIds 的結果
// （index.ts 算好傳進來），經 get_pastoral_overview 取資料；前端傳來的範圍一律不看。
// 獨立成檔讓 vitest 直接測（index.ts 本身是 Deno.serve 進入點）；權限（canManagePlans）與稽核在 index.ts。
import {
  buildPlanRoster,
  buildPlanSummary,
  parseScopeFilter,
  preparePlanReport,
  resolvePlanForReport
} from "../_shared/progress/plan-report.mjs";
import { PASTORAL_OVERVIEW_RPC, buildPastoralOverviewArgs } from "./plan-stats-scope.ts";

export const PLAN_REPORT_ACTIONS = new Set(["plan_summary", "plan_roster"]);
// 排「教會原始日程」要的欄位（同 admin_api_plan_info）
export const PLAN_REPORT_PLAN_COLUMNS = "id, name, plan_kind, start_date, end_date, target_books, rules, is_hidden";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryResult = { data: any; error: { message?: string; code?: string } | null };
export type PlanReportDeps = {
  fetchPlanRow: (planId: string) => Promise<QueryResult>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<QueryResult>;
};
export type PlanReportResult = { status: number; body: Record<string, unknown>; planId?: string; people?: number };

export async function runPlanReport(
  action: string,
  rawArgs: any,
  visibleIds: string[] | null,
  actorId: string,
  deps: PlanReportDeps
): Promise<PlanReportResult> {
  const planId = rawArgs?.p_global_plan_id;
  if (typeof planId !== "string" || !UUID_PATTERN.test(planId)) return { status: 400, body: { error: "invalid_plan_id" } };
  let scope = {};
  if (action === "plan_summary") {
    const parsed = parseScopeFilter(rawArgs?.scope);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    scope = parsed.scope;
  }

  const plan = await deps.fetchPlanRow(planId);
  if (plan.error) return { status: 400, body: { error: plan.error.message || "plan_lookup_failed", code: plan.error.code } };
  if (!plan.data) return { status: 404, body: { error: "plan_not_found" } };
  const resolved = resolvePlanForReport(plan.data);

  const args = buildPastoralOverviewArgs({ p_global_plan_id: planId, p_preset_key: resolved.plan.presetKey }, visibleIds, actorId);
  const overview = await deps.rpc(PASTORAL_OVERVIEW_RPC, args);
  if (overview.error) return { status: 400, body: { error: overview.error.message || "rpc_failed", code: overview.error.code } };

  const report = preparePlanReport({ resolved, overview: overview.data });
  if (action === "plan_summary") return { status: 200, body: { data: buildPlanSummary(report, scope) }, planId };
  return { status: 200, body: { data: buildPlanRoster(report) }, planId, people: report.people.length };
}
