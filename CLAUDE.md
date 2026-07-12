# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

新生命聖經速讀計畫 (NewLife Bible Speed Reading) — a Traditional-Chinese PWA for a church's quarterly Bible-reading challenges: reading tracker, plans, personal/group statistics, leaderboards, gamification badges, and devotional notes. It is a **satellite app** of the NewLife Member Hub and integrates with the NLC (紟道) ecosystem SSO.

Stack: **vanilla JS, HTML, and CSS — no framework, no bundler for app code** (production uses `scripts/bundle.mjs` to hash JS/CSS). Third-party libs (Supabase JS, Chart.js, html2canvas) load from CDN in `index.html`. Icons are **Lucide**, built at compile time into `js/icon-registry.js`. Backend is Supabase (Postgres + Edge Functions). Hosted on Vercel.

## Commands

```bash
npm run build      # node build-config.js — regenerates config.js from .env (REQUIRED after cloning)
npm run dev        # npx serve . — local static server (also `npm start`)
```

There are **no tests, no linter, and no compile step**. "Building" only means regenerating `config.js`. On Vercel, `buildCommand` is `node build-config.js` and `outputDirectory` is `.` (the repo root is served as-is).

### Config generation (important)

`config.js` is **git-ignored and generated** by `build-config.js` from `.env` (copy `.env.example` → `.env`). Never edit `config.js` by hand — it is overwritten on every build. It exposes two globals to the frontend: `SUPABASE_CONFIG` (`url`, `anonKey`) and `NLC_CONFIG` (`clientId`, `issuer`, `memberHubUrl`, `scopes`).

## Cache-busting (critical — read before editing JS/CSS)

The app aggressively fights stale caches because church members run it on mobile PWAs:

- Every `<script>`/`<link>` in `index.html` has a `?v=YYYYMMDD_...` query string. **When you change a JS or CSS file, bump its version string in `index.html`** or clients may load an old file.
- `sw.js` is a thin, module-based Service Worker. It delegates cache behavior to `js/pwa/CacheManager.js`; never put business logic directly in lifecycle handlers.
- Cache only same-origin static assets and public Bible API responses. Authentication, Supabase/NLC, rankings, member data, and admin data must bypass Service Worker caching.
- Authenticated reading-log writes may be queued in IndexedDB by `PwaCoordinator`; credentials are never persisted in the queue. Background Sync asks an open authenticated client to flush the queue.
- `vercel.json` must keep `/`, `/index.html`, and `/sw.js` non-immutable. Hashed app bundles and versioned runtime modules may use immutable caching.
- See `docs/pwa-architecture.md` before changing caching or offline synchronization.
## Architecture

### Script load order (globals, not modules)

All JS is plain `<script>` tags sharing globals via `window` — **there are no ES module imports**. Load order in `index.html` matters and is deliberate: `config.js` → `bible_data.js` → `bible_verse_counts.js` → `zh-Hant.js` → `design-tokens.js` → `state.js` → `auth.js` → `plan.js` → `db.js` → `utils.js` → `gamification.js` → view files (`dashboard`, `reader`, `stats`, `profile`) → `main.js`. Functions are called across files via `typeof fn === "function"` guards.

### Central state

`js/state.js` defines a single global `state` object (current user, org structure, active plans, reading logs, reader state, highlights, chart instances, admin filters) plus:
- `CHURCH_PLAN_PRESETS` — the hardcoded quarterly plan definitions (books + monthly breakdown for 2026–2027).
- `appRouter` — tab/view switcher (`switchTab`, `goBack`, `updateNavigationChrome`). Views are `.view-pane` sections toggled by `.active`; there is no URL routing.
- Theme management (light/dark/warm) persisted to `localStorage`.
- `escapeHTML()` — use this for any user-supplied string rendered into innerHTML.

### Data layer — the dual-client shim (`js/db.js`)

