---
name: handoff
description: Finish a task branch so any session can integrate it cheaply — sync with origin/staging, resolve conflicts, run tests, and end the last commit with handoff trailers. Use when a task in a task/* worktree is done (or blocked) and needs to go into staging.
---

# Handoff: finish a task branch

The integrator reads your trailers instead of your diff, so everything it needs must be in them. Conflicts are yours to resolve — you know this change best.

Work in your task worktree (your desktop-app session worktree, or `.worktrees/task-<issue>-<slug>` in the main folder; branch `task/<issue>-<slug>`). Never push the branch.

## 1. Sync with staging and resolve conflicts here
```bash
git fetch origin
git rebase origin/staging
```
Resolve any conflict now (the branch is local-only, so rebase is fine). If `origin/staging` added a migration with a later timestamp than yours, recreate yours with `npx supabase migration new <name>` so it sorts last.

## 2. Test what you changed
During development run only the related tests (`npx vitest run scripts/<file>.test.mjs`). Now run once: `npm run test:changed` (`scripts/test-changed.mjs`) — every test that imports a file changed since `origin/staging` (vitest `--changed`) plus every test whose source names a changed file (the many `readFileSync` source-text tests that `--changed` can't see); a change to `package.json`, the lockfile or the vitest config runs everything. The full suite runs once at integration and again in CI (#592). If one file times out, rerun it alone before calling it a failure (parallel sessions load the machine).

If you touched the build (`scripts/bundle.mjs`, `scripts/build-admin.mjs`, `admin/`, `admin-legacy/`, entry points or their import chain), also run `npm run test:build` — those tests run esbuild and are left out of `npm test`.

## 3. Stop your preview servers
Stop every `npx serve dist` / preview server you started from this worktree. The integrator removes the worktree after merging, and a server left running keeps the folder locked.

## 4. Commit with trailers
`git status` first — no `dist/`, `config.js`, `.env*`, or icon-registry line-ending churn. The **last commit** of the branch ends with this block (one contiguous paragraph, `Key: value`, no blank lines inside):

```
Task: #<issue>
Status: ready
Synced-to: <short sha of origin/staging you rebased onto>
Tests: test:changed <passed>/<total>[, test:build <passed>/<total>]
Migration: <supabase/migrations/…sql, comma-separated> | none
Depends-on: <task/… branch that must merge first> | none
Touches: <files + key functions, one line>
Integrator-note: <anything the integrator must do or know> | none
Release-note: <one plain-Chinese sentence: what members/admins will notice>
Verify: <打開哪個頁面 → 應該看到什麼>
Co-Authored-By: <model attribution line>
```

- `Status: blocked` + the reason in `Integrator-note` if you cannot finish; omit `Status` while still working.
- Changed something after handing off? Add a new commit with a fresh trailer block — the last commit wins.
- `forceUpdateBuiltBefore` / Edge Function deploys / Vault secrets → say so in `Integrator-note`.

## 5. Report
Tell the user the branch name and that it is `ready`. Do not merge, push, open PRs, or run `supabase db push` — the PreToolUse guard blocks those without the integration lock. If you are also asked to integrate, switch to the `integrate` skill.
