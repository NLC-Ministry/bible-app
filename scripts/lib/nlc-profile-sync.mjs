/**
 * Pure helpers for NLC Member Hub / Platform profile sync.
 * Duplicated in supabase/functions/nlc-session/index.ts — keep in sync via tests.
 */

const LEVEL_DEPTH = {
  great_region: 0,
  pastoral_zone: 1,
  small_group: 2
};

const LEVEL_NAME_HINTS = {
  great_region: ["大區"],
  pastoral_zone: ["牧區"],
  small_group: ["小組"]
};

function pickNameByDepth(segments, depth) {
  if (!Array.isArray(segments)) return null;
  const match = segments.find((seg) => seg && seg.levelDepth === depth);
  if (match && match.name) return String(match.name).trim() || null;
  const byIndex = segments[depth];
  if (byIndex && byIndex.name) return String(byIndex.name).trim() || null;
  return null;
}

function pickNameByLevelName(segments, hints) {
  if (!Array.isArray(segments) || !hints || !hints.length) return null;
  const match = segments.find((seg) => {
    const label = String(seg?.levelName || "").trim();
    return hints.some((hint) => label.includes(hint));
  });
  return match && match.name ? String(match.name).trim() || null : null;
}

export function orgFromCareChain(careChain) {
  return {
    great_region: pickNameByDepth(careChain, LEVEL_DEPTH.great_region),
    pastoral_zone: pickNameByDepth(careChain, LEVEL_DEPTH.pastoral_zone),
    small_group: pickNameByDepth(careChain, LEVEL_DEPTH.small_group)
  };
}

export function orgFromHomePath(path) {
  if (!Array.isArray(path)) {
    return { great_region: null, pastoral_zone: null, small_group: null };
  }
  return {
    great_region: pickNameByLevelName(path, LEVEL_NAME_HINTS.great_region) || pickNameByDepth(path, 0),
    pastoral_zone: pickNameByLevelName(path, LEVEL_NAME_HINTS.pastoral_zone) || pickNameByDepth(path, 1),
    small_group: pickNameByLevelName(path, LEVEL_NAME_HINTS.small_group) || pickNameByDepth(path, 2)
  };
}

export function orgFromLegacyOrganization(organization) {
  const org = organization || {};
  return {
    great_region: org.homeRegionName ? String(org.homeRegionName).trim() : null,
    pastoral_zone: org.homeZoneName ? String(org.homeZoneName).trim() : null,
    small_group: org.homeGroupName ? String(org.homeGroupName).trim() : null
  };
}

export function mergeOrgSources(platformOrg, placementOrg, contextOrganization) {
  const legacy = orgFromLegacyOrganization(contextOrganization);
  const homeNodeName = contextOrganization?.homeNodeName
    ? String(contextOrganization.homeNodeName).trim()
    : null;

  const pick = (field) => {
    const fromPlatform = platformOrg?.[field];
    if (fromPlatform) return fromPlatform;
    const fromPlacement = placementOrg?.[field];
    if (fromPlacement) return fromPlacement;
    const fromLegacy = legacy[field];
    if (fromLegacy) return fromLegacy;
    if (field === "pastoral_zone" && homeNodeName) return homeNodeName;
    return null;
  };

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

const DEFAULT_ALLOWED_ROLES = new Set([
  "member",
  "group_leader",
  "zone_leader",
  "great_zone_leader",
  "admin",
  "senior_pastor"
]);

/**
 * Role sync policy (Phase 1): Hub primaryRole admin maps to app admin;
 * otherwise preserve existing Supabase role (including SQL-promoted admin/senior_pastor).
 *
 * TODO(Phase 2): Map org-placement leaderships[].roleName → group_leader/zone_leader/great_zone_leader.
 * See https://nlc-b1ffeeba.mintlify.site/api-reference/member-org-placement
 */
export function resolveSyncedRole(primaryRole, existingRole, allowedRoles = DEFAULT_ALLOWED_ROLES) {
  if (primaryRole === "admin" && allowedRoles.has("admin")) return "admin";
  if (existingRole !== null && existingRole !== undefined && String(existingRole).trim() !== "") {
    return String(existingRole).trim();
  }
  return "member";
}

export function buildLockedFields(sourceValues) {
  return Object.entries(sourceValues)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([field]) => field);
}