`db.js` (~2000 lines) is the entire data-access layer. The key design: `state.supabase` is **either** a real Supabase client **or** an `NlcDataClient` shim, chosen at runtime by login method. Both expose the same `.from(table).select().eq()...` chainable API so callers don't care which is active:

- **Google/email login (dev/localhost only):** real `@supabase/supabase-js` client, RLS-enforced.
- **NLC Logto SSO (production):** `createNlcDataClient()` returns a shim whose `NlcQueryBuilder` serializes queries to JSON and POSTs them to the `nlc-data` Edge Function, which verifies the Logto token and uses the service role. This exists because the app uses **church Logto auth, not Supabase Auth**, so RLS can't see a Supabase JWT.

When adding data access, use the `state.supabase.from(...)` builder so it works in both modes. Note the shim only implements a subset of PostgREST (`select/insert/update/delete/upsert/eq/is/in/or/order/limit/single/maybeSingle`).

### Auth (`js/auth.js`)

Logto OIDC + PKCE client for NLC SSO. Does discovery on `issuer`, handles the redirect callback, stores tokens in `localStorage` (`nlc_*` keys), and exchanges the Logto token for a Supabase profile via the `nlc-session` Edge Function. `auth.getValidAccessToken()` transparently refreshes; `db.js` retries once on 401.

### Bible text (`js/data/bible_data.js`)

Chapter text is fetched live from public Bible APIs (bible-api.com, bolls.life) with `assertCompleteEnough()` validation (must be Chinese, not truncated to 10 verses) and a small hardcoded `BIBLE_FALLBACK` for offline/failure. `bible_verse_counts.js` holds per-chapter verse counts. `CHURCH_PLAN_PRESETS` book names are Traditional Chinese; `BOLLS_BOOK_CODES` maps English names to API codes.

### Views (`js/views/`)

Each view file renders one tab and wires its controls: `dashboard.js` (verse of the day, announcements, devotional), `reader.js` (immersive Bible reader, highlights, TTS, font/version controls), `plan.js` (~4500 lines — plan list, plan detail, daily task checklists, admin plan CRUD, inline reader), `stats.js` (Chart.js dashboards, personal + group/admin scopes), `profile.js` (account settings, badge wall, admin user/org management). `main.js` bootstraps everything in `DOMContentLoaded`.

## Backend (`supabase/`)

- **Active schema:** `supabase/migrations/` starting at `0001_clean_schema.sql`. Core tables: `profiles` (stable user record), `user_identities` (links login methods → one profile), `reading_plans`, `reading_logs`, `devotional_notes`, `global_plans`, `church_announcements`, and org tables (`great_regions`, `pastoral_zones`, `small_groups`). RLS resolves the caller via `current_profile_id()`.
- `supabase/migrations_legacy/` — old test-period migrations, kept for reference only. Do not replay on a fresh project.
- **Edge Functions** (`supabase/functions/`): `nlc-session` (verifies Logto token, upserts profile/identity with service role) and `nlc-data` (per-request Logto verification + server-side table/action allowlist, then service-role DB access). Both must have `verify_jwt = false` because the bearer is a Logto token, not a Supabase JWT. See `supabase/functions/README.md` for required secrets.
- The `profiles`/`user_identities` split is intentional: it prevents data loss when a user switches login method (e.g. Google → NLC Logto). First admin is promoted manually via SQL (see `supabase/README_clean_setup.md`).

## Design system

See `docs/design-system.md`. Satellite brand color is **`#04A9D2`** (`--color-brand`; legacy alias `--primary-color`). Rules: no gradient fills on UI chrome (flat colors only), content-first calm reader, three themes (light/dark/warm-sepia). Typography uses **medium (500)** for emphasis and **normal (400)** for body — avoid 600–900 weights on chrome. Neutral shadows only, no brand-tinted glows. Icons are **Lucide** via `data-icon` / `renderIcon()`; prefer these over emoji. UI copy is Traditional Chinese (see `js/copy/zh-Hant.js`).
