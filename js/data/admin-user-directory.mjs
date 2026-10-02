// 管理頁「使用者基本資料」「權限管理」共用的名單（#395）。
// get_admin_user_directory 一次回傳全部 profiles（短 key，見 migration 註解），
// 這裡把它還原成 fetchAdminUserProfiles／fetchManagedScopeProfiles 原本分頁查詢的形狀。
import { resolveEnrollmentPlanId } from "../modules/admin-user-directory-filter.mjs";

export const ADMIN_USER_DIRECTORY_RPC = "get_admin_user_directory";

export function isAdminUserDirectoryDigest(digest) {
  return Boolean(digest) && typeof digest === "object" && Array.isArray(digest.p);
}

// 舊的報名列可能只有 preset_key，依 state.globalPlans 的 presetKey 對回計畫。
export function buildPresetKeyToPlanId(globalPlans = []) {
  const presetKeyToPlanId = new Map();
  (Array.isArray(globalPlans) ? globalPlans : []).forEach(plan => {
    if (plan && plan.presetKey && plan.presetKey !== plan.id) presetKeyToPlanId.set(String(plan.presetKey), String(plan.id));
  });
  return presetKeyToPlanId;
}

function toRoleDefinition(value, { withScopeType = false } = {}) {
  if (!Array.isArray(value)) return null;
  const [id, code, label, scopeType] = value;
  return withScopeType
    ? { id: id ?? null, code: code ?? null, label: label ?? null, scope_type: scopeType ?? null }
    : { id: id ?? null, code: code ?? null, label: label ?? null };
}

function toBaseProfile(row) {
  return {
    id: row.i,
    name: row.n ?? null,
    email: row.m ?? null,
    great_region: row.r ?? null,
    pastoral_zone: row.z ?? null,
    small_group: row.g ?? null,
    role_id: row.ri ?? null
  };
}

export function adminUserDirectoryFromDigest(digest, presetKeyToPlanId = new Map()) {
  if (!isAdminUserDirectoryDigest(digest)) return [];
  return digest.p.filter(row => row && row.i).map(row => {
    const joinedPlanIds = new Set();
    (Array.isArray(row.j) ? row.j : []).forEach(entry => {
      if (!Array.isArray(entry)) return;
      const planId = resolveEnrollmentPlanId({ global_plan_id: entry[0], preset_key: entry[1] }, presetKeyToPlanId);
      if (planId) joinedPlanIds.add(planId);
    });
    const teamsByPlan = {};
    (Array.isArray(row.t) ? row.t : []).forEach(entry => {
      if (!Array.isArray(entry) || !entry[0]) return;
      const planId = String(entry[0]);
      if (!teamsByPlan[planId]) teamsByPlan[planId] = [];
      teamsByPlan[planId].push({ name: entry[1] || "", role: entry[2] || null });
    });
    return {
      ...toBaseProfile(row),
      is_active: row.a ?? null,
      member_context_synced_at: row.s ?? null,
      member_context_sync_status: row.ss ?? null,
      role_definition: toRoleDefinition(row.rd),
      joined_plan_ids: Array.from(joinedPlanIds),
      teams_by_plan: teamsByPlan
    };
  });
}

// 權限管理只看在職（is_active = true）的人，跟舊查詢的 .eq("is_active", true) 一樣。
export function managedScopeProfilesFromDigest(digest) {
  if (!isAdminUserDirectoryDigest(digest)) return [];
  return digest.p.filter(row => row && row.i && row.a === true).map(row => ({
    ...toBaseProfile(row),
    managed_regions: row.mr ?? null,
    managed_zones: row.mz ?? null,
    managed_groups: row.mg ?? null,
    role_definition: toRoleDefinition(row.rd, { withScopeType: true })
  }));
}
