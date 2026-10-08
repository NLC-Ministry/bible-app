// set_profile_managed_scopes rejects names missing from great_regions /
// pastoral_zones / small_groups (#459). The editor therefore offers and
// pre-checks only names that exist in the org structure; a stale stored name
// or a placement name that doesn't match the list is dropped, so saving never
// trips the server check.
export function buildManagedScopeChoices(options, defaultScopes) {
  const optionNames = Array.from(new Set(
    (options || []).map(option => String(option?.name || option?.id || "").trim()).filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, "zh-Hant"));
  const known = new Set(optionNames);
  const selected = (defaultScopes || []).map(name => String(name).trim()).filter(name => known.has(name));
  const dropped = (defaultScopes || []).map(name => String(name).trim()).filter(name => name && !known.has(name));
  return { optionNames, selected, dropped };
}

const MANAGED_SCOPE_ERROR_MESSAGES = {
  managed_scope_unknown_region: "有大區名稱不在組織名單中，請重新整理後再選一次。",
  managed_scope_unknown_zone: "有牧區名稱不在組織名單中，請重新整理後再選一次。",
  managed_scope_unknown_group: "有小組名稱不在組織名單中，請重新整理後再選一次。",
  managed_scope_admin_required: "只有管理員可以設定管理範圍。",
  managed_scope_profile_not_found: "找不到這位人員，請重新整理。"
};

export function managedScopeErrorMessage(error) {
  const raw = String(error?.message || "");
  const code = Object.keys(MANAGED_SCOPE_ERROR_MESSAGES).find(key => raw.includes(key));
  return code ? MANAGED_SCOPE_ERROR_MESSAGES[code] : (raw || "儲存失敗。");
}
