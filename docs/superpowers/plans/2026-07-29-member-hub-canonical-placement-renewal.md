# Member Hub Canonical Placement Renewal Plan

**Goal:** Keep Bible app free to use its own existing local organization model while consuming Member Hub through the canonical placement contract only. This renewal must not require satellite schema migrations.

## Contract Boundary

Member Hub is the authority for identity, membership state, and the effective organization placement. Bible app must read only:

- `membershipState`
- `hasRequiredPlacement`
- `organization.placementNodeId`
- `organization.placementNodeName`
- `organization.placementLevelName`

Bible app owns any product-specific projection after the response is received. Member Hub must not be asked to shape fields for Bible app, and Bible app must not treat any app-shaped field as Member Hub contract data. The existing Bible app schema remains the target local projection.

## Renewal Path

1. Update `nlc-session` and shared sync helpers so their Member Hub parser accepts only the canonical placement fields listed above.
2. Keep Bible app local storage/UI free to use the current three visible labels (`大區` / `牧區` / `小組`) by deriving them inside Bible app from `placementLevelName` and `placementNodeName`.
3. Do not add required database columns for this renewal. Operational debugging should use existing sync timestamps, Edge Function logs, and the local projection values already present in the profile record.
4. When Member Hub returns a placement level Bible app does not know how to project, clear or preserve the app-specific projection according to the existing stale-data policy, log the unsupported level, and show the user a non-blocking sync warning.
5. Preserve login safety: Member Hub context failures must not break Logto login. They should keep the session usable, record the sync failure, and leave the last successful local projection visible with an accurate sync status.

## Implementation Tasks

- Add tests proving `nlc-session` and `scripts/lib/nlc-profile-sync.mjs` ignore non-contract Member Hub organization keys.
- Replace the parser fallback chain with a canonical-only reader.
- Do not introduce a required Supabase migration for this contract cleanup.
- Update the profile UI refresh tests so the displayed labels are produced from Bible app's local projection after canonical sync.
- Update support logging so failed Member Hub context refreshes are visible without blocking authentication.
- Run the real local Supabase flow after unit tests: login/session sync, manual refresh, stale local data replacement, and Member Hub unavailable behavior.

## Deployment Notes

- No new Member Hub environment variable is needed beyond the existing Member Hub API URL and `member:read.basic` scope.
- Supabase owners deploy the updated Edge Function; no database migration is required for this renewal.
- Vercel deploys after the Edge Function is live so the UI can read the refreshed projection and sync metadata.
