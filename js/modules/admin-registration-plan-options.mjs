export const FIRST_STAGE_GLOBAL_PLAN_ID = "00000000-0000-0000-c026-000000000001";

export function isValidPlanId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function buildAdminRegistrationStatisticsPlans(globalPlans = [], presets = {}) {
  const plansById = new Map();
  const addPlan = plan => {
    if (!plan || !isValidPlanId(plan.id)) return;
    if ((plan.planKind || plan.plan_kind) === "church_campaign") return;
    plansById.set(String(plan.id), plan);
  };

  (Array.isArray(globalPlans) ? globalPlans : []).forEach(addPlan);

  const configuredStageOne = presets?.church_stage_01;
  const stageOne = configuredStageOne || {
    id: FIRST_STAGE_GLOBAL_PLAN_ID,
    name: "第1階段｜第一輪熱身賽",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    planKind: "church_campaign_stage"
  };
  if (!plansById.has(FIRST_STAGE_GLOBAL_PLAN_ID)) {
    addPlan({
      ...stageOne,
      id: FIRST_STAGE_GLOBAL_PLAN_ID,
      globalPlanId: FIRST_STAGE_GLOBAL_PLAN_ID,
      presetKey: "church_stage_01"
    });
  }

  return Array.from(plansById.values())
    .sort((left, right) => String(right.startDate || right.start_date || "")
      .localeCompare(String(left.startDate || left.start_date || "")));
}
