# CI-Gated Vercel Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Vercel from deploying the Bible app until GitHub Actions CI is green, then deploy preview (PRs) or production (`main`) from Actions.

**Architecture:** Turn off Vercel Git auto-deploy in `vercel.json`. Keep the existing `build-and-test` job. Add a `deploy` job with `needs: build-and-test` that runs `vercel pull` → `vercel build` → `vercel deploy --prebuilt`. Do not ship the CI `dist/` (placeholder env).

**Tech Stack:** GitHub Actions, Vercel CLI `59.1.3`, Node 20, Vitest contract tests against `vercel.json` and `ci.yml`.

## Global Constraints

- Node version floor: 20.
- Pin Vercel CLI to `vercel@59.1.3`. Do not use `@latest`.
- Authenticate with the `VERCEL_TOKEN` environment variable. Do not pass `--token` on the CLI.
- Deploy never starts unless `build-and-test` succeeded (`needs: build-and-test`).
- Do not ship the CI placeholder `dist/`. Rebuild in the deploy job via `vercel pull` / `vercel build`.
- Same-repo pull requests → preview. Push to `main` → `--prod`. Fork PRs are skipped.
- Do not change `buildCommand`, cache headers, rewrites, or runtime app behavior.
- Do not disconnect the Vercel GitHub app; only set `git.deploymentEnabled` to `false`.

## File map

- Modify: `scripts/vercel-config.test.mjs` — assert auto-deploy is off.
- Modify: `vercel.json` — `"git": { "deploymentEnabled": false }`.
- Create: `scripts/ci-workflow.test.mjs` — contract-test the workflow gate and deploy commands.
- Modify: `.github/workflows/ci.yml` — add gated `deploy` job.

---

### Task 1: Disable Vercel Git auto-deploy

**Files:**
- Modify: `scripts/vercel-config.test.mjs`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: existing `cfg` object parsed from `vercel.json`.
- Produces: `cfg.git.deploymentEnabled === false`.

- [ ] **Step 1: Write the failing test**

Add this case inside the existing `describe("vercel.json", …)` block in `scripts/vercel-config.test.mjs`, after the `outputs the dist directory` test:

```js
  it("disables Vercel Git auto-deploy so CI can gate releases", () => {
    expect(cfg.git.deploymentEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bible-app && npx vitest run scripts/vercel-config.test.mjs`

Expected: FAIL — `cfg.git` is `undefined` (or `deploymentEnabled` is not `false`).

- [ ] **Step 3: Turn auto-deploy off**

Insert this property in `vercel.json` immediately after `"outputDirectory":  "dist",`, matching the file’s existing two-space-after-colon style:

```json
    "git":  {
                "deploymentEnabled":  false
            },
```

Do not change `buildCommand`, `outputDirectory`, `rewrites`, or `headers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bible-app && npx vitest run scripts/vercel-config.test.mjs`

Expected: PASS, including the new auto-deploy assertion.

- [ ] **Step 5: Commit** (skip unless the user asked to commit)

```bash
git add scripts/vercel-config.test.mjs vercel.json
git commit -m "$(cat <<'EOF'
fix(ci): disable Vercel Git auto-deploy so Actions can gate releases

EOF
)"
```

---

### Task 2: Contract-test the CI/CD workflow, then add the deploy job

**Files:**
- Create: `scripts/ci-workflow.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: workflow text at `.github/workflows/ci.yml`.
- Produces: a `deploy` job that `needs: build-and-test`, pins `vercel@59.1.3`, deploys with `--prebuilt`, uses `--prod` only on the production path, authenticates via `VERCEL_TOKEN` env (never `--token`), and skips fork PRs.

- [ ] **Step 1: Write the failing tests**

Create `scripts/ci-workflow.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const yaml = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

