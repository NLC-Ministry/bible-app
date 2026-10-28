// 計畫之間的關係（#639）：獎項分組讀 plan_groups／plan_group_members，不再用 rules.stageNo 推。
//
// 一組＝一個獎；成員各佔一格（slot，例如「利未記」）。鐵獎＝「每一格至少完成一張」，
// 而且四格要在同一組裡湊齊：全教會鐵獎＝全教會 4 張月度期末賽，桃園鐵獎＝桃園 4 張梯次，
// 讀另一組的計畫不算進這一組（維護者 2026-10-28）。徽章牆仍然只有一個「鐵獎」，
// 任一組湊齊就能合成，畫面跟著最接近完成的那組。

export const IRON_AWARD_NAME = "鐵獎";

// 分組表還讀不到時（nlc-data 還沒部署新白名單、本機模式、查詢失敗）用這份。
// 內容跟 20261028034547_plan_groups_source_plan.sql 回填＋20261028043243_iron_award_group_dates.sql 補的日期一致。
export const DEFAULT_PLAN_GROUPS = Object.freeze([
  {
    key: "r1final_church",
    kind: "award",
    name: "鐵獎（全教會）",
    rules: {
      awardName: IRON_AWARD_NAME,
      completion: "every_slot",
      slots: ["出埃及記", "利未記", "民數記", "申命記"],
      seasonEndDate: "2026-12-31",
      finalSynthesisDate: "2027-01-02"
    },
    members: [
      { planId: "00000000-0000-0000-c126-000000202609", slot: "出埃及記", presetKey: "church_r1final_2026_09" },
      { planId: "00000000-0000-0000-c126-000000202610", slot: "利未記", presetKey: "church_r1final_2026_10" },
      { planId: "00000000-0000-0000-c126-000000202611", slot: "民數記", presetKey: "church_r1final_2026_11" },
      { planId: "00000000-0000-0000-c126-000000202612", slot: "申命記", presetKey: "church_r1final_2026_12" }
    ]
  },
  {
    key: "r1final_taoyuan",
    kind: "award",
    name: "鐵獎（桃園）",
    rules: {
      awardName: IRON_AWARD_NAME,
      completion: "every_slot",
      slots: ["出埃及記", "利未記", "民數記", "申命記"],
      seasonEndDate: "2027-01-31",
      finalSynthesisDate: "2027-02-02"
    },
    members: [
      { planId: "00000000-0000-0000-c326-000000202610", slot: "出埃及記", presetKey: "church_r1final_taoyuan_2026_10" },
      { planId: "00000000-0000-0000-c326-000000202611", slot: "利未記", presetKey: "church_r1final_taoyuan_2026_11" },
      { planId: "00000000-0000-0000-c326-000000202612", slot: "民數記", presetKey: "church_r1final_taoyuan_2026_12" },
      { planId: "00000000-0000-0000-c326-000000202701", slot: "申命記", presetKey: "church_r1final_taoyuan_2027_01" }
    ]
  }
]);

const DEFAULT_PRESET_KEY_BY_PLAN_ID = new Map(
  DEFAULT_PLAN_GROUPS.flatMap(group => group.members.map(member => [member.planId, member.presetKey]))
);

/**
 * plan_groups＋plan_group_members 兩張表的列 → 分組清單（成員掛在組底下）。
 * 讀不到（任一邊不是陣列）回 null，呼叫端退回 DEFAULT_PLAN_GROUPS。
 */
export function buildPlanGroups(groupRows, memberRows) {
  if (!Array.isArray(groupRows) || !Array.isArray(memberRows)) return null;
  const byId = new Map();
  const groups = groupRows
    .filter(row => row && row.id && row.key)
    .map(row => {
      const group = {
        key: String(row.key),
        kind: String(row.kind || ""),
        name: String(row.name || ""),
        rules: row.rules && typeof row.rules === "object" ? row.rules : {},
        members: []
      };
      byId.set(String(row.id), group);
      return group;
    });
  memberRows.forEach(row => {
    const group = row && byId.get(String(row.group_id));
    if (!group || !row.plan_id || !row.slot) return;
    group.members.push({ planId: String(row.plan_id), slot: String(row.slot) });
  });
  return groups;
}

function effectiveGroups(planGroups) {
  return Array.isArray(planGroups) ? planGroups : DEFAULT_PLAN_GROUPS;
}

/** 鐵獎的分組（種類 award、獎名鐵獎），依原本順序（全教會在前）。 */
export function getIronAwardGroups(planGroups) {
  return effectiveGroups(planGroups)
    .filter(group => group && group.kind === "award" && group.rules && group.rules.awardName === IRON_AWARD_NAME);
}

