# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreement — discuss first, open an issue, then wait (read before any change)

The maintainer's standing rule (2026-09-29): 「每次都要跟我討論完，之後也只先開 issue」. For every new request — feature, bug fix, or behavior change, however small it looks:

1. **Discuss first.** Investigate (read code, find the root cause), then report back in chat: what you found, the proposed approach, which files/migrations it touches, and any open decisions. Do **not** edit code, write migrations, or change data yet.
2. **Then only open a GitHub issue** (`gh issue create`) capturing the agreed plan, and stop there. The issue is the deliverable of that turn.
3. **Implement only after the maintainer explicitly says to** (e.g. 「做吧」「開始改」). Reference the issue number in the commit/branch (the repo convention is `(#123)` in the commit subject).

A detailed request is not permission to implement. If a request is ambiguous about whether it's asking for discussion or implementation, treat it as discussion.

## What this is

新生命聖經速讀計畫 (NewLife Bible Speed Reading) — a Traditional-Chinese PWA for a church's quarterly Bible-reading challenges: reading tracker, plans, personal/group statistics, leaderboards, gamification badges, and devotional notes. It is a **satellite app** of the NewLife Member Hub and integrates with the NLC (紟道) ecosystem SSO.

Stack: **vanilla JS, HTML, and CSS for all the main tabs — no framework, no bundler for app code in dev** (the production build runs a real `esbuild --bundle --minify` pipeline via `scripts/bundle.mjs`, not just hashing — see [Commands](#commands)). One deliberate exception: the issue-report feature (`components/issue-report/*.tsx`, mounted via React's `createRoot` from `js/modules/issue-report-ui.js`) is a real React + TypeScript island, bundled as its own separate lazy chunk (`issue-report-ui.bundle.js`) — "no framework" does not apply to that corner of the codebase. Third-party libs: Supabase JS loads from a CDN `<script>` in `index.html`; Chart.js and html2canvas are each lazy-loaded from CDN on demand by the module that needs them (`plan.js`, `home.js`) rather than declared upfront. Icons are **Lucide**, compiled at build time into `js/design/icon-registry.js` by `scripts/generate-icon-registry.mjs`. Backend is Supabase (Postgres + Edge Functions). Hosted on Vercel.

## Commands

```bash
npm run build             # generate-icon-registry.mjs → build-config.js → bundle.mjs — full pipeline, not just config.js
npm run dev                # npx serve . — also `npm start` (see caveat below, this does not fully work as-is)
npm test                    # vitest run — ~160 files / ~1,300 cases
npm run test:watch          # vitest, watch mode
```

There is **no linter**, but there **is** a real, actively-maintained `vitest` suite (jsdom, plus a handful of React Testing Library component tests under `components/`/`lib/`/`tests/`) — run `npm test` before calling a change done. Don't rely on `node --check` as a substitute: it only validates syntax, so it will not catch e.g. a leftover reference to a variable whose declaration got deleted in a refactor (that class of bug has caused a production incident before — see `feedback_refactor_verify_runtime_not_just_syntax` in project memory).

`npm run build` is **not** just `config.js` regeneration — it runs three scripts in order: `scripts/generate-icon-registry.mjs` (compiles the Lucide icon manifest into `js/design/icon-registry.js`), `build-config.js` (regenerates `config.js` from `.env`), then `scripts/bundle.mjs` (runs `esbuild --bundle --minify --target=es2020` per entry point — `app.js`, `exam-entry.js`, `grade-entry.js` — content-hashes the output, e.g. `app.b294a7e2.js`, and rewrites `index.html`/`exam.html`/`grade.html` to reference the hashed files), all into a git-ignored `dist/`. **On Vercel, `buildCommand` is `npm run build` and `outputDirectory` is `dist`** — production serves this hashed `esbuild` bundle, not the raw repo root as-is.

**`npm run dev` (`npx serve .`) does not correctly load the app as it currently stands**: `js/app.js` does `import '../lib/services/badge-service.ts'` directly, and a plain static file server serves that `.ts` file to the browser unmodified instead of stripping the TypeScript — only `esbuild` (inside `npm run build`) does that transform. To check a change in an actual browser, either run `npm run build && npx serve dist` and open that, or verify the specific behavior via a `vitest` test instead of the raw dev server.

### Config generation (important)

`config.js` is **git-ignored and generated** by `build-config.js` from `.env` (copy `.env.example` → `.env`). Never edit `config.js` by hand — it is overwritten on every build. It exposes two globals to the frontend: `SUPABASE_CONFIG` (`url`, `anonKey`) and `NLC_CONFIG` (`clientId`, `issuer`, `memberHubUrl`, `scopes`).

## Cache-busting and updates (read before editing JS/CSS or caching)

Church members run this as an installed mobile PWA that can sit in the background for days, so "users stuck on an old build" is the failure mode everything here is designed against. **There are no hand-maintained version strings anymore** — don't add `?v=` to imports, `<script>`, or `<link>` tags (`scripts/no-manual-cache-bust.test.mjs` fails if you do; `?v=` on images under `assets/` is fine, those aren't hashed).

- JS/CSS reach production only through `scripts/bundle.mjs`: the entry (`app.<hash>.js`), stylesheet (`index.<hash>.css`), and exam/grade entries are content-hashed and served `immutable`.
- The lazy tab modules (`home.js`, `bible.js`, `plan.js`, `admin.js`, `profile.js`, `team-registration.js`, `campaign-rule-editor.js`, `onboarding-helper.js`, and the React `issue-report-ui.js` island) are listed as literal `import()`s in `LAZY_MODULE_LOADERS` in `js/app.js`, and `scripts/bundle.mjs` builds `app.js` with `esbuild --splitting` so each becomes a **content-hashed chunk** under `dist/chunks/` (served `immutable`). **Nothing to bump by hand**: a changed module gets a new filename, and a tab left open across a deploy keeps loading its own build's chunks instead of mixing new module code into old in-memory `db`/`state`. If an old chunk is already gone (404 after a deploy), `loadModule` hands off to `js/pwa/VersionWatcher.js`, which reloads into the new build. To add a lazy module, add a literal `import()` entry to `LAZY_MODULE_LOADERS` — a computed path (`import(path)`) can't be split and will break the production build. `js/app.js`'s `"__BUILD_VERSION__"` placeholder is replaced with the build timestamp, which is also written to `dist/version.json`; `VersionWatcher` compares the two on launch/foreground to detect and reload a stale build.
- **Detecting a stale build**: `js/pwa/VersionWatcher.js` compares the running build id with `/version.json` on launch, on return to foreground (≤ 1 probe / 5 min), when a new SW takes control, when a chunk fails to load, and from 個人設定 → 檢查更新. No polling while the app is closed/backgrounded. Newer build found → reload once at a safe moment; if the reload still lands on the old build → `/repair` once; sessionStorage guards make both one-shot so it can't loop.
- **Not a safe moment** (typing, TTS playing, unsynced offline queue) → `js/pwa/UpdateBanner.js` shows a non-blocking 「有新版本」 banner instead; the user's tap updates immediately.
- **Breaking backend change** (RPC renamed, column dropped — anything an old frontend would break on): set `forceUpdateBuiltBefore` in `release-policy.json` to the deploy time **with a timezone** (e.g. `2026-09-23T13:00:00+08:00`) and **commit it in the same release as the migration** — the build reads only the committed file (Vercel builds from git; there is no env override), so a value that isn't committed never takes effect. Every older build then reloads immediately regardless of safety. The build fails on a missing timezone or a cutoff later than the build itself, and `scripts/bundle.test.mjs` enforces the same rule on the committed file. Keep it `null` otherwise; an old past cutoff is harmless (every newer build is already past it), so resetting it to `null` in a later release is optional. Only use it when something an old build calls in normal use would break — admin-only breakage that a page refresh fixes doesn't need it, since `VersionWatcher` updates at the next safe moment anyway.
- `/repair` (`repair.html`) only unregisters the SW and clears app caches — never login tokens or reading progress. It's reached from VersionWatcher's last-resort escalation, the second tap of 檢查更新, the login gate's 「更新至最新版」, and the CSS-load-failure overlay. Login failures do **not** route through it (that old 「修復並重新登入」 detour fired on routine session expiry and was removed).
- `sw.js` is a thin, module-based Service Worker. It delegates cache behavior to `js/pwa/CacheManager.js`; never put business logic directly in lifecycle handlers.
- Cache only same-origin static assets and public Bible API responses. Authentication, Supabase/NLC, rankings, member data, and admin data must bypass Service Worker caching.
- Authenticated reading-log writes may be queued in IndexedDB by `PwaCoordinator`; credentials are never persisted in the queue. Background Sync asks an open authenticated client to flush the queue.
- `vercel.json` must keep `/`, `/index.html`, and `/sw.js` non-immutable. Hashed app bundles and versioned runtime modules may use immutable caching.
- See `docs/pwa-architecture.md` before changing caching or offline synchronization.
## Architecture

### Entry points and script loading (hybrid: legacy globals + real ES modules)

There are **four separate static HTML entry points**, each bootstrapping its own single `<script type="module">` — there is no `main.js`:
- `index.html` → `js/app.js` (the main SPA: all tabs, PWA/offline, onboarding).
- `exam.html` → `js/exam-entry.js` → mounts `js/modules/exam.js` (`mountExamRunner`).
- `grade.html` → `js/grade-entry.js` → mounts `js/modules/grading.js` (`mountGradingWorkspace`).
- `repair.html` — static cache-recovery fallback page (see `window.showAppStyleRecovery` in `index.html`).

Each entry script starts with a fixed, order-dependent chain of plain side-effect `import './x.js'` statements for the shared "core" files: `config.js` → `data/bible_data.js` → `data/bible_verse_counts.js` → `copy/zh-Hant.js` → `data/church_campaign.js` → `design/design-tokens.js` → `design/design-system-helpers.js` → `design/icon-registry.js` → `design/icons.js` → `state.js` → `auth.js` (+ `auth-launch.mjs`) → `db.js` → `utils.js` → `gamification.js`. This is real ES module syntax now (`type="module"`, `import`), **not** separate `<script>` tags — but `state.js`/`db.js`/`auth.js`/`utils.js`/`gamification.js` are still written pre-ESM style: they attach their API to `window` (`window.state = state`, `window.db = db`, …) instead of exporting it, and every consumer — including modules loaded much later — reads them back as bare identifiers (`state.activePlan`, `db.foo()`) or via `typeof fn === "function"` guards. This works because a module's unresolved free variables still fall through to the shared global object, same as a classic script. **The load order above is still load-bearing**: these files run once, in sequence, to populate that shared surface, and later code assumes it's already there.

Everything built more recently (`js/modules/*.mjs`, `js/data/*.mjs`, `js/pwa/*.js`) is a real ES module with proper named `export`/`import` and no `window` involved — prefer this style for new cross-file logic instead of adding another `window.foo`.

Tab views are **not** loaded eagerly at boot. `js/app.js` lazy-loads `js/modules/home.js`, `bible.js`, `plan.js`, `admin.js`, `profile.js`, `team-registration.js` on first use via an internal `loadModule(name)` helper (names map to literal `import()`s in `LAZY_MODULE_LOADERS`) — dynamic `import()`, retried on failure, cached in `moduleCache`, then calls the module's exported `init()`. (There is no `js/views/` directory — view/tab controllers live in `js/modules/`.) In production each is a content-hashed chunk (see [Cache-busting and updates](#cache-busting-and-updates-read-before-editing-jscss-or-caching)), fetched only when the user first opens that tab.

### Central state

`js/state.js` defines a single global `state` object (current user, org structure, active plans, reading logs, reader state, highlights, chart instances, admin filters) plus:
- `CHURCH_PLAN_PRESETS` — the hardcoded quarterly plan definitions (books + monthly breakdown for 2026–2027).
- `appRouter` — tab/view switcher (`switchTab`, `goBack`, `updateNavigationChrome`). Views are `.view-pane` sections toggled by `.active`; there is no URL routing.
- Theme management (light/dark/warm) persisted to `localStorage`.
- `escapeHTML()` — use this for any user-supplied string rendered into innerHTML.

### Data layer — the dual-client shim (`js/db.js`, ~6,100 lines)

`db.js` is the entire data-access layer (grown well past its original size — budget accordingly when estimating changes here). The key design: `state.supabase` is **either** a real Supabase client **or** an `NlcDataClient` shim, chosen at runtime by login method. Both expose the same `.from(table).select().eq()...` chainable API so callers don't care which is active:

- **Google/email login (dev/localhost only):** real `@supabase/supabase-js` client, RLS-enforced.
- **NLC Logto SSO (production):** `createNlcDataClient()` returns a shim whose `NlcQueryBuilder` serializes queries to JSON and POSTs them to the `nlc-data` Edge Function, which verifies the Logto token and uses the service role. This exists because the app uses **church Logto auth, not Supabase Auth**, so RLS can't see a Supabase JWT.

When adding data access, use the `state.supabase.from(...)` builder so it works in both modes. Note the shim only implements a subset of PostgREST (`select/insert/update/delete/upsert/eq/is/in/or/order/limit/single/maybeSingle`) — a query chain that works against the real client in dev can silently misbehave through the shim in production; there's no automated check that the two stay behaviorally equivalent.

### Auth (`js/auth.js`)

Logto OIDC + PKCE client for NLC SSO. Does discovery on `issuer`, handles the redirect callback, stores tokens in `localStorage` (`nlc_*` keys), and exchanges the Logto token for a Supabase profile via the `nlc-session` Edge Function. `auth.getValidAccessToken()` transparently refreshes; `db.js` retries once on 401.

### Bible text (`js/data/bible_data.js`)

Chapter text is fetched live from public Bible APIs (bible-api.com, bolls.life) with `assertCompleteEnough()` validation (must be Chinese, not truncated to 10 verses) and a small hardcoded `BIBLE_FALLBACK` for offline/failure. `bible_verse_counts.js` holds per-chapter verse counts. `CHURCH_PLAN_PRESETS` book names are Traditional Chinese; `BOLLS_BOOK_CODES` maps English names to API codes.

### Tab modules (`js/modules/`, lazy-loaded — see above)

- `home.js` — dashboard tab: verse of the day, announcements, devotional highlights.
- `bible.js` — immersive Bible reader: highlights, TTS, font/version controls.
- `plan.js` (**~10,300 lines** — by far the largest file in the app) — plan list, plan detail, daily task checklists, admin plan CRUD, inline reader, **and** the Chart.js personal/group/admin stats & leaderboard dashboards (there is no separate `stats.js`; it's all in here).
- `admin.js` (~4,300 lines) — admin user/org management, most of "系統管理".
- `profile.js` — account settings, badge wall.
- `team-registration.js` — team join/switch flows.
- `exam.js` / `grading.js` — mounted from the standalone `exam.html` / `grade.html` entry points, not from `app.js`.

## Backend (`supabase/`)

- **Active schema:** `supabase/migrations/` starting at `0001_clean_schema.sql`, now past **180+ migrations**. Core tables: `profiles` (stable user record), `user_identities` (links login methods → one profile), `reading_plans`, `reading_logs`, `devotional_notes`, `global_plans`, `church_announcements`, and org tables (`great_regions`, `pastoral_zones`, `small_groups`). RLS resolves the caller via `current_profile_id()`. This list is **not exhaustive** — three substantial feature areas each have their own table cluster that predates none of this doc's other sections but has never been added here either: reading teams (`reading_teams`, `reading_team_members`), the exam/大測驗 system (`exam_papers`, `exam_attempts`, `exam_grading_assignments`), and the issue-report conversation threads (`issue_reports`, `issue_report_messages`).
- **Branch workflow (since 2026-09-27): work on `staging`, release via a reviewed PR.** Commit day-to-day changes to the `staging` branch (it deploys to https://bible-speed-reading-staging.vercel.app against the staging database); never force-push it, and never push to `main` directly. Larger features go on a short-lived branch off `staging`. To release, open a PR `staging` → `main` (template: `.github/pull_request_template.md`, written as plain "open this page → you should see this" steps for a non-technical reviewer). **The maintainer merging that PR is the approval** — they check the staging site first; never merge a release PR yourself. `release-gate` checks the source is `staging`/`hotfix/*` and includes every non-merge commit on `main`, and `ci.yml`'s deploy job refuses to deploy a `main` commit that didn't come from a merged PR from `staging` or `hotfix/*`. Merge with a merge commit, not squash. Production hotfixes: `hotfix/*` off `main` → PR to `main` → then merge `main` back into `staging`. See `docs/staging.md`.
- **Two environments, CLI-managed migrations.** Production is `ztozevcqkfrohgjmngcj`; staging is a Supabase branch, `dbtjsljrytzonjvclgrd` (see `docs/staging.md`). Since 2026-09-25 migrations are applied with the Supabase CLI instead of being pasted into the SQL Editor: `0001`–`0214` are marked applied in both projects' `supabase_migrations.schema_migrations`, and `20260925071804_branch_baseline.sql` is a no-op placeholder for the version Supabase wrote when the branch was created. **New migrations must use a timestamp name** — create them with `npx supabase migration new <name>`; a new `0215_…` file is rejected by `db push` ("inserted before the last migration on remote") and by `scripts/migration-naming.test.mjs`. Apply to staging, verify, then production, always with an explicit `--project-ref` (never rely on `supabase link`):
  ```bash
  npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd --dry-run   # staging: check what will run
  npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd
  npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj --dry-run   # then production
  npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj
  node scripts/compare-env-snapshots.mjs --run                                 # both environments still match
  ```
  Never pass `--include-all` to production. The CLI doesn't know about ordering requirements written in a migration's header (e.g. "set Vault `project_url` first" in `0212`) — read the header before pushing.
- `supabase/migrations_legacy/` — old test-period migrations, kept for reference only. Do not replay on a fresh project. (There's also a single stray file under `supabase/migrations/legacy/` — a one-off migration deliberately pulled out of the active numbered sequence; unrelated to `migrations_legacy/` despite the name.)
- **Edge Functions** (`supabase/functions/`): six total, not two.
  - `nlc-session` (verifies Logto token, upserts profile/identity with service role) and `nlc-data` (per-request Logto verification + server-side table/action allowlist, then service-role DB access) — the two the app calls directly from the client. **Until 2026-09-24 neither actually verified JWT signatures** (they only base64-decoded the payload, and `nlc-session` linked accounts by email from an unverified `id_token`). Both now embed an identical `logto-jwt-verify` block (JWKS signature + `iss` + `exp`), rolled out via `NLC_JWT_VERIFY_MODE` (`report` → `enforce`) — see `supabase/functions/README.md`. Never trust a decoded-but-unverified token claim for identity again; `scripts/logto-jwt-verify.test.mjs` guards this.
  - `issue-report-maintenance` — auto-closes issue-report threads 14 days after an admin reply with no response, purges threads closed 180+ days plus orphaned screenshots. Guarded by a shared-secret header (`x-maintenance-secret`), not a Logto/Supabase token. From creation (`0153`) until 2026-09-16 this had **no SQL-visible schedule at all** — its own header comment claimed a Dashboard-only "Supabase Scheduled Function" that couldn't be confirmed to exist. `0184_schedule_issue_report_maintenance.sql` fixed that with the same `pg_cron` + `pg_net` pattern as `sync-devotion-video`/`generate-daily-quizzes`, split into two jobs: `issue-report-maintenance-daily-autoclose` (daily, autoclose only, non-destructive) and `issue-report-maintenance-weekly-purge` (weekly, adds `purge: true` — actually deletes old messages/screenshots, so it's deliberately less frequent). Needs its own Vault secret, `issue_report_maintenance_cron_secret`, matching the Edge Function's `ISSUE_REPORT_MAINTENANCE_SECRET`. Deployed and manually verified working 2026-09-16 (`SELECT public.invoke_issue_report_maintenance(FALSE);` → `net._http_response` returned `200 {"ok":true,"autoclosed":4}` — 4 stale threads got closed on the very first real run, confirming this genuinely had never executed before).
  - `issue-report-sheet-sync` — fires on a Database Webhook when a row is inserted into `issue_reports`; forwards only 4 non-personal fields to a Google Apps Script Web App for the triage spreadsheet (deliberately excludes `user_id`, `url`, `user_agent`, `metadata`, the report id).
  - `generate-daily-quizzes` — generates the daily church quiz question(s) from the Bible book/chapter data.
  - `sync-devotion-video` — syncs devotion video content on a schedule, gated by its own `x-cron-secret` header.
  - All six have `verify_jwt = false` in `supabase/config.toml` because their real bearer is a Logto token or a custom shared secret, not a Supabase JWT. `sync-devotion-video` was missing this entry until 2026-09-16: the pg_cron caller (`invoke_devotion_video_sync()` in `0155_devotion_video_sync.sql`) never sent an `Authorization` header at all, only `x-cron-secret`, so the gateway's default `verify_jwt = true` silently 401'd every invocation before the function's own secret check ever ran — confirmed by `devotion_video_sync_log` having zero rows for weeks. Fixed by turning the toggle off in the Dashboard **and** adding the matching entry here (Dashboard-only would drift back to `true` on the next CLI deploy that doesn't know about it). If a *new* Edge Function's cron/webhook caller doesn't send an `Authorization` header, add its `verify_jwt = false` entry here in the same change, not after the fact. See `supabase/functions/README.md` for required secrets.
- The `profiles`/`user_identities` split is intentional: it prevents data loss when a user switches login method (e.g. Google → NLC Logto). First admin is promoted manually via SQL (see `supabase/README_clean_setup.md`).
- **New SQL functions default to PUBLIC-executable — revoke explicitly in the same migration, every time.** Postgres grants `EXECUTE` on every newly created function to the `PUBLIC` pseudo-role by default, and `anon` inherits it *transitively* through that — `REVOKE EXECUTE ... FROM anon` alone is a no-op against a `PUBLIC` grant. This exact gap let ~29 functions stay silently anon-callable through two cleanup attempts (`0173`, `0177`) before a third, broader sweep (`0182_revoke_public_function_execute_sweep3.sql`) finally caught them by checking `has_function_privilege('anon', ..., 'EXECUTE')` instead of trusting a role-specific grant list. Don't rely on the next periodic sweep to catch it again — every `CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION` in a new migration must be followed immediately by an explicit grant:
  ```sql
  CREATE OR REPLACE FUNCTION public.some_new_fn(...) ... AS $$ ... $$;
  REVOKE ALL ON FUNCTION public.some_new_fn(...) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.some_new_fn(...) TO authenticated, service_role; -- drop authenticated (service_role only) if it must never be called directly by a client
  ```
  **`FROM PUBLIC` alone is not enough.** Supabase's default privileges (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role`) grant every new function **directly** to `anon` and `authenticated`, which a PUBLIC revoke doesn't touch. That let `schedule_announcement` — no caller check, so anyone with the public anon key could post a published announcement to every member — become anon-callable **twice**: `0187` fixed the 5-arg version, then `0195` added a 7-arg overload that picked the direct grant up again. `0214_revoke_anon_function_execute.sql` revoked all 24 anon-executable functions and changed the default privileges so new functions are granted to `service_role` only; it ends with a check that fails if any `public` function is still anon-executable. Grant `authenticated` explicitly when a function needs it — including any function an RLS policy `TO authenticated` calls (e.g. `profile_matches_announcement_scope`). Verify with `has_function_privilege('anon', p.oid, 'EXECUTE')`, never by reading the grant statements.
  If the function is `SECURITY DEFINER` and performs a privileged mutation (i.e. it bypasses RLS), do **not** grant `authenticated` unless the function is genuinely meant to be invoked directly by the client — granting `authenticated` on a `SECURITY DEFINER` function that expects to only ever be reached through `nlc-data`'s allowlist/`applyForcedScope` is exactly the "direct RPC bypass" vulnerability shape already fixed more than once (`d317a12`, `485679a`, `bc09eff`). Default to `service_role`-only for those.

## Design system

See `docs/design-system.md`. Satellite brand color is **`#04A9D2`** (`--color-brand`; legacy alias `--primary-color`). Rules: no gradient fills on UI chrome (flat colors only), content-first calm reader, three themes (light/dark/warm-sepia). Typography uses **medium (500)** for emphasis and **normal (400)** for body — avoid 600–900 weights on chrome. Neutral shadows only, no brand-tinted glows. Icons are **Lucide** via `data-icon` / `renderIcon()`; prefer these over emoji. UI copy is Traditional Chinese (see `js/copy/zh-Hant.js`).

---

## 💡 Key Architectural Guidelines & Anti-Bug Patterns

Detailed Skill Documentation is persisted at `.agents/skills/bible-study-dev-guidelines/SKILL.md`.

1. **Security & Forced Scope**:
   - Edge Functions (`nlc-data`) and RPC functions must enforce explicit `user_id` and `plan_id` filtering (`applyForcedScope`) on writes/deletes to prevent accidental cross-tenant data mutation.
   - Every new SQL function must explicitly `REVOKE ALL ... FROM PUBLIC, anon, authenticated` in the same migration it's created in, then `GRANT` only the roles it needs — see the "New SQL functions default to PUBLIC-executable" rule under [Backend](#backend-supabase). Don't wait for the next Security Advisor sweep to catch it.

2. **Scroll State Preservation**:
   - When re-rendering container DOM (`innerHTML = ""`, e.g. `renderHorizontalDateStrip`), read `.scrollTop`/`.scrollLeft` beforehand and restore immediately after DOM update to prevent layout jumps.

3. **Async Race-Condition & Session Counter**:
   - `speechSynthesis.cancel()` triggers ghost `onend`/`onerror` events asynchronously.
   - Use a global `currentAudioSessionId` counter. In all async callbacks, check `if (sessionId !== currentAudioSessionId) return;` to instantly kill stale events.

4. **Natural Neural TTS Voice Selection**:
   - Prefer voices containing `Natural`, `Neural`, `Online`, `Ting-Ting`, `Samantha`, `HsiaoChen`, `YunJhe`.
   - Automatically match voice language: `zh-TW` for Chinese versions (`CUNP`, `RCUV`, `CUV`) and `en-US`/`en-GB` for English versions (`ESV`, `NIV`, `NLT`).

5. **User-Centric UI/UX Controls**:
   - Use Picker Modals (`#bible-version-picker-modal`) with clear checkmarks instead of single-button infinite loops when options > 3.
   - Keep bottom-of-page auto-read tracking silent without intrusive toast/modal subtitles.
   - Mutate memory state (`ch.isRead`, `ch.isReadR1`) synchronously upon log updates and recalculate plan progress on returning to plan view for instant reactivity without page reloads.
