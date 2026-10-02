// 計畫統計的純規則（#370 從 plan.js 抽出）。不碰 state / DOM，呼叫端把需要的資料傳進來。

// 嚴格以「這個計畫」為範圍：plan_id / global_plan_id / presetKey / preset_key 任一
// 對得上才算；四個都沒有的舊日誌才當「無歸屬」退路計入。不能用「沒有 plan_id
// 就算這個計畫」的寬鬆退路——那會把別的計畫（帶 global_plan_id 但沒有 camelCase
// plan_id）的打卡混進活躍度 / 累積章數（與 calculateAllPlansProgress 同一套規則）。
// activePlan 是看統計的人自己目前的計畫，它的 id／key 也算數。
export function logMatchesPlan(log, currentPlanId, currentPresetKey, activePlan = null) {
  const ap = activePlan || {};
  const planIds = [currentPlanId, ap.id, ap.globalPlanId, ap.global_plan_id].filter(Boolean).map(String);
  const planKeys = [currentPresetKey, ap.presetKey, ap.preset_key].filter(Boolean).map(String);
  const logPlanId = log.plan_id || log.global_plan_id;
  const logKey = log.presetKey || log.preset_key;
  return (logPlanId && planIds.includes(String(logPlanId))) ||
    (logKey && planKeys.includes(String(logKey))) ||
    (!log.plan_id && !log.global_plan_id && !log.presetKey && !log.preset_key);
}

// 組織統計樹每個節點（大區／牧區／小組／總計）的數字。
// contextPlan 決定「到今天應該讀到幾 %」；沒有計畫時以 50% 當基準。
export function computeOrgUnitStats(users, contextPlan = null, now = new Date()) {
  const list = users || [];
  const totalChapters = list.reduce((sum, u) => sum + (u.chapters_read || 0), 0);
  const totalMembers = list.length;
  const totalActive = list.filter(u => (u.chapters_read || 0) > 0 || Boolean(u.last_read)).length;
  const totalCompleted = list.filter(u => (u.current_round || 1) > 1 || (u.plan_progress || 0) >= 100).length;

  let expectedPct = 50;
  if (contextPlan) {
    const start = new Date(contextPlan.startDate + "T00:00:00");
    const end = new Date(contextPlan.endDate + "T00:00:00");
    const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const elapsed = Math.max(0, Math.min(totalDays, Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1));
    expectedPct = Math.round((elapsed / totalDays) * 100) || 0;
  }

  let behindCount = 0;
  let rereadCount = 0;
  list.forEach(u => {
    const currentRound = u.current_round !== undefined
      ? u.current_round
      : (u.chapters_read > 850 ? 3 : u.chapters_read > 500 ? 2 : 1);
    if (currentRound >= 2) {
      rereadCount++;
      return;
    }
    if (u.plan_progress === 0) behindCount++;
    else if (u.plan_progress < expectedPct - 5) behindCount++;
  });

  return { totalChapters, totalMembers, totalActive, totalCompleted, behindCount, rereadCount };
}
