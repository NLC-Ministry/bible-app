const ALREADY_JOINED_TEAM_CODES = [
  "already_in_plan_division",
  "already_in_plan_team"
];

function collectResultValues(result) {
  if (!result || typeof result !== "object") return [result];

  const error = result.error;
  return [
    result.code,
    result.message,
    typeof error === "object" && error ? error.code : null,
    typeof error === "object" && error ? error.message : null,
    typeof error === "object" && error ? error.details : null,
    typeof error === "object" && error ? error.hint : null,
    typeof error === "object" ? null : error
  ];
}

export function isAlreadyJoinedTeamResult(result) {
  const values = collectResultValues(result)
    .filter(value => value !== null && value !== undefined)
    .map(value => String(value));

  return values.some(value => {
    const normalized = value.toLowerCase();
    return ALREADY_JOINED_TEAM_CODES.some(code => normalized.includes(code))
      || normalized.includes("已加入這個人數組別的團隊");
  });
}

function planIdentifiers(plan) {
  if (!plan) return [];
  return [plan.id, plan.presetKey, plan.globalPlanId, plan.global_plan_id]
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(String);
}

function isMatchingPlan(left, right) {
  const rightIdentifiers = new Set(planIdentifiers(right));
  return planIdentifiers(left).some(identifier => rightIdentifiers.has(identifier));
}

export async function resolveTeamJoinEffectivePlan({
  teamJoinResult,
  matchingPlan,
  activePlans = [],
  joinPlan
}) {
  const teamMembershipResolved = Boolean(teamJoinResult && teamJoinResult.success)
    || isAlreadyJoinedTeamResult(teamJoinResult);
  if (!teamMembershipResolved || !matchingPlan) return null;

  if (activePlans.some(plan => isMatchingPlan(plan, matchingPlan))) {
    return matchingPlan;
  }

  if (typeof joinPlan !== "function") return null;
  return await joinPlan(matchingPlan) || null;
}

export function resetPlanTeamInvitePanelState({
  panel,
  trigger,
  target,
  restoreFocus = false
}) {
  if (panel) panel.classList.add("hidden");
  trigger?.setAttribute("aria-expanded", "false");
  if (target) target.click();
  if (restoreFocus) trigger?.focus();
}
