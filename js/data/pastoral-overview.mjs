// App 管理分頁（#551、#570）的資料：nlc-data 的組長版 plan_summary／plan_roster（#564），
// 和後台同一份規則（supabase/functions/_shared/progress/plan-report.mjs），範圍由伺服器依登入者決定。
//   · 總覽：plan_summary，只有數字；換範圍（大區／牧區／小組）就再問一次。
//   · 名單：plan_roster，切到名單（或團隊、測驗）才調閱，範圍內一人一列、展開要的欄位都在裡面；伺服器記稽核。
// 回傳 { data, inconsistent } 或 { error }；畫面自己決定怎麼顯示錯誤。
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

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validShape(action, data) {
  if (!isObject(data) || !isObject(data.plan)) return false;
  if (action === "plan_summary") return isObject(data.funnel) && isObject(data.care) && isObject(data.units);
  return Array.isArray(data.people);
}

function errorText(error) {
  if (!error) return "rpc_failed";
  if (typeof error === "string") return error;
  return error.error || error.message || error.code || "rpc_failed";
}

async function fetchPlanReport(client, action, plan, extra = {}) {
  if (!client || typeof client.planReport !== "function") return { error: "unavailable" };
  const { p_global_plan_id: globalPlanId } = pastoralPlanArgs(plan);
  if (!globalPlanId) return { error: "plan_required" };
  try {
    const { data, error } = await client.planReport(action, { p_global_plan_id: globalPlanId, ...extra });
    if (error) return { error: errorText(error) };
    if (!validShape(action, data)) return { error: "unexpected_shape" };
    // 伺服器另外數的人數和算出來的對不上：照樣顯示，但要提醒、不快取（同後台）
    return { data, inconsistent: !(data.meta && data.meta.consistent === true) };
  } catch (err) {
    return { error: (err && err.message) || "rpc_failed" };
  }
}

/** 總覽：只有數字。scope 是授權範圍內再縮小（{ greatRegion, pastoralZone, smallGroup }，空字串＝全部） */
export function fetchPlanSummary(client, plan, scope = {}) {
  const filter = {};
  for (const [level, value] of Object.entries(scope || {})) {
    if (typeof value === "string" && value) filter[level] = value;
  }
  return fetchPlanReport(client, "plan_summary", plan, { scope: filter });
}

/** 名單：範圍內每人一列（不帶 email）；打開一次伺服器記一筆稽核 */
export function fetchPlanRoster(client, plan) {
  return fetchPlanReport(client, "plan_roster", plan);
}
