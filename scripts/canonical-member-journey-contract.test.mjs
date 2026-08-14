import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  getCanonicalMemberPrerequisiteBlock,
  isCanonicalMemberJourneyProjection,
} from '../js/member-journey.mjs';

const migrationPath = 'supabase/migrations/0092_canonical_member_journey_projection.sql';
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

describe('canonical Bible member prerequisite', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');
  const eligible = {
    member_context_contract_version: 2,
    member_context_membership_lifecycle_state: 'approved',
    member_context_placement_state: 'active',
    member_context_placement_workflow_state: 'none',
    member_context_has_required_placement: true,
    member_context_required_action: 'none',
    member_context_required_action_url: 'https://member.newlife.org.tw/member/continue',
    member_context_synced_at: '2026-08-14T11:59:00.000Z',
    member_context_sync_status: 'success',
  };

  it('recognizes v2 without requiring a local pastoral-zone inference', () => {
    expect(isCanonicalMemberJourneyProjection(eligible)).toBe(true);
    expect(getCanonicalMemberPrerequisiteBlock(eligible, { now })).toBeNull();
  });

  it('keeps active placement eligible while a placement change is pending', () => {
    expect(getCanonicalMemberPrerequisiteBlock({
      ...eligible,
      member_context_placement_workflow_state: 'change_request_pending',
    }, { now })).toBeNull();
  });

  it('blocks missing placement using the upstream recovery URL', () => {
    expect(getCanonicalMemberPrerequisiteBlock({
      ...eligible,
      member_context_placement_state: 'missing',
      member_context_has_required_placement: false,
      member_context_required_action: 'request_placement',
    }, { now })).toMatchObject({
      reason: 'missing_canonical_placement',
      requiredAction: 'request_placement',
      requiredActionUrl: 'https://member.newlife.org.tw/member/continue',
    });
  });

  it('preserves access briefly during degraded refresh but fails closed after 15 minutes', () => {
    expect(getCanonicalMemberPrerequisiteBlock({
      ...eligible,
      member_context_sync_status: 'degraded',
      member_context_synced_at: '2026-08-14T11:50:00.000Z',
    }, { now })).toBeNull();

    expect(getCanonicalMemberPrerequisiteBlock({
      ...eligible,
      member_context_sync_status: 'degraded',
      member_context_synced_at: '2026-08-14T11:40:00.000Z',
    }, { now })).toMatchObject({ reason: 'member_context_unavailable' });
  });

  it('preserves future action values but fails authorization closed', () => {
    expect(getCanonicalMemberPrerequisiteBlock({
      ...eligible,
      member_context_required_action: 'verify_phone',
    }, { now })).toMatchObject({
      reason: 'unknown_member_hub_action',
      requiredAction: 'verify_phone',
      requiredActionUrl: 'https://member.newlife.org.tw/member/continue',
    });
  });
});
