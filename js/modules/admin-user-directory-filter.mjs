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
