---
name: integrate
description: Merge handed-off task/* branches into staging and push, or open/update the staging→main release PR. Whoever merges is the integrator for that run. Use whenever you are about to merge anything into staging, push staging, apply a migration, or open a release PR.
---

# Integrate: task branches → staging (→ release PR)

Read trailers, not diffs. Open code only for a conflict, a failing test, or an `Integrator-note` that asks for it. Never commit in the shared main folder.

## 1. Take the lock
```bash
node .claude/hooks/integration.mjs acquire "<branches you are merging>"
```
Fails → another session is integrating; wait (`… status`). A lock older than 90 min counts as stale and is taken over. Always release it at the end, including on failure (step 7).

## 2. List ready branches
```bash
git fetch origin
for b in $(git branch --format='%(refname:short)' --no-merged origin/staging --list 'task/*'); do
  git log -1 --format="$b | %(trailers:key=Status,valueonly,separator=) | dep: %(trailers:key=Depends-on,valueonly,separator=) | mig: %(trailers:key=Migration,valueonly,separator=) | note: %(trailers:key=Integrator-note,valueonly,separator=)" "$b"
done
```
Merge only `Status: ready`. Order by `Depends-on`, then by migration timestamp. A branch without trailers is not ready — leave it.

## 3. Dry-run conflicts (touches nothing)
```bash
git merge-tree --write-tree --name-only origin/staging task/<x>
```
Conflict → prefer handing it back: tell the user the task session must rebase and hand off again. Resolve it yourself only when it is small and obvious.

## 4. Merge in a temporary worktree
```bash
git worktree add --detach ../bible-speed-reading_integrate origin/staging
cmd //c mklink //J "<…>\bible-speed-reading_integrate\node_modules" "<main folder>\node_modules"
cd ../bible-speed-reading_integrate
git merge --no-ff task/<x> -m "Merge branch 'task/<x>' into staging: <Release-note in English> (#<issue>)"
```
Then **one** full `npm test` for the whole batch (a file that only times out: rerun it alone).

## 5. Migrations (only if a merged branch lists one)
```bash
npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd --dry-run   # must list exactly the expected files
npx supabase db push --linked --project-ref dbtjsljrytzonjvclgrd
```
Read each migration's header for ordering requirements first; then check the result with a query (`supabase db query --linked --project-ref … -f file.sql`). Production is only pushed after the user merges the release PR.

## 6. Push
```bash
git push origin HEAD:staging
```
Rejected (someone pushed first) → `git fetch`, recreate the worktree from the new `origin/staging`, redo 4–6.

If a release PR (`staging` → `main`) is open, this push lands in it: update its description (step 8).

## 7. Clean up and release
For each merged branch, and for the integrate worktree — **remove the node_modules junction first**, or `worktree remove` can delete the main folder's `node_modules` through it:
```bash
cmd //c rmdir "<worktree>\node_modules"
git worktree remove "<worktree>"
git branch -d task/<x>
node .claude/hooks/integration.mjs release
```
Only remove a task worktree whose branch you merged. Tell the user what landed on staging and the `Verify` lines to check on https://bible-speed-reading-staging.vercel.app.

## 8. Release PR (staging → main) — only after the user says staging is verified
```bash
gh pr list --base main --state open          # one open already? update it with gh pr edit, don't open another
git log --format='- %(trailers:key=Release-note,valueonly,separator=)' --no-merges origin/main..origin/staging
git log --format='- [ ] %(trailers:key=Verify,valueonly,separator=)' --no-merges origin/main..origin/staging
git diff --name-only origin/main origin/staging -- supabase/migrations/
```
Build the body from `.github/pull_request_template.md` with those lines (commits without trailers: read their subject). Hold the lock while creating/editing it. Migrations → note that production `db push` runs after the merge; breaking backend change → `release-policy.json` per CLAUDE.md. **Never merge the PR** (the guard blocks `gh pr merge`); after the user merges, push production migrations if any.
