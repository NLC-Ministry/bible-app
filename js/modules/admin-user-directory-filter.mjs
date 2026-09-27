export const ADMIN_ORG_UNASSIGNED = "__unassigned__";

function normalizedOrgValue(value) {
  return String(value || "").trim();
}

function normalizedSelectedValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(normalizedOrgValue).filter(Boolean))];
}

function profileOrgFilterValue(profile, field) {
  return normalizedOrgValue(profile?.[field]) || ADMIN_ORG_UNASSIGNED;
}

export function matchesAdminUserDirectoryOrgFilters(profile, filters = {}) {
  const entries = [
    ["great_region", filters.regions ?? filters.region],
    ["pastoral_zone", filters.zones ?? filters.zone],
    ["small_group", filters.groups ?? filters.group]
  ];

  return entries.every(([field, selected]) => {
    const selectedValues = normalizedSelectedValues(selected);
    return selectedValues.length === 0 || selectedValues.includes(profileOrgFilterValue(profile, field));
  });
}

function uniqueOrgValues(profiles, field) {
  return [...new Set((profiles || []).map(profile => profileOrgFilterValue(profile, field)))];
}

export function buildAdminUserDirectoryOrgOptions(profiles, filters = {}) {
  const allProfiles = Array.isArray(profiles) ? profiles : [];
  const regions = normalizedSelectedValues(filters.regions ?? filters.region);
  const zones = normalizedSelectedValues(filters.zones ?? filters.zone);
  const regionProfiles = regions.length > 0
    ? allProfiles.filter(profile => regions.includes(profileOrgFilterValue(profile, "great_region")))
    : allProfiles;
  const zoneProfiles = zones.length > 0
    ? regionProfiles.filter(profile => zones.includes(profileOrgFilterValue(profile, "pastoral_zone")))
    : regionProfiles;

  return {
    regions: uniqueOrgValues(allProfiles, "great_region"),
    zones: uniqueOrgValues(regionProfiles, "pastoral_zone"),
    groups: uniqueOrgValues(zoneProfiles, "small_group")
  };
}

// ---------------------------------------------------------------------------
// 計畫篩選：使用者基本資料可以任選一個計畫，看「是否加入該計畫」與「在該計畫
// 是否已組隊」。fetchAdminUserProfiles() 為每位使用者附上
//   joined_plan_ids: string[]                         —— 已加入的 global plan id
//   teams_by_plan:   { [planId]: [{ name, role }] }  —— 各計畫所屬隊伍（3 人組、
//                                                        6 人組可同時各有一隊）
// ---------------------------------------------------------------------------

export const ADMIN_PLAN_FILTER_ALL = "all";
export const ADMIN_PLAN_PARTICIPATION_JOINED = "joined";
export const ADMIN_PLAN_PARTICIPATION_NOT_JOINED = "not_joined";
export const ADMIN_PLAN_TEAM_JOINED = "joined";
export const ADMIN_PLAN_TEAM_NOT_JOINED = "not_joined";

const CHURCH_STAGE_PRESET_PATTERN = /^church_stage_(\d{2})$/;

// 正式階段的 global plan id 尾 12 碼就是階段序（…c026-00000000000N）；舊的
// reading_plans 列可能只有 preset_key（church_stage_NN）沒有 global_plan_id。
export function churchStagePresetKeyToPlanId(presetKey) {
  const match = String(presetKey || "").match(CHURCH_STAGE_PRESET_PATTERN);
  if (!match) return "";
  return `00000000-0000-0000-c026-${String(Number(match[1])).padStart(12, "0")}`;
}

export function resolveEnrollmentPlanId(enrollment, presetKeyToPlanId = new Map()) {
  const globalPlanId = String(enrollment?.global_plan_id || "").trim();
  if (globalPlanId) return globalPlanId;
  const presetKey = String(enrollment?.preset_key || "").trim();
  if (!presetKey) return "";
  return String(presetKeyToPlanId.get(presetKey) || churchStagePresetKeyToPlanId(presetKey) || "");
}

export function isTeamCaptainRole(role) {
  return role === "captain" || role === "leader";
}

export function getProfilePlanStatus(profile, planId) {
  const key = String(planId || "");
  const joinedPlanIds = Array.isArray(profile?.joined_plan_ids) ? profile.joined_plan_ids : [];
  const teams = key && Array.isArray(profile?.teams_by_plan?.[key]) ? profile.teams_by_plan[key] : [];
  return {
    joined: Boolean(key) && joinedPlanIds.includes(key),
    teams
  };
}

export function formatProfilePlanTeams(teams) {
  return (Array.isArray(teams) ? teams : [])
    .map(team => `${isTeamCaptainRole(team?.role) ? "[隊長] " : ""}${String(team?.name || "").trim() || "未命名隊伍"}`)
    .join("、");
}

export function matchesAdminUserDirectoryPlanFilters(profile, filters = {}) {
  const participation = filters.participation || ADMIN_PLAN_FILTER_ALL;
  const team = filters.team || ADMIN_PLAN_FILTER_ALL;
  if (participation === ADMIN_PLAN_FILTER_ALL && team === ADMIN_PLAN_FILTER_ALL) return true;
  const status = getProfilePlanStatus(profile, filters.planId);

  if (participation === ADMIN_PLAN_PARTICIPATION_JOINED && !status.joined) return false;
  if (participation === ADMIN_PLAN_PARTICIPATION_NOT_JOINED) {
    if (status.joined) return false;
    // 「未加入」名單是拿來邀請用的：停用帳號與管理員本人不列入（沿用舊的
    // 「未加入第一階段計畫」篩選規則）。
    if (profile?.is_active !== true) return false;
    if (filters.currentProfileId && String(profile?.id || "") === String(filters.currentProfileId)) return false;
  }

  const hasTeam = status.teams.length > 0;
  if (team === ADMIN_PLAN_TEAM_JOINED && !hasTeam) return false;
  if (team === ADMIN_PLAN_TEAM_NOT_JOINED && hasTeam) return false;
  return true;
}
