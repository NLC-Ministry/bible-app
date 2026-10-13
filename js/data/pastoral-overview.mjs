// App 管理分頁（#551）的資料：一支 RPC get_pastoral_overview（經 nlc-data，範圍由伺服器依登入者決定）。
// 回傳 { today, people } 或 { error }；畫面自己決定怎麼顯示錯誤。
export const PASTORAL_OVERVIEW_RPC = "get_pastoral_overview";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pastoralPlanArgs(plan) {
  const candidates = [plan && plan.globalPlanId, plan && plan.global_plan_id, plan && plan.id];
  const globalPlanId = candidates.find((value) => typeof value === "string" && UUID_RE.test(value)) || null;
  const presetKey = plan && (plan.presetKey || plan.preset_key);
  return {
    p_global_plan_id: globalPlanId,
    p_preset_key: typeof presetKey === "string" && presetKey ? presetKey : null
  };
}

export function normalizePastoralOverview(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.people)) return null;
  return {
    today: typeof data.today === "string" ? data.today.slice(0, 10) : "",
    people: data.people.filter((row) => row && typeof row === "object" && typeof row.id === "string")
  };
}

export async function fetchPastoralOverview(client, plan) {
  if (!client || typeof client.rpc !== "function") return { error: "unavailable" };
  const args = pastoralPlanArgs(plan);
  if (!args.p_global_plan_id) return { error: "plan_required" };
  try {
    const { data, error } = await client.rpc(PASTORAL_OVERVIEW_RPC, args);
    if (error) return { error: error.message || error.code || "rpc_failed" };
    const overview = normalizePastoralOverview(data);
    return overview || { error: "unexpected_shape" };
  } catch (err) {
    return { error: (err && err.message) || "rpc_failed" };
  }
}
