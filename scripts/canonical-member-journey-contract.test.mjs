import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  getCanonicalMemberPrerequisiteBlock,
  getUserOnboardingBlock,
  isCanonicalMemberJourneyProjection,
  MEMBER_HUB_NOT_FOUND_ERROR,
} from '../js/member-journey.mjs';

const migrationPath = 'supabase/migrations/0093_canonical_member_journey_projection.sql';
const projectionFields = [
  'member_context_contract_version',
  'member_context_membership_lifecycle_state',
  'member_context_placement_state',
  'member_context_placement_workflow_state',
  'member_context_has_required_placement',
  'member_context_required_action',
  'member_context_required_action_url',
];

describe('canonical Member Hub journey projection', () => {
  it('stores externally versioned enum-like values as tolerant text', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    for (const field of projectionFields) expect(sql).toContain(field);
    expect(sql).toMatch(/member_context_required_action\s+text/i);
    expect(sql).toMatch(/member_context_membership_lifecycle_state\s+text/i);
    expect(sql).not.toMatch(/CHECK\s*\([^)]*member_context_required_action/i);
    expect(sql).not.toMatch(/CHECK\s*\([^)]*member_context_membership_lifecycle_state/i);
    expect(sql).toContain('unknown upstream values are preserved');
  });

  it('projects all v2 decision fields only after a successful Hub context fetch', () => {
    const source = fs.readFileSync('supabase/functions/nlc-session/index.ts', 'utf8');

    expect(source).toContain('projectCanonicalMemberJourney(memberContext)');
    expect(source).toContain('member_context_contract_version: canonicalJourney.contractVersion');
    expect(source).toContain('member_context_required_action: canonicalJourney.requiredAction');
    expect(source).toContain('member_context_required_action_url: canonicalJourney.requiredActionUrl');
    expect(source).toMatch(/\.\.\.\(memberContext \? \{[\s\S]*member_context_contract_version/);
  });
});

describe('canonical Bible user-onboarding door (#650: registered + not inactive only)', () => {
  const base = {
    member_context_contract_version: 2,
    member_context_membership_lifecycle_state: 'none',
    member_context_placement_state: 'missing',
    member_context_placement_workflow_state: 'none',
    member_context_has_required_placement: false,
    member_context_required_action: 'submit_membership',
    member_context_required_action_url: 'https://member.newlife.org.tw/member/continue',
    member_context_synced_at: '2026-08-14T11:59:00.000Z',
    member_context_sync_status: 'success',
    member_context_sync_error: '',
  };

  it('aliases the old prerequisite helper to the user-completion door', () => {
    expect(getCanonicalMemberPrerequisiteBlock).toBe(getUserOnboardingBlock);
  });

  it('asks to re-check when no Member Hub result was ever confirmed', () => {
    expect(getUserOnboardingBlock({ name: '王大明' })).toMatchObject({
      reason: 'member_context_unavailable',
    });
  });

  it('no longer blocks on name, first-run profile, or membership application', () => {
    for (const action of ['complete_profile', 'submit_membership', 'request_placement', 'resolve_membership_record', 'verify_phone', 'none']) {
      for (const lifecycle of ['none', 'pending', 'approved', 'something_new']) {
        expect(getUserOnboardingBlock({
          ...base,
          member_context_membership_lifecycle_state: lifecycle,
          member_context_required_action: action,
        })).toBeNull();
      }
    }
  });

  it('blocks an inactive membership', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'inactive',
      member_context_required_action: 'none',
    })).toMatchObject({ reason: 'inactive_membership' });
  });

  it('keeps using the last confirmed result however old, when Member Hub is unreachable', () => {
    expect(getUserOnboardingBlock({
      ...base,
      member_context_synced_at: '2025-01-01T00:00:00.000Z',
      member_context_sync_status: 'degraded',
      member_context_sync_error: 'member_hub_context_failed: timeout',
    })).toBeNull();
    expect(getUserOnboardingBlock({
      ...base,
      member_context_membership_lifecycle_state: 'inactive',
      member_context_synced_at: '2025-01-01T00:00:00.000Z',
      member_context_sync_error: 'member_hub_context_failed: timeout',
    })).toMatchObject({ reason: 'inactive_membership' });
  });

  it('blocks an account Member Hub says it has never seen', () => {
    expect(getUserOnboardingBlock({
      name: 'someone',
      member_context_sync_status: 'degraded',
      member_context_sync_error: MEMBER_HUB_NOT_FOUND_ERROR,
    })).toMatchObject({ reason: 'member_not_registered' });
    expect(MEMBER_HUB_NOT_FOUND_ERROR).toBe('member_hub_context_not_found');
  });

  it('nlc-session writes the same not-registered code, only for a 404 CONTEXT_NOT_FOUND', () => {
    const source = fs.readFileSync('supabase/functions/nlc-session/index.ts', 'utf8');
    expect(source).toContain(`const MEMBER_HUB_CONTEXT_NOT_FOUND = "${MEMBER_HUB_NOT_FOUND_ERROR}"`);
    const fn = source.slice(source.indexOf('function isMemberHubContextNotFound'), source.indexOf('async function fetchJsonOptional'));
    expect(fn).toContain('err?.status !== 404');
    expect(fn).toContain('CONTEXT_NOT_FOUND');
    expect(source).toContain('memberContextError = MEMBER_HUB_CONTEXT_NOT_FOUND');
  });

  it('recognizes a v2 projection', () => {
    expect(isCanonicalMemberJourneyProjection({ member_context_contract_version: 2 })).toBe(true);
    expect(isCanonicalMemberJourneyProjection({ member_context_contract_version: 1 })).toBe(false);
  });
});
