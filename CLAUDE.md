# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It holds **rules only**; background, history, and how things work live in the docs each section points to — read those before changing that area.

## Working agreement — discuss first, open an issue, then wait (read before any change)

The maintainer's standing rule (2026-09-29): 「每次都要跟我討論完，之後也只先開 issue」. For every new request — feature, bug fix, or behavior change, however small it looks:

1. **Discuss first.** Investigate (read code, find the root cause), then report back in chat: what you found, the proposed approach, which files/migrations it touches, and any open decisions. Do **not** edit code, write migrations, or change data yet.
2. **Then only open a GitHub issue** (`gh issue create`) capturing the agreed plan, and stop there. The issue is the deliverable of that turn. End it with the 「給實作 session」 block (format: `issue-brief` skill).
3. **Implement only after the maintainer explicitly says to** (e.g. 「做吧」「開始改」). Reference the issue number in the commit/branch (the repo convention is `(#123)` in the commit subject). Before starting, run the `issue-brief` skill's pre-start check.

A detailed request is not permission to implement. If a request is ambiguous about whether it's asking for discussion or implementation, treat it as discussion.

## Parallel tasks and integration (read before committing, merging, or pushing)

Several Claude sessions work on this repo at once. To keep them out of each other's way and keep merging cheap:

- **Every task gets its own local worktree + branch** `task/<issue>-<slug>` off `origin/staging`. A desktop-app session already runs in its own worktree (`.claude/worktrees/<name>`): use it — `git switch -c task/<issue>-<slug> origin/staging` there (the app's edit hook rejects edits in any other worktree). Otherwise: `git worktree add -b task/<issue>-<slug> .worktrees/task-<issue>-<slug> origin/staging`. Then junction `node_modules` from the main folder if the worktree has none (`cmd //c mklink //J <worktree>\node_modules <main>\node_modules`). Never commit in the shared main folder, and never push `task/*` branches.
- **Local folders**: never create folders outside the project (the main folder sits on the user's Desktop); one-off scratch files go in your scratchpad. Worktrees you create go under `.worktrees/` in the main folder only: `task-<issue>-<slug>/`, `integrate/`, `release/`, plus `_backup/` for local files to keep before deleting a folder (e.g. an `.env`). Don't create anything in `.claude/worktrees/` — the desktop app manages it. Removing a worktree: stop any preview server you started in it → `cmd //c rmdir <worktree>\node_modules` (the junction) → `git worktree remove <worktree>` → confirm the folder is gone.
- **Finishing a task = the `handoff` skill** (`.claude/skills/handoff/SKILL.md`): rebase onto `origin/staging` and resolve conflicts yourself, run `npm test` once, and end the last commit with the handoff trailers (`Status: ready`, `Migration`, `Depends-on`, `Release-note`, `Verify`, …). The integrator reads those trailers instead of your diff.
- **Whoever merges into `staging` is the integrator for that run** and follows the `integrate` skill (`.claude/skills/integrate/SKILL.md`): take the integration lock, merge only `Status: ready` branches in a temporary detached worktree, one full `npm test`, apply staging migrations, push `HEAD:staging`, clean up, release the lock.
- **Release PR (`staging` → `main`)**: the integrator opens it only after the user says staging is verified; if one is already open, update it with `gh pr edit` instead of opening another (every push to `staging` lands in the open PR). Never merge it — the maintainer merging it is the approval. When the user says it's merged, the integrator finishes the release (integrate skill step 9): production migrations if any, confirm the deploy, **merge `main` back into `staging`** (fast-forward when possible) so `main` is never ahead, then close the shipped issues.
- **Branches**: never push to `main` directly and never force-push `staging`. Release PRs merge with a merge commit, not squash. Production hotfix: `hotfix/*` off `main` → PR to `main` → merge `main` back into `staging`. Details: `docs/staging.md`.
- **Enforced by a hook**: `.claude/settings.json` runs `.claude/hooks/integration.mjs` before every Bash/PowerShell call. Without the integration lock it blocks `git push` (except `hotfix/*` and `--dry-run`), `gh pr create` (except `hotfix/*`), and `supabase db push` (except `--dry-run`); it always blocks `gh pr merge`. Take the lock with `node .claude/hooks/integration.mjs acquire "<note>"` — never work around the guard.

## What this is

新生命聖經速讀計畫 (NewLife Bible Speed Reading) — a Traditional-Chinese PWA for a church's quarterly Bible-reading challenges; a satellite app of the NewLife Member Hub using NLC (紟道) Logto SSO. Vanilla JS/HTML/CSS, no framework — except the issue-report feature (`components/issue-report/*.tsx`), a React + TypeScript island. Supabase backend (Postgres + Edge Functions), hosted on Vercel.

**Before changing entry points, load order, `js/db.js`, auth, tab modules, or backend tables/Edge Functions, read `docs/architecture.md`.** The back-office console (`admin/`, its own Vercel project and domain, enforced CSP) has its own rules — read `docs/admin-console.md` before changing it. Size warning: `js/db.js` (~6,100 lines) and `js/modules/plan.js` (~10,300 lines; also holds all stats/leaderboard charts — there is no `stats.js` or `js/views/`).

## Commands

```bash
npm run build             # icon registry → config.js → esbuild bundle into dist/ (what Vercel serves)
npm test                  # vitest run; quiet: npm test -- --reporter=dot
npm run test:watch
```

- No linter. Run `npm test` before calling a change done. `node --check` is not a substitute — it misses e.g. a ReferenceError left by a refactor (that caused a production incident).
- `npm run dev` (`npx serve .`) cannot load the app: `js/app.js` imports a `.ts` file that only esbuild strips. To check in a browser use `npm run build && npx serve dist`, or verify via a vitest test.
- `config.js` is git-ignored and generated from `.env` by `build-config.js` — never edit it by hand.

## Cache-busting and updates (read before editing JS/CSS or caching)

How stale-build detection, chunks, `/repair`, and the offline queue work: `docs/pwa-architecture.md` — read it before changing caching or offline sync. Rules:

- Never add `?v=` to imports, `<script>`, or `<link>` (`scripts/no-manual-cache-bust.test.mjs` enforces it; `?v=` on `assets/` images is fine). JS/CSS are content-hashed by `scripts/bundle.mjs`.
- New lazy module: add a **literal** `import()` entry to `LAZY_MODULE_LOADERS` in `js/app.js`. A computed `import(path)` can't be split and breaks the production build.
- **Breaking backend change** (anything an old build calls in normal use would break on — RPC renamed, column dropped): set `forceUpdateBuiltBefore` in `release-policy.json` to the deploy time **with a timezone** (e.g. `2026-09-23T13:00:00+08:00`) and **commit it in the same release as the migration** (there is no env override). Keep it `null` otherwise; admin-only breakage that a refresh fixes doesn't need it.
- `/repair` only unregisters the SW and clears app caches — never login tokens or reading progress. Don't route login failures through it.
- `sw.js` stays thin; cache behavior lives in `js/pwa/CacheManager.js`, never business logic in lifecycle handlers.
- Cache only same-origin static assets and public Bible API responses. Auth, Supabase/NLC, rankings, member data, and admin data bypass the SW. Never persist credentials in the offline queue.
- `vercel.json` must keep `/`, `/index.html`, and `/sw.js` non-immutable.

## Code conventions

- Each entry script's chain of side-effect `import`s (`config.js` → … → `gamification.js`) is load-bearing: the older core files attach to `window` and later code reads them as globals. Don't reorder it. New cross-file logic: real ES modules with named exports, not another `window.foo`.
- Data access goes through `state.supabase.from(...)` so it works with both the real Supabase client (dev) and the `NlcDataClient` shim (production). The shim implements only `select/insert/update/delete/upsert/eq/is/in/or/order/limit/single/maybeSingle` — anything else can silently misbehave in production.
- Use `escapeHTML()` for any user-supplied string rendered into innerHTML.
- UI/TTS/scroll/modal/auto-read patterns and anti-bug notes: the `bible-study-dev-guidelines` skill (`.claude/skills/bible-study-dev-guidelines/SKILL.md`).

## Backend (`supabase/`)

Tables, Edge Function inventory, and the incident history behind these rules: `docs/architecture.md`. Required secrets: `supabase/functions/README.md`.

- **Migrations**: timestamp names only — create with `npx supabase migration new <name>` (`scripts/migration-naming.test.mjs`). Apply to staging, verify, then production, always with an explicit `--project-ref` (never rely on `supabase link`). Never pass `--include-all` to production. Read a migration's header for ordering requirements before pushing.
  ```bash
  npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd --dry-run   # staging: check what will run
  npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd
  npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj --dry-run   # then production
  npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj
  node scripts/compare-env-snapshots.mjs --run                                 # both environments still match
  ```
- `supabase/migrations_legacy/` and `supabase/migrations/legacy/` are reference only — never replay them.
- **Every new SQL function** (`CREATE` or `CREATE OR REPLACE`) gets explicit grants in the same migration — Postgres grants PUBLIC by default and Supabase's default privileges grant `anon`/`authenticated` directly, so `FROM PUBLIC` alone is not enough:
  ```sql
  CREATE OR REPLACE FUNCTION public.some_new_fn(...) ... AS $$ ... $$;
  REVOKE ALL ON FUNCTION public.some_new_fn(...) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.some_new_fn(...) TO authenticated, service_role; -- drop authenticated (service_role only) if it must never be called directly by a client
  ```
  Grant `authenticated` explicitly when needed, including functions an RLS policy `TO authenticated` calls. A `SECURITY DEFINER` function doing a privileged mutation is `service_role`-only unless it is genuinely meant to be called directly by the client. Verify with `has_function_privilege('anon', p.oid, 'EXECUTE')`, never by reading grant statements.
- **Forced scope**: `nlc-data` uses the service role, so RLS does not apply in production. Writes/deletes through it must enforce `user_id`/`plan_id` via `applyForcedScope`, and RPCs must filter explicitly — never a cross-tenant unfiltered mutation.
- **Edge Functions**: never trust a decoded-but-unverified token claim for identity (`scripts/logto-jwt-verify.test.mjs`). A new function whose cron/webhook caller sends no `Authorization` header needs its `verify_jwt = false` entry in `supabase/config.toml` in the same change — a Dashboard-only toggle drifts back on the next CLI deploy.
- Keep the `profiles`/`user_identities` split (it prevents data loss when a user switches login method). The first admin is promoted manually via SQL (`supabase/README_clean_setup.md`).
- Environments: production `ztozevcqkfrohgjmngcj`, staging `dbtjsljrytzonjvclgrd` (https://bible-speed-reading-staging.vercel.app) — see `docs/staging.md`.

## Design system

See `docs/design-system.md`. Satellite brand color is **`#04A9D2`** (`--color-brand`; legacy alias `--primary-color`). Rules: no gradient fills on UI chrome (flat colors only), content-first calm reader, three themes (light/dark/warm-sepia). Typography uses **medium (500)** for emphasis and **normal (400)** for body — avoid 600–900 weights on chrome. Neutral shadows only, no brand-tinted glows. Icons are **Lucide** via `data-icon` / `renderIcon()`; prefer these over emoji. UI copy is Traditional Chinese (see `js/copy/zh-Hant.js`).
