# bible-backend — Design Spec

**Date:** 2026-07-05
**Status:** Draft for review
**Home:** temporarily in the `bible-app` (frontend) repo; seeds the new `NLC-Ministry/bible-backend` repo when scaffolded.

## Purpose

Replace the Bible app's Supabase-direct-from-browser backend (edge-function `nlc-data` shim + RLS) with an **independent, reliable API service** on **Railway Postgres**, consuming NLC **Member Hub** (`mms-core`) for identity/org. Retires the original Supabase prod after cutover.

## Scope & decomposition

This is **three sequenced sub-projects**; each ships independently:

1. **(this spec) The backend service** — Hono API, Drizzle schema on Railway PG, auth, membership-state model, domain endpoints.
2. **Frontend data-layer rewrite** (in `bible-app`) — replace the Supabase client/shim with a typed API client; implement the onboarding router. *Own spec/plan.*
3. **Migration tooling + cutover** — Supabase→Railway data migration + the rehearsed flip. *Own spec/plan.*

## Ecosystem context (division of labor)

- **Logto** — identity (account: email/phone/password/social; Account Center).
- **Member Hub (`mms-core`)** — membership: onboarding form, **organizational placement**, **pastor approval**. Source of truth for member/org.
- **bible-backend (this)** — owns Bible-domain data; **consumes** an approved membership; never defines placement or approves anyone.

## Membership lifecycle & onboarding funnel

The Bible app is an acquisition channel, but membership + approval belong to Member Hub. The projection stores the **raw** signals from Member Hub (`membership_status`, `onboarding_complete`, `has_org_placement`); the backend computes a single **`membership_state`** enum from them — used everywhere below:

| State | Meaning | Bible-app access |
|---|---|---|
| `anonymous` | not logged in | welcome + (optionally) public scripture |
| `authenticated_no_membership` | has Logto `sub`, no Member Hub onboarding | routed to Member Hub onboarding |
| `pending_approval` | onboarding submitted, awaiting pastor | "pending" holding screen; scripture reading only |
| `approved` | identity + org placement confirmed | full app (plans, logs, leaderboards, group stats) |

**Funnel (Member-Hub-first):** the Bible welcome shows two doors —
- **首次加入 / Get started** → deep-link to Member Hub onboarding with `return_to=<bible-app-url>`; Member Hub owns Logto signup + org form + approval, then returns the user.
- **登入 / Login** → Logto authorize (returning users).

After auth, the SPA calls `POST /auth/session`; the backend classifies state from Member Hub signals and the SPA routes on it (redirect to onboarding / show pending / full app).

**Cross-repo dependency (must confirm/build in `mms-core`):** an onboarding **entry URL that accepts `return_to`** and round-trips the user back. Member Hub already exposes the *status* signals used here — `/api/member/onboarding-status`, `/api/member/application-status`, and `membershipStatus` on `/api/me/context`.

## Stack

- **Hono** (TypeScript) — lean API framework; Railway deploy.
- **Drizzle ORM** — typed schema + migrations on **Railway Postgres**.
- **jose** — Logto JWT validation via JWKS (shared approach with mms-core).
- **zod** — request/response validation. **Vitest** — tests.

## Architecture / request flows

**Login-sync (`POST /auth/session`)**
1. SPA does Logto PKCE (or returns from Member Hub onboarding), obtains an access token (JWT; the app requests a `resource`, so tokens are JWTs), posts it.
2. Backend validates the JWT: JWKS signature, `iss`, `aud`, `exp`, required scope.
3. Backend calls Member Hub `/api/me/context` (+ `/api/me/org-placement`) with the token; reads profile, org placement, and membership/onboarding status.
4. Backend **upserts the member projection** (reusing the already-hardened `resolveSyncedRole` + org-parsing logic from the security PR) and computes `membership_state`.
5. Returns `{ profile, membership_state }`.

**Data requests** — SPA sends `Authorization: Bearer <token>`; Hono auth middleware validates the JWT, resolves the local `member_profiles` row by `sub`, and attaches `{ profileId, role, membershipState }` to the request. Domain routes query Railway PG via Drizzle. **No shim, no dual-client, no RLS.**

## Data model (Drizzle)

**Owned (authoritative):**
- `reading_plans`, `reading_logs`, `devotional_notes`, `global_plans`, `church_announcements`, `verse_likes`, `badges`/gamification.
- `devotional_notes` carries an **`is_shared boolean not null default false`** (the private/shared split decision): private by default; group members may read only `is_shared = true` rows.

**Projection (Member Hub = source of truth; login-synced):**
- `member_profiles` — `id`, `nlc_member_id` (unique), `name`, `role`, `great_region`/`pastoral_zone`/`small_group`, **`membership_status`**, **`onboarding_complete`**, **`has_org_placement`**, `last_synced_at`.
- `great_regions`, `pastoral_zones`, `small_groups` — for leaderboard/group JOINs.

## API surface (REST, zod-validated)

`POST /auth/session` (login-sync), `GET /me`, `GET/POST /plans`, `POST /logs`, `GET/PUT /devotional` (+ share toggle), `GET /announcements` (+ admin write), `GET /stats/leaderboard?scope=group|zone|region`, admin/global-plan routes, `GET /health`.

## Authorization (replaces RLS, in code)

Three layers in middleware/query builders:
1. **Ownership** — every personal query scoped to the caller's `profileId`.
2. **Role gate** — group/zone/region stats + admin routes gated by role (the `PRIVILEGED_ROLES` model from `nlc-account-link.mjs`).
3. **Membership gate** — member features (join plans, appear on leaderboards, group stats) require `membership_state = approved`. Scripture reading is open to any authenticated user (pending included).
4. **Devotional split** — group reads filter `is_shared = true`; owners see all their own.

## Migration & cutover (rehearsed big-bang flip)

1. Stand up Drizzle schema on Railway.
2. One-time export/transform from Supabase → load into Railway.
3. **Dry-run + verify** (row counts, spot-checks) against a preview backend.
4. Low-traffic window: final sync → deploy the rewritten SPA pointing at the backend.
5. Keep Supabase **read-only as rollback**; retire after a soak.

## Testing / CI

Vitest units — JWKS validation, authz scoping (ownership/role/membership/devotional-split), projection sync + state classification, plan-schedule/streak/stats logic. Integration against an ephemeral Postgres. Migration-verification script. GitHub Actions + Railway deploy; health check gate.

## Out of scope (own specs)

Frontend onboarding-router + API-client rewrite (sub-project 2); migration tooling + cutover execution (sub-project 3); the BFF session upgrade (deferred — stateless bearer now).

## Open dependencies / risks

- **Member Hub `return_to` onboarding round-trip** — confirm it exists in `mms-core` or build it. Hard dependency for the funnel.
- **Approval webhook (future):** currently state refreshes on next login; a Member Hub→bible-backend webhook on approval would make the pending→approved transition instant (deferred, pairs with the projection+webhooks upgrade).
- **Token `aud`/scope contract** — the backend enforces audience; confirm the Logto app's resource/scopes match.
