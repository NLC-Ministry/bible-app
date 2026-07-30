// Security-critical account-link role resolution is shared with the Member Hub
// profile projection helper so tests exercise the same UUID-only policy.
export {
  MEMBER_ROLE_ID,
  collectHubPermissionSignals,
  normalizePermissionSignal,
  resolveSyncedRoleId
} from "./nlc-profile-sync.mjs";