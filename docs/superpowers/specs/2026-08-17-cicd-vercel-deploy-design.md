# Bible App CI-Gated Vercel Deploy (Design Spec)

**Date:** 2026-08-17
**Status:** Draft for review
**Repo:** `bible-app` (`NLC-Ministry/bible-app`)

## Context

GitHub Actions already runs tests and a placeholder build on pull requests and on pushes to `main` (`.github/workflows/cicd.yml`). Vercel still deploys independently via its Git integration, so a red CI run does not stop a deployment from starting.

The required pipeline is: **CI must succeed before any Vercel deployment starts.** Failed CI must never start a deploy. After CI is green, GitHub Actions deploys a **preview** for pull requests and **production** for `main`.

## Decisions locked in brainstorming

- Gate is “deploy never starts,” not “deploy starts then wait to promote.” Vercel Deployment Checks are out: they still create the deployment, then hold the production alias.
- Scope: production on `main` and preview deploys on pull requests, each only after CI is green.
- Architecture: one workflow. Job 1 is existing CI. Job 2 deploys only if Job 1 succeeded (`needs:`).
- Do not ship the CI `dist/`. CI uses placeholder Supabase keys; the deploy job rebuilds with real Vercel env via `vercel pull` → `vercel build` → `vercel deploy --prebuilt`.

## Goal

Make Vercel deployment a CI-gated GitHub Actions job so a failing test or build never starts a Bible app deploy, while keeping preview URLs on PRs and production deploys on `main`.

## Non-goals

- Playwright / E2E against the preview URL.
- GitHub Environment protection rules or human approval gates.
- Disconnecting the Vercel GitHub app (keep the project linked; only turn off auto-deploy).
- Changing `buildCommand`, cache headers, rewrites, or runtime app behavior.
- Deploying feature-branch pushes that are not pull requests (existing CI already ignores those).

## Architecture

Vercel Git auto-deploy is turned off in `vercel.json`. GitHub Actions owns every deploy.

```
pull_request | push to main
        │
        ▼
┌───────────────────┐
│ build-and-test    │  npm ci, npm test, npm run build (placeholder env)
└─────────┬─────────┘
          │ success only
          ▼
┌───────────────────┐
│ deploy            │  vercel pull → vercel build → vercel deploy --prebuilt
└─────────┬─────────┘
          │
     PR ──▶ preview URL (comment on the PR)
     main ▶ production (`--prod`)
```

If `build-and-test` fails, GitHub skips `deploy`. The job is not started.

### Components

**1. Auto-deploy off-switch (`vercel.json`)**

Add:

```json
"git": { "deploymentEnabled": false }
```

This is the project-level instruction that stops Vercel’s Git integration from building on push/PR. The GitHub app can stay installed. Existing cache headers, rewrites, `buildCommand`, and `outputDirectory` stay unchanged.

**2. CI + deploy workflow (`.github/workflows/cicd.yml`)**

Keep the current `on:` triggers (`pull_request` and `push` to `main`) and the existing `build-and-test` job (Node 20, `npm ci`, `npm test`, placeholder `npm run build`). The workflow file is `.github/workflows/cicd.yml` and its GitHub Actions display name is `CICD`.

Add a `deploy` job:

- `needs: build-and-test` — hard gate.
- Runs only when secrets can work:
  - `push` to `main` → production
  - `pull_request` from the **same repository** → preview
  - fork PRs are skipped (GitHub does not expose this repo’s secrets to fork workflows)
