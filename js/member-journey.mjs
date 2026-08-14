const KNOWN_REQUIRED_ACTIONS = new Set([
  'complete_profile',
  'submit_membership',
  'await_membership_review',
  'resolve_membership_record',
  'request_placement',
  'await_placement_review',
  'none',
]);

const KNOWN_MEMBERSHIP_STATES = new Set(['none', 'pending', 'approved', 'inactive']);
const KNOWN_PLACEMENT_STATES = new Set(['missing', 'active', 'invalid']);
const DEFAULT_MAX_PROJECTION_AGE_MS = 15 * 60 * 1000;

export function isCanonicalMemberJourneyProjection(user) {
  return Number(user?.member_context_contract_version) >= 2;
}

function recoveryFields(user) {
  return {
    requiredAction: String(user?.member_context_required_action || ''),
    requiredActionUrl: String(user?.member_context_required_action_url || '') || null,
  };
}

export function getCanonicalMemberPrerequisiteBlock(user, options = {}) {
  if (!isCanonicalMemberJourneyProjection(user)) return null;

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Number(options.maxAgeMs)
    : DEFAULT_MAX_PROJECTION_AGE_MS;
  const syncedAt = Date.parse(String(user?.member_context_synced_at || ''));
  const projectionAge = Number.isFinite(syncedAt) ? Math.max(0, now - syncedAt) : Infinity;
  const recovery = recoveryFields(user);

  if (projectionAge > maxAgeMs) {
    return { reason: 'member_context_unavailable', ...recovery };
  }

  const action = recovery.requiredAction;
  if (!KNOWN_REQUIRED_ACTIONS.has(action)) {
    return { reason: 'unknown_member_hub_action', ...recovery };
  }

  const membershipState = String(user?.member_context_membership_lifecycle_state || '');
  if (!KNOWN_MEMBERSHIP_STATES.has(membershipState)) {
    return { reason: 'unknown_member_hub_state', ...recovery };
  }
  if (membershipState === 'inactive') {
    return { reason: 'inactive_membership', ...recovery };
  }
  if (membershipState !== 'approved') {
    return { reason: 'membership_not_approved', ...recovery };
  }

  const placementState = String(user?.member_context_placement_state || '');
  if (!KNOWN_PLACEMENT_STATES.has(placementState)) {
    return { reason: 'unknown_member_hub_state', ...recovery };
  }
  if (placementState !== 'active' || user?.member_context_has_required_placement !== true) {
    return { reason: 'missing_canonical_placement', ...recovery };
  }

  if (action !== 'none') {
    return { reason: 'member_hub_action_required', ...recovery };
  }

  return null;
}

export { DEFAULT_MAX_PROJECTION_AGE_MS, KNOWN_REQUIRED_ACTIONS };
