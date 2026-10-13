// 後台「計畫」的總覽與名單（#564）：plan_summary 只有數字、不記稽核；plan_roster 打開名單、SQL 記一筆
// view_plan_roster。範圍一律全教會，由 SQL 依操作者重查是不是系統管理員（不是就 42501 → 403）。
//
// 兩步：admin_api_plan_info（計畫本身）→ 用 _shared 的規則推出比對尺與 preset key → admin_api_plan_people
// （每人事實）→ 執行和會友 App 同一份 plan-progress.mjs 算出每個人的狀態。
import {
  buildPlanRoster,
  buildPlanSummary,
  parseScopeFilter,
  preparePlanReport,
  resolvePlanForReport
} from "../_shared/progress/plan-report.mjs";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner, RpcResult, RunOutcome } from "./types.ts";

function planFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "42501") return { ok: false, status: 403, error: "forbidden" };
  return sqlFailure(stage, error);
}

async function loadReport(args: Record<string, unknown>, rpc: Parameters<ActionRunner>[0]["rpc"]) {
  const info = await rpc("admin_api_plan_info", { p_actor_id: args.p_actor_id, p_global_plan_id: args.p_global_plan_id });
  if (info.error) return { outcome: planFailure("admin_api_plan_info", info.error) };
  if (!info.data || typeof info.data !== "object") return { outcome: { ok: false, status: 404, error: "plan_not_found" } as RunOutcome };
  const resolved = resolvePlanForReport(info.data);
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