- Uses Node 20.
- Pins Vercel CLI to `vercel@59.1.3` (current latest as of 2026-08-15). Do not use `@latest`.
- Authenticates with the `VERCEL_TOKEN` environment variable. Do not pass `--token` on the CLI (it leaks in process listings).
- Reads `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from GitHub secrets as environment variables (the CLI expects those names).
- Sequence:
  1. `vercel pull --yes --environment=<preview|production>`
  2. `vercel build` (add `--prod` only for production)
  3. `vercel deploy --prebuilt` (add `--prod` only for production)
- Captures the deployment URL from CLI stdout and writes it to the GitHub Actions job summary.
- On pull requests, posts or updates a single PR comment with the preview URL (Vercel’s Git bot will no longer comment once auto-deploy is off).

Concurrency: one in-flight run per PR number or `main` ref; cancel older runs of the same group so a new commit supersedes a deploy that has not finished.

**3. GitHub secrets (human setup, required before the first Actions deploy)**

Three repository secrets on `NLC-Ministry/bible-app`:

| Secret | Kind | Source |
|---|---|---|
| `VERCEL_TOKEN` | credential | Vercel → Account Settings → Tokens (scope: the team that owns the Bible app project) |
| `VERCEL_ORG_ID` | identifier | Team Settings → General → Team ID, or `.vercel/project.json` `orgId` after `vercel link` |
| `VERCEL_PROJECT_ID` | identifier | Project Settings → General → Project ID, or `.vercel/project.json` `projectId` |

Org ID and Project ID are not credentials. Store them as secrets anyway so the workflow does not hardcode them.

**4. Config-contract test**

Extend `scripts/vercel-config.test.mjs` so `git.deploymentEnabled === false` is asserted. A later change that re-enables Git auto-deploy fails CI.

### Data flow

```
GitHub event
  → build-and-test (placeholder SUPABASE_* so tests/build verification stay hermetic)
  → [skip deploy if failed, fork PR, or missing event match]
  → vercel pull writes .vercel/ with real Preview or Production env
  → vercel build runs vercel.json buildCommand (`npm run build`) against those env vars
      → build-config.js emits config.js
      → bundle.mjs writes dist/
  → vercel deploy --prebuilt uploads .vercel/output (not a second Vercel-side rebuild)
  → preview comment / production alias
```

The CI `dist/` is discarded. Shipping it would bake placeholder `SUPABASE_URL` / `SUPABASE_ANON_KEY` into production.

### Error handling

| Case | Behavior |
|---|---|
| Unit test or placeholder build fails | `deploy` is skipped; no Vercel deployment is created |
| Fork pull request | `deploy` is skipped; CI still runs |
| Missing or invalid Vercel secrets | `deploy` fails loudly after CI passed; nothing is promoted |
| `vercel pull` / `build` / `deploy` non-zero | job fails; previous production alias is unchanged |
| Newer commit on the same PR or on `main` | older workflow run is cancelled |

No raw Vercel error objects are posted to PRs. The PR comment only includes the preview URL on success. Failures stay in the Actions log.

### Testing

- Existing `scripts/vercel-config.test.mjs` keeps all current header/rewrite/output assertions.
- New assertion: `cfg.git.deploymentEnabled === false`.
- Workflow YAML is validated by GitHub on push; no extra YAML linter is required for this change.
- Manual verification after secrets are set:
  1. Open a PR with a trivial change → CI green → preview URL comment appears → Vercel dashboard shows a Preview deployment for that commit, not a Git-triggered one.
  2. Push a commit that fails `npm test` → `deploy` is skipped → no new Vercel deployment.
  3. Merge to `main` → CI green → Production deployment; `bible.newlife.org.tw` serves that deployment.

## Human cutover checklist

Do these in order so the first Actions deploy is not racing a Git auto-deploy:

1. Add the three GitHub secrets.
2. Merge this change (the `vercel.json` off-switch lands on `main` in the same commit as the workflow).
3. Confirm the merge commit’s Actions run deploys production, and that Vercel did not also start a Git-triggered deployment for that commit.
4. If a Git-triggered deployment still appears, turn off automatic deployments in the Vercel project Git settings as a dashboard backup. Do not disconnect the GitHub app unless that dashboard control is missing.

## Rollback

Remove `git.deploymentEnabled` (or set it `true`), delete the `deploy` job, and Vercel’s Git integration resumes auto-deploy. Previous production deployments remain available for instant rollback in the Vercel dashboard.
