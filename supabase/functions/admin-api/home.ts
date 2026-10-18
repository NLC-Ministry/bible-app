// 後台首頁（#569）：今天要處理的事，只有數字、不含任何人的名字、不記稽核。開後台＝bootstrap＋這 1 個請求。
//
// 三步：admin_api_plan_options（預設計畫，和計畫區同一個預設）→ 預設計畫用 plans.ts 的 loadReport 跑和計畫總覽
// 同一份規則（需要關心、還沒滿的隊、本期進度；首頁點進去的人數一定和計畫區一樣）→ admin_api_home_counts
// （回報、注釋、明天的小測驗、最近的設定變更，數法見 migration 說明）。設定變更只回動作與時間，中文名稱由 audit.ts 補上。
// 範圍一律全教會，SQL 依操作者重查是不是系統管理員（不是就 42501 → 403）。
import { buildPlanSummary } from "../_shared/progress/plan-report.mjs";
import { auditActionLabel } from "./audit.ts";
import { loadReport } from "./plans.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner, RpcResult, RunOutcome } from "./types.ts";

function homeFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "42501") return { ok: false, status: 403, error: "forbidden" };
  return sqlFailure(stage, error);
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {});

export const runHomeSummary: ActionRunner = async ({ args, rpc }) => {
  const options = await rpc("admin_api_plan_options", { p_actor_id: args.p_actor_id });
  if (options.error) return homeFailure("admin_api_plan_options", options.error);
  const planId = typeof obj(options.data).default_plan_id === "string" ? obj(options.data).default_plan_id as string : null;

  let plan: Obj | null = null;
  if (planId) {
    const loaded = await loadReport({ ...args, p_global_plan_id: planId, p_audit: false }, rpc);
    if (!loaded.report) return loaded.outcome as RunOutcome;
    const summary = buildPlanSummary(loaded.report);
    plan = {
      plan: summary.plan,
      today: summary.today,
      schedule: summary.schedule,
      funnel: summary.funnel,
      care: summary.care,
      teams: summary.teams,
      meta: summary.meta
    };
  }

  const counts = await rpc("admin_api_home_counts", { p_actor_id: args.p_actor_id, p_global_plan_id: planId });
  if (counts.error) return homeFailure("admin_api_home_counts", counts.error);
  const data = obj(counts.data);
  const changes = (Array.isArray(data.changes) ? data.changes : []).map((change) => {
    const row = obj(change);
    return { action: row.action, label: auditActionLabel(row.action), occurredAt: row.occurred_at };
  });

  return {
    ok: true,
    data: {
      plan,
      reports: data.reports ?? null,
      commentary: data.commentary ?? null,
      quiz: data.quiz ?? null,
      changes
    }
  };
};
