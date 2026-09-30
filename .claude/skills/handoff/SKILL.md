---
name: handoff
description: Finish a task branch so any session can integrate it cheaply — sync with origin/staging, resolve conflicts, run tests, and end the last commit with handoff trailers. Use when a task in a task/* worktree is done (or blocked) and needs to go into staging.
---

# Handoff: finish a task branch

The integrator reads your trailers instead of your diff, so everything it needs must be in them. Conflicts are yours to resolve — you know this change best.

Work in your task worktree (`../bible-speed-reading_task-<issue>-<slug>`, branch `task/<issue>-<slug>`). Never push the branch.

## 1. Sync with staging and resolve conflicts here
```bash
git fetch origin
git rebase origin/staging
```
Resolve any conflict now (the branch is local-only, so rebase is fine). If `origin/staging` added a migration with a later timestamp than yours, recreate yours with `npx supabase migration new <name>` so it sorts last.

## 2. Test once
During development run only the related tests (`npx vitest run scripts/<file>.test.mjs`). Now run the full suite once: `npm test`. If one file times out, rerun it alone before calling it a failure (parallel sessions load the machine).

Also check that the latest staging CI run is green before you hand off: `gh run list --branch staging --limit 1`. Some tests only fail on Windows or only on the Linux CI runner (path separators, line endings, case-sensitive file names) — mention any Windows-only test you relied on or skipped in `Integrator-note` (lesson from #352).

## 3. Commit with trailers
`git status` first — no `dist/`, `config.js`, `.env*`, or icon-registry line-ending churn. The **last commit** of the branch ends with this block (one contiguous paragraph, `Key: value`, no blank lines inside):

```
Task: #<issue>
Status: ready
Synced-to: <short sha of origin/staging you rebased onto>
Tests: npm test <passed>/<total>
Migration: <supabase/migrations/…sql, comma-separated> | none
Depends-on: <task/… branch that must merge first> | none
Touches: <files + key functions, one line>
Integrator-note: <anything the integrator must do or know> | none
Release-note: <one plain-Chinese sentence: what members/admins will notice>
Verify: <打開哪個頁面 → 應該看到什麼>
Co-Authored-By: <model attribution line>
```

- `Reading-log-write: yes` if the branch touches `db.logChapterRead` / `recordChapterRead` / `unrecordChapterRead`, any auto or manual check-in path, the offline check-in queue, `reading_logs` writes, or the record/unrecord RPCs; otherwise `no`. The integrator uses it to require extra checks on staging and a health check after release.
- `Status: blocked` + the reason in `Integrator-note` if you cannot finish; omit `Status` while still working.
- Changed something after handing off? Add a new commit with a fresh trailer block — the last commit wins.
- `forceUpdateBuiltBefore` / Edge Function deploys / Vault secrets → say so in `Integrator-note`.

## 4. Report
Tell the user the branch name and that it is `ready`. Do not merge, push, open PRs, or run `supabase db push` — the PreToolUse guard blocks those without the integration lock. If you are also asked to integrate, switch to the `integrate` skill.
