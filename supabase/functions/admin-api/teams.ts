// 後台隊伍除錯（#566）：隊伍清單（附每隊的除錯檢查）、隊伍頁、異動歷程、跨階段對應、找隊伍。
// 範圍一律全教會，由 SQL 依操作者重查是不是系統管理員（不是就 42501 → 403）。
//
// SQL 只回事實；檢查、「會友 App 應該顯示」、加入方式與異動的白話說明都在
// _shared/progress/team-report.mjs（和會友 App 同一份規則）。
// 清單、隊伍頁要成員的報名進度，所以和 plan_summary 一樣先拿計畫推出 preset key 再查。
import { resolvePlanForReport } from "../_shared/progress/plan-report.mjs";
import { buildTeamDetail, buildTeamHistory, buildTeamLineage, buildTeamList } from "../_shared/progress/team-report.mjs";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner, RpcResult, RunOutcome } from "./types.ts";

function teamFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "42501") return { ok: false, status: 403, error: "forbidden" };
  return sqlFailure(stage, error);
}

const TEAM_NOT_FOUND: RunOutcome = { ok: false, status: 404, error: "team_not_found" };

export const runTeamList: ActionRunner = async ({ args, rpc }) => {
  const info = await rpc("admin_api_plan_info", { p_actor_id: args.p_actor_id, p_global_plan_id: args.p_global_plan_id });
  if (info.error) return teamFailure("admin_api_plan_info", info.error);
  if (!info.data || typeof info.data !== "object") return { ok: false, status: 404, error: "plan_not_found" };
  const resolved = resolvePlanForReport(info.data);
  const result = await rpc("admin_api_team_list", { ...args, p_preset_key: resolved.plan.presetKey || null });
  if (result.error) return teamFailure("admin_api_team_list", result.error);
  return { ok: true, data: buildTeamList({ resolved, data: result.data }) };
};

export const runTeamDetail: ActionRunner = async ({ args, rpc }) => {
  const info = await rpc("admin_api_team_info", { p_actor_id: args.p_actor_id, p_team_id: args.p_team_id });
  if (info.error) return teamFailure("admin_api_team_info", info.error);
  const plan = info.data && typeof info.data === "object" ? (info.data as Record<string, unknown>).plan : null;
  if (!plan || typeof plan !== "object") return TEAM_NOT_FOUND;
  const resolved = resolvePlanForReport(plan);
  const result = await rpc("admin_api_team_detail", { ...args, p_preset_key: resolved.plan.presetKey || null });
  if (result.error) return teamFailure("admin_api_team_detail", result.error);
  if (!result.data) return TEAM_NOT_FOUND;
  return { ok: true, data: buildTeamDetail({ resolved, data: result.data }) };
};

export const runTeamHistory: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_team_history", args);
  if (result.error) return teamFailure("admin_api_team_history", result.error);
  return { ok: true, data: buildTeamHistory(result.data) };
};

export const runTeamLineage: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_team_lineage", args);
  if (result.error) return teamFailure("admin_api_team_lineage", result.error);
  if (!result.data) return TEAM_NOT_FOUND;
  return { ok: true, data: buildTeamLineage(result.data) };
};

export const runTeamSearch: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_team_search", args);
  if (result.error) return teamFailure("admin_api_team_search", result.error);
  return { ok: true, data: Array.isArray(result.data) ? result.data : [] };
};
