/**
 * Pure helpers for NLC Member Hub / Platform profile sync.
 * Duplicated in supabase/functions/nlc-session/index.ts — keep in sync via tests.
 */

export function orgFromProjectedOrganization(organization) {
  const org = organization || {};
  const pick = (...values) => {
    for (const value of values) {
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return null;
  };

  return {
    great_region: pick(org.greatRegion, org.placementGreatRegion),
    pastoral_zone: pick(org.pastoralZone, org.placementPastoralZone),
    small_group: pick(org.smallGroup, org.placementSmallGroup)
  };
}

export function mergeOrgSources(projectedOrg, fallbackOrg = {}) {
  const pick = (field) => projectedOrg?.[field] || fallbackOrg?.[field] || null;

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

export function resolveRequiredPlacement(context, previousValue = false) {
  if (typeof context?.hasRequiredPlacement === "boolean") return context.hasRequiredPlacement;
  return Boolean(previousValue);
}

const DEFAULT_ALLOWED_ROLES = new Set([
  "member",
  "group_leader",
  "zone_leader",
  "great_zone_leader",
  "admin"
]);

/**
 * Role sync policy (Phase 1): Hub primaryRole admin maps to app admin;
 * otherwise preserve existing Supabase role (including SQL-promoted admin).
 *
 * TODO(Phase 2): Map org-placement leaderships[].roleName → group_leader/zone_leader/great_zone_leader.
 * See https://nlc-b1ffeeba.mintlify.site/api-reference/member-org-placement
 */
export function resolveSyncedRole(primaryRole, existingRole, allowedRoles = DEFAULT_ALLOWED_ROLES) {
  if (primaryRole === "admin" && allowedRoles.has("admin")) return "admin";
  if (existingRole !== null && existingRole !== undefined && String(existingRole).trim() !== "") {
    const existing = String(existingRole).trim();
    return existing === "senior_pastor" ? "admin" : existing;
  }
  return "member";
}

export function buildLockedFields(sourceValues) {
  return Object.entries(sourceValues)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([field]) => field);
}
