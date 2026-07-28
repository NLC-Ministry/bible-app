# Member Context Org Placement UI Design

**Date:** 2026-07-28
**Status:** Approved for implementation planning
**Project:** `bible-app`

## Purpose

Replace the Bible app profile page's misleading local organization UI with a Member Hub-sourced organization placement display. Before the full Bible backend launch, the current Vercel Bible app should keep using Supabase as its local projection store and should synchronize the user's Member Hub context through the existing `nlc-session` Edge Function.

## Product Decision

The temporary path is valid and clean as a migration bridge:

```text
Logto access token
-> Supabase Edge Function nlc-session
-> Member Hub /api/me/context and Platform organization API
-> Supabase profiles projection
-> Bible app profile UI
```

This is not the final architecture. It keeps Member Hub as the authority for membership and org placement while avoiding a premature cutover to `bible-backend`, which does not yet replace the current app's `nlc-data` table/RPC access path.

## User Experience

The profile page will show a read-only "會員中心組織歸屬" section near the existing Member Hub card. It will display exactly these placement labels:

- 大區
- 牧區
- 小組

The section will also show a sync status:

```text
已同步自會員中心：
2026-07-28 15:43
```

The timestamp comes from a dedicated Member Hub context sync column, not from generic profile `updated_at`.

If no placement is available, the section will show the same three labels with an empty-state value such as `尚未設定`, plus guidance to update the user's home placement in Member Hub. The Bible app will not let the user edit Hub-owned organization fields.

The UI keeps two actions:

- Open Member Hub organization management.
- Refresh Member Hub sync by calling `db.syncNlcSessionWithSupabase(true)`.

## Data Model

Add a dedicated projection metadata column to `public.profiles`:

```sql
member_context_synced_at TIMESTAMP WITH TIME ZONE
```

`nlc-session` sets this column to the current timestamp only after it successfully reads and projects the Member Hub context. The UI uses this value for the sync status. The app must not infer the Member Hub sync time from `updated_at`, because unrelated profile edits can change that field.

Existing org projection fields remain the display source:

- `profiles.great_region`
- `profiles.pastoral_zone`
- `profiles.small_group`

The existing `locked_fields` mechanism remains the guard for form editability. When `great_region`, `pastoral_zone`, or `small_group` are locked, the profile form keeps those fields read-only/disabled and directs the user to Member Hub.

## Frontend Behavior

On normal Logto login and app load, the current flow continues:

```text
auth.handleCallback()
-> db.syncNlcSessionWithSupabase(...)
-> state.supabase = db.createNlcDataClient()
-> db.loadUserData()
-> profile UI renders from state.currentUser and profile data
```

The manual refresh action must:

1. Call `db.syncNlcSessionWithSupabase(true)`.
2. Apply the returned profile to `state.currentUser`.
3. Re-render the profile section.
4. Show success only after the sync call succeeds.
5. Leave the last displayed profile untouched if sync fails.

## Error Handling

If Member Hub sync fails, the UI shows a non-blocking error message and keeps the last local projection. The user can still open Member Hub manually.

If the user is not logged in through Logto, the Member Hub placement section should not claim authoritative sync. It may show the three labels from the local profile, but the sync status should state that Member Hub sync is unavailable for the current login method.

If `member_context_synced_at` is missing on an existing row, the UI should show `尚未同步` rather than using `updated_at`.

## Security And Data Ownership

Member Hub owns identity, membership state, and organization placement. Bible app-owned profile editing must not overwrite Hub-owned organization placement for Logto users.

Supabase remains a local projection store for the temporary production app. Service-role writes stay inside the Edge Function. Browser code must not receive service-role credentials or write privileged org fields directly.

## Testing Requirements

Add focused tests for:

- Migration adds `member_context_synced_at`.
- `nlc-session` writes the sync timestamp only in the successful projection payload.
- Profile sync stores and applies `member_context_synced_at`.
- Profile UI renders 大區 / 牧區 / 小組 and sync status.
- Empty placement renders `尚未設定` and Member Hub guidance.
- Manual refresh calls `syncNlcSessionWithSupabase(true)` and handles success/failure.
- Vercel config still exposes required Supabase and NLC settings.

## Out Of Scope

- Replacing `nlc-data` with `bible-backend`.
- Implementing `GET /me` in `bible-backend`.
- Rebuilding the whole profile page.
- Adding staff/admin organization management inside Bible app.
