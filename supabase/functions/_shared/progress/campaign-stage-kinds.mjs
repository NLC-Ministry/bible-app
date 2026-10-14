// 教會階段計畫的 plan_kind 判斷 —— JS 唯一定義（會友 App 與 Edge Function 共用；#566 從 js/data 搬來）。
//
// 對應 DB migration 0137 的 public.is_campaign_stage_kind /
// public.is_canonical_campaign_stage_kind。三個 runtime（Postgres、前端 ESM）
// 各一份定義，各自在自己的 runtime 內被所有呼叫點共用；改行為時三處一起改。
//
// 兩個概念：
//   isCampaignStageKind          —— 「行為上是一個階段計畫」：正式階段 or 大區延後梯次。
//     階段開放閘門、輪次進度凍結、階段獎、3/6 人團隊報名 / 團隊榜 / carry-over。
//   isCanonicalCampaignStageKind —— 「在全教會正式時間軸上」：只有正式階段。
//     preset 同步、preset override 重套規則；cohort 由後台自行維護，永不匹配。

export const CAMPAIGN_STAGE_KINDS = Object.freeze([
  "church_campaign_stage",
  "church_campaign_stage_cohort"
]);

export const CANONICAL_CAMPAIGN_STAGE_KIND = "church_campaign_stage";

function planKindOf(planOrKind) {
  if (planOrKind && typeof planOrKind === "object") {
    return String(planOrKind.planKind || planOrKind.plan_kind || "");
  }
  return String(planOrKind || "");
}

// 接受 plan 物件或 plan_kind 字串。
export function isCampaignStageKind(planOrKind) {
  return CAMPAIGN_STAGE_KINDS.includes(planKindOf(planOrKind));
}

export function isCanonicalCampaignStageKind(planOrKind) {
  return planKindOf(planOrKind) === CANONICAL_CAMPAIGN_STAGE_KIND;
}

function taipeiTodayKey() {
  let today = "";
  try { today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); } catch (_) { today = ""; }
  return /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
}

// 這個階段計畫的結束日已過（Asia/Taipei）→ 團隊名單不能再動（migration 0163 的觸發器才是真正的護欄）。
// 會友 App 拿它把會失敗的按鈕先藏起來；後台隊伍頁拿它標「不能修改」、判斷帶隊按鈕會不會出現（#566）。
export function isCampaignStageEnded(plan, todayKey = taipeiTodayKey()) {
  if (!plan || !isCampaignStageKind(plan)) return false;
  const end = String(plan.endDate || plan.end_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return end < todayKey;
}
