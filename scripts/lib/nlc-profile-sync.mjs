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

export function orgFromMemberContext(organization) {
  const org = organization || {};
  const nodeName = org.placementNodeName ? String(org.placementNodeName).trim() : "";
  const levelName = org.placementLevelName ? String(org.placementLevelName).trim() : "";
  const result = { great_region: null, pastoral_zone: null, small_group: null };
  if (!nodeName || !levelName) return result;

  for (const [field, hints] of Object.entries(LEVEL_NAME_HINTS)) {
    if (hints.some((hint) => levelName.includes(hint))) {
      result[field] = nodeName;
      break;
    }
  }
  return result;
}

export function mergeOrgSources(platformOrg, placementOrg, contextOrganization) {
  const contextOrg = orgFromMemberContext(contextOrganization);

  const pick = (field) => {
    const fromPlacement = placementOrg?.[field];
    if (fromPlacement) return fromPlacement;
    const fromContext = contextOrg[field];
    if (fromContext) return fromContext;
    const fromPlatform = platformOrg?.[field];
    if (fromPlatform) return fromPlatform;
    return null;
  };

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

export const MEMBER_ROLE_ID = "10000000-0000-4000-8000-000000000001";

export function normalizePermissionSignal(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function collectHubPermissionSignals(memberContext) {
  const leadership = memberContext?.leadershipIdentity || {};
  const assignments = Array.isArray(leadership.assignments) ? leadership.assignments : [];
  const roles = Array.isArray(memberContext?.roles) ? memberContext.roles : [];
  const membershipApproved = memberContext?.membershipState === "approved";
  const normalizedRoles = roles.map(normalizePermissionSignal).filter(Boolean);
  const satelliteAdminVerified = membershipApproved
    && normalizedRoles.includes("satellite_admin");
  const regularKeys = [
    ...roles,
    memberContext?.primaryRole,
    ...assignments.map(assignment => assignment?.identityKey)
  ].map(normalizePermissionSignal).filter(Boolean)
    .filter(value => value !== "satellite_admin");
  const keys = satelliteAdminVerified ? [...regularKeys, "satellite_admin"] : regularKeys;
  const labels = [
    memberContext?.primaryRole,
    leadership.displayLabel,
    ...assignments.map(assignment => assignment?.displayName)
  ].map(normalizePermissionSignal).filter(Boolean)
    .filter(value => value !== "satellite_admin");
  return {
    keys: [...new Set(keys)],
    labels: [...new Set(labels)],
    primaryRole: normalizePermissionSignal(memberContext?.primaryRole) === "satellite_admin"
      ? ""
      : normalizePermissionSignal(memberContext?.primaryRole),
    satelliteAdminVerified
  };
}

export function resolveSyncedRoleId(memberContext, definitions, existingRoleId, linkedBy) {
  const strong = linkedBy === "identity" || linkedBy === "member_id" || linkedBy === "none";
  if (!strong) return MEMBER_ROLE_ID;
  if (!memberContext) return existingRoleId || MEMBER_ROLE_ID;

  const signals = collectHubPermissionSignals(memberContext);
  const matched = (definitions || [])
    .filter(definition => {
      const keys = (definition.hub_permission_keys || []).map(normalizePermissionSignal);
      const labels = [
        definition.code,
        definition.label,
        ...(definition.hub_permission_labels || [])
      ].map(normalizePermissionSignal);
      const keyMatched = signals.keys.some(value => keys.includes(value));
      const labelMatched = signals.labels.some(value => labels.includes(value));
      const adminPrimaryRoleMatched = definition.code === "admin"
        && Boolean(signals.primaryRole)
        && labels.includes(signals.primaryRole);
      // Leadership display text alone must never grant administrative authority.
      return keyMatched || adminPrimaryRoleMatched || (definition.code !== "admin" && labelMatched);
    })
    .sort((left, right) =>
      Number(left.sort_order ?? 100) - Number(right.sort_order ?? 100)
    )[0];
  return matched?.id || MEMBER_ROLE_ID;
}
const HUB_OWNED_PROFILE_FIELDS = ["name", "great_region", "pastoral_zone", "small_group"];

const INVENTED_PROFILE_NAMES = new Set(["教會肢體", "NLC User", "新使用者", "尚未取得姓名", "未命名使用者"]);

export function resolveProjectedProfileName({ hubName, existingName }) {
  const hub = String(hubName || "").trim();
  if (hub && !INVENTED_PROFILE_NAMES.has(hub)) return hub;
  const existing = String(existingName || "").trim();
  if (existing && !INVENTED_PROFILE_NAMES.has(existing)) return existing;
  return "";
}

export function buildLockedFields(sourceValues, options = {}) {
  const locked = Object.entries(sourceValues)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([field]) => field);

  if (options.hubLinked) {
    for (const field of HUB_OWNED_PROFILE_FIELDS) {
      if (!locked.includes(field)) locked.push(field);
    }
  }

  return locked;
}

/**
 * Project org placement into profile fields. When hubLinked, Member Hub is
 * canonical — empty Hub values clear stale local projection instead of
 * preserving existing profile org fields.
 */
export function projectOrgFieldsFromHub(mergedOrg, existingProfile, hubLinked) {
  const hubOrg = {
    great_region: mergedOrg?.great_region ? String(mergedOrg.great_region).trim() : "",
    pastoral_zone: mergedOrg?.pastoral_zone ? String(mergedOrg.pastoral_zone).trim() : "",
    small_group: mergedOrg?.small_group ? String(mergedOrg.small_group).trim() : ""
  };

  if (hubLinked) return hubOrg;

  const firstValue = (...values) => {
    for (const value of values) {
      if (value !== null && value !== undefined && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };

  return {
    great_region: firstValue(hubOrg.great_region, existingProfile?.great_region),
    pastoral_zone: firstValue(hubOrg.pastoral_zone, existingProfile?.pastoral_zone),
    small_group: firstValue(hubOrg.small_group, existingProfile?.small_group)
  };
}

function copyOrgFields(org) {
  return {
    great_region: org?.great_region || null,
    pastoral_zone: org?.pastoral_zone || null,
    small_group: org?.small_group || null
  };
}

export function buildOrgProjectionAudit({
  memberContext,
  organization,
  platformOrgFields,
  placementOrgFields,
  contextOrgFields,
  mergedOrg,
  projectedOrg,
  existingProfile,
  orgResolutionSource,
  memberContextError
}) {
  const canonicalPlacement = {
    placementNodeId: organization?.placementNodeId || null,
    placementNodeName: organization?.placementNodeName || null,
    placementLevelName: organization?.placementLevelName || null,
    hasRequiredPlacement: memberContext?.hasRequiredPlacement ?? null
  };

  return {
    source: orgResolutionSource || "none",
    status: projectedOrg?.great_region || projectedOrg?.pastoral_zone || projectedOrg?.small_group ? "projected" : "empty",
    member_context_available: Boolean(memberContext),
    member_context_error: memberContextError || null,
    canonical_placement: canonicalPlacement,
    inputs: {
      platform: copyOrgFields(platformOrgFields),
      placement: copyOrgFields(placementOrgFields),
      context: copyOrgFields(contextOrgFields),
      merged: copyOrgFields(mergedOrg)
    },
    existing_profile: copyOrgFields(existingProfile),
    projected_profile: copyOrgFields(projectedOrg)
  };
}