/** 這張計畫（global plan id 或報名紀錄的 globalPlanId）屬於哪個獎項分組；不屬於任何組回 null。 */
export function findAwardGroupForPlan(plan, planGroups) {
  if (!plan) return null;
  const ids = new Set([plan.globalPlanId, plan.global_plan_id, plan.id].filter(Boolean).map(String));
  if (!ids.size) return null;
  return effectiveGroups(planGroups).find(group => group && group.kind === "award"
    && (group.members || []).some(member => ids.has(String(member.planId)))) || null;
}

/** 成員對應的 presetKey：先看已載入的 global plans，再看內建那份（舊快取以 presetKey 為鍵）。 */
export function presetKeyForPlanId(planId, globalPlans) {
  const id = String(planId || "");
  const loaded = (Array.isArray(globalPlans) ? globalPlans : [])
    .find(plan => plan && [plan.id, plan.globalPlanId].filter(Boolean).map(String).includes(id));
  return (loaded && loaded.presetKey) || DEFAULT_PRESET_KEY_BY_PLAN_ID.get(id) || null;
}

/**
 * 一組鐵獎的進度。spec＝四格（{ key, book, badgeId }，依月份排序），
 * readSource(member) → { key, joined, completedRounds, plan }。
 * 同一格有好幾張計畫時取完成遍數最多的那張（不相加）。
 */
export function computeIronGroupStatus(group, { spec, readSource, now, defaultSynthesisDate, defaultSeasonEndDate, ironTierFromSum }) {
  const rules = (group && group.rules) || {};
  const synthesisDate = rules.finalSynthesisDate || defaultSynthesisDate;
  const seasonEndDate = rules.seasonEndDate || defaultSeasonEndDate;
  const months = spec.map(slotSpec => {
    const sources = (group.members || [])
      .filter(member => member.slot === slotSpec.book)
      .map(member => readSource(member));
    const completedRounds = sources.length ? Math.max(0, ...sources.map(source => source.completedRounds)) : 0;
    const joinedSources = sources.filter(source => source.joined);
    // 顯示用（進度／目前第幾遍）：遍數最多的那張；平手取進度較高的。
    const primary = joinedSources.slice()
      .sort((a, b) => (b.completedRounds - a.completedRounds) || (Number(b.plan.progress || 0) - Number(a.plan.progress || 0)))[0] || null;
    const { endDate: _endDate, ...rest } = slotSpec;
    return {
      ...rest,
      keys: sources.map(source => source.key),
      sources: sources.map(({ plan: _plan, ...source }) => ({ ...source, group: group.key, synthesisDate, seasonEndDate })),
      joined: joinedSources.length > 0,
      progress: primary ? Number(primary.plan.progress || 0) : 0,
      currentRound: primary ? Math.max(1, Number(primary.plan.currentRound || 1)) : 1,
      completedRounds,
      synthesisDate,
      seasonEndDate
    };
  });
  const perRounds = months.map(month => month.completedRounds);
  const collected = months.filter(month => month.completedRounds >= 1).length;
  const starSum = perRounds.reduce((sum, value) => sum + value, 0);
  const minRounds = perRounds.length ? Math.min(...perRounds) : 0;
  const thresholdMet = months.length === 4 && minRounds >= 1;
  const seasonEnded = now >= new Date(synthesisDate + "T00:00:00");
  return {
    groupKey: group.key,
    months, collected, starSum, minRounds, thresholdMet,
    joined: months.some(month => month.joined),
    synthesisDate, seasonEndDate, seasonEnded,
    previewTier: thresholdMet ? ironTierFromSum(starSum) : 0
  };
}

/**
 * 畫面跟著哪一組：現在就能合成的 → 已湊齊的 → 湊得多的 → 遍數多的 → 有加入的 → 原本順序。
 * 每組各自計算，不跨組混算。
 */
export function pickGoverningIronGroup(statuses) {
  const ranked = statuses.map((status, index) => ({ status, index }));
  ranked.sort((a, b) =>
    (Number(b.status.thresholdMet && b.status.seasonEnded) - Number(a.status.thresholdMet && a.status.seasonEnded))
    || (Number(b.status.thresholdMet) - Number(a.status.thresholdMet))
    || (b.status.collected - a.status.collected)
    || (b.status.starSum - a.status.starSum)
    || (Number(b.status.joined) - Number(a.status.joined))
    || (a.index - b.index));
  return ranked.length ? ranked[0].status : null;
}

/**
 * 這張計畫的獎是不是要透過分組合成（不是讀完這張就發）：屬於某個獎項分組，
 * 或者獎名就是鐵獎（例如從月度期末賽複製、還沒編進分組的梯次）——鐵獎只能在徽章牆合成。
 */
export function isAwardedThroughGroup(plan, planGroups) {
  if (!plan) return false;
  const awardName = plan.awardName || (plan.campaignDefinition && plan.campaignDefinition.awardName) || "";
  return Boolean(findAwardGroupForPlan(plan, planGroups)) || awardName === IRON_AWARD_NAME;
}
