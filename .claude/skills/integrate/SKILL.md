---
name: integrate
description: Merge handed-off task/* branches into staging and push, open/update the staging→main release PR, or finish a release after the user merged it (production migrations, merge main back into staging, close issues). Whoever merges is the integrator for that run. Use whenever you are about to merge anything into staging, push staging, apply a migration, open a release PR, or the user says a release PR was merged.
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
Also note each branch's `Reading-log-write` trailer (`%(trailers:key=Reading-log-write,valueonly,separator=)`).
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
Only remove a task worktree whose branch you merged. Tell the user what landed on staging and the `Verify` lines to check on https://bible-speed-reading-staging.vercel.app. If any merged branch has `Reading-log-write: yes`, the `Verify` list you give must also include checking with an account that is **behind schedule** and one that has **gaps** (an unchecked chapter before the last checked one) — check-in changes break exactly those accounts first.

## 8. Release PR (staging → main) — only after the user says staging is verified
```bash
gh pr list --base main --state open          # one open already? update it with gh pr edit, don't open another
git log --format='- %(trailers:key=Release-note,valueonly,separator=)' --no-merges origin/main..origin/staging
git log --format='- [ ] %(trailers:key=Verify,valueonly,separator=)' --no-merges origin/main..origin/staging
git diff --name-only origin/main origin/staging -- supabase/migrations/
```
Build the body from `.github/pull_request_template.md` with those lines (commits without trailers: read their subject). Hold the lock while creating/editing it. Migrations → note that production `db push` runs after the merge; breaking backend change → `release-policy.json` per CLAUDE.md. **Never merge the PR** (the guard blocks `gh pr merge`).

## 9. After the user says the release PR is merged
Take the lock, then:
1. **Production migrations** (only if the release included any): from a clean worktree of `origin/main`, `npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj --dry-run`, then without `--dry-run`, then `node scripts/compare-env-snapshots.mjs --run`.
2. **Deploy**: `gh run list --branch main --limit 1` — report if the deploy failed or hasn't finished yet; don't claim production is updated before it succeeds.
3. **Merge `main` back into `staging`** so `main` never drifts ahead (each release adds a merge commit that only `main` has; a hotfix would otherwise stay missing on `staging`):
   ```bash
   git fetch origin
   git merge-base --is-ancestor origin/staging origin/main && git push origin origin/main:refs/heads/staging
   ```
   Not an ancestor (staging moved on since the merge) → in a temporary detached worktree of `origin/staging`: `git merge --no-ff origin/main -m "Merge main back into staging after release #<PR>"`, `npm test`, `git push origin HEAD:staging`. Afterwards `git rev-list --count origin/staging..origin/main` must be `0`.
4. **Reading-log health check**: if the release included any `Reading-log-write: yes` branch, run `supabase/queries/reading_log_health.sql` in the production SQL Editor the next day (one section at a time) and compare check-ins per day, users with gaps, and the rejection rate against the days before the release; tell the user if anything jumped.
5. **Close the shipped issues** with one plain-Chinese line each (`Closes #N` doesn't auto-close: GitHub's default branch is `staging`).
6. Release the lock.
