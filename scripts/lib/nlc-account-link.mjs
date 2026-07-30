// Security-critical account-link decision logic for nlc-session.
//
// Threat: NLC identity can be phone-primary, so the email in a Logto token is not
// guaranteed to be a verified, caller-owned address. Linking an incoming login to
// an existing profile by email alone must therefore NEVER escalate privilege — or
// an attacker with a token bearing an admin's email could inherit that admin role.
//
// `linkedBy` describes HOW the existing profile was matched:
//   "identity"  — matched by Logto sub (strong; the caller proved this identity)
//   "member_id" — matched by NLC member id from the authenticated Hub context (strong)
//   "email"     — matched only by email (WEAK; may not be caller-owned)
//   "none"      — no existing profile (new account, keyed by the strong Logto sub)
//
// This module is pure and unit-tested. Keep it in sync with the copy in
// supabase/functions/nlc-session/index.ts (Deno cannot import this Node .mjs directly).

export const PRIVILEGED_ROLES = [
  "admin",
  "senior_pastor",
  "great_zone_leader",
  "zone_leader",
  "group_leader",
];

const PRIVILEGED = new Set(PRIVILEGED_ROLES);

function isStrong(linkedBy) {
  return linkedBy === "identity" || linkedBy === "member_id" || linkedBy === "none";
}

/**
 * Decide the role to sync onto the profile.
 * @param {string|null|undefined} primaryRole  Hub-asserted primary role for this login.
 * @param {string|null|undefined} existingRole Role already on the matched profile (if any).
 * @param {"identity"|"member_id"|"email"|"none"} linkedBy How the profile was matched.
 * @returns {string}
 */
export function resolveSyncedRole(primaryRole, existingRole, linkedBy) {
  const strong = isStrong(linkedBy);

  // Federated admin grant only when the identity is strongly established.
  if (primaryRole === "admin" && strong) return "admin";

  const existing = existingRole == null ? "" : String(existingRole).trim();
  if (existing !== "") {
    if (existing === "senior_pastor") return strong ? "senior_pastor" : "member";
    if (strong) return existing;
    // Weak (email) link: allow account continuity for ordinary members, but never
    // inherit a privileged role that the caller has not strongly proven.
    return PRIVILEGED.has(existing) ? "member" : existing;
  }

  return "member";
}