describe("CI/CD workflow", () => {
  it("runs deploy only after build-and-test succeeds", () => {
    expect(yaml).toMatch(/deploy:\s*\n(?:[ \t]+.+\n)*[ \t]+needs:\s*build-and-test/);
  });

  it("pins Vercel CLI instead of using @latest", () => {
    expect(yaml).toContain("vercel@59.1.3");
    expect(yaml).not.toContain("vercel@latest");
  });

  it("deploys prebuilt artifacts without passing --token on the CLI", () => {
    expect(yaml).toContain("vercel deploy --prebuilt");
    expect(yaml).not.toMatch(/--token/);
  });

  it("uses production flags only for the main-branch production path", () => {
    expect(yaml).toContain("vercel build --prod");
    expect(yaml).toContain("vercel deploy --prebuilt --prod");
  });

  it("skips fork pull requests", () => {
    expect(yaml).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd bible-app && npx vitest run scripts/ci-workflow.test.mjs`

Expected: FAIL — current `ci.yml` has no `deploy` job, no pinned CLI, no `--prebuilt`.

- [ ] **Step 3: Replace `.github/workflows/ci.yml` with the gated pipeline**

Write this exact file (keep the existing `build-and-test` steps, including placeholder `SUPABASE_*` and the `dist/` existence checks):

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
  VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Unit tests
        run: npm test

      - name: Build and verify bundled output
        run: |
          npm run build
          test -n "$(ls dist/app.*.js 2>/dev/null)" || { echo "no hashed app bundle in dist/"; exit 1; }
          test -n "$(ls dist/index.*.css 2>/dev/null)" || { echo "no hashed css in dist/"; exit 1; }
          test -f dist/index.html || { echo "no dist/index.html"; exit 1; }
        env:
          SUPABASE_URL: https://placeholder.supabase.co
          SUPABASE_ANON_KEY: placeholder-anon-key

  deploy:
    needs: build-and-test
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install Vercel CLI
        run: npm install --global vercel@59.1.3

      - name: Pull Vercel environment
        run: vercel pull --yes --environment=${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'production' || 'preview' }}

      - name: Build
        run: |
          if [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main" ]; then
            vercel build --prod
          else
            vercel build
          fi

      - name: Deploy
        id: deploy
        run: |
          if [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main" ]; then
            URL=$(vercel deploy --prebuilt --prod)
          else
            URL=$(vercel deploy --prebuilt)
          fi
          {
            echo "url=$URL"
          } >> "$GITHUB_OUTPUT"
          {
            echo "## Deploy Result"
            echo "- **URL**: $URL"
            echo "- **Target**: $([ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main" ] && echo production || echo preview)"
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Comment preview URL
        if: github.event_name == 'pull_request'
        env:
          PREVIEW_URL: ${{ steps.deploy.outputs.url }}
        uses: actions/github-script@v7
        with:
          script: |
            const url = process.env.PREVIEW_URL;
            const marker = '<!-- bible-app-vercel-preview -->';
            const body = `${marker}\nPreview: ${url}`;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find((comment) => comment.body && comment.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd bible-app && npx vitest run scripts/ci-workflow.test.mjs scripts/vercel-config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `cd bible-app && npm test`

Expected: PASS (existing suite plus the two contract files).

- [ ] **Step 6: Commit** (skip unless the user asked to commit)

```bash
git add scripts/ci-workflow.test.mjs .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: deploy to Vercel only after tests and build succeed

EOF
)"
```

---

## Spec coverage (self-review)

- Auto-deploy off → Task 1 (`vercel.json` + test).
- One workflow, `needs:` gate → Task 2.
- Preview on same-repo PRs, production on `main` → Task 2 `if` + `--prod` branch.
- Fork PRs skipped → Task 2 `if` + contract test.
- `vercel pull` / `build` / `deploy --prebuilt` → Task 2.
- Pin `vercel@59.1.3`, no `--token` → Task 2 + contract tests.
- Do not ship CI `dist/` → deploy job rebuilds; CI job still uses placeholder env.
- PR comment + job summary → Task 2 comment step and `$GITHUB_STEP_SUMMARY`.
- Concurrency cancel-in-progress → Task 2 `concurrency` block.
- Cache headers / rewrites / `buildCommand` unchanged → Task 1 forbids those edits.
- Human secrets cutover remains a dashboard step; no code for it.
