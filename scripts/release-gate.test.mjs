import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// 上線審核（2026-09-27）：日常開發在 staging 分支，上線要開 staging → main 的 PR，
// 使用者在 staging 確認後貼上 staging-verified 標籤；CI 部署正式環境前會再檢查一次。
// 免費的私人 repo 不能設分支保護，所以把關放在部署這一步。見 docs/staging.md。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ci = read(".github/workflows/ci.yml");
const gate = read(".github/workflows/release-gate.yml");

describe("release-gate workflow", () => {
  it("runs on PRs into main, including when labels change", () => {
    expect(gate).toMatch(/pull_request:\s*\r?\n\s+branches:\s*\[main\]/);
    expect(gate).toMatch(/types:\s*\[opened, reopened, synchronize, labeled, unlabeled\]/);
  });

  it("only accepts staging or hotfix/* as the source branch", () => {
    expect(gate).toContain("staging|hotfix/*)");
  });

  it("requires every non-merge commit on main to already be in the PR (hotfixes merged back)", () => {
    expect(gate).toContain('git rev-list --no-merges "$HEAD_SHA..origin/main"');
  });

  it("stays red until the staging-verified label is added", () => {
    expect(gate).toContain("*,staging-verified,*)");
    expect(gate).toContain("exit $fail");
  });

  it("passes PR data through env vars, never interpolated straight into the script", () => {
    expect(gate).toContain("HEAD_REF: ${{ github.head_ref }}");
    const run = gate.slice(gate.indexOf("run: |"));
    expect(run).not.toMatch(/\$\{\{/);
  });
});

describe("production deploy gate in ci.yml", () => {
  const deploy = ci.slice(ci.indexOf("  deploy:"));
  const gateStep = deploy.slice(deploy.indexOf("- name: Require staging-verified before production deploy"), deploy.indexOf("- uses: actions/setup-node@v4"));

  it("runs only for pushes to main, before anything is built or deployed", () => {
    expect(gateStep).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(deploy.indexOf("Require staging-verified")).toBeLessThan(deploy.indexOf("- name: Deploy"));
    expect(deploy.indexOf("Require staging-verified")).toBeLessThan(deploy.indexOf("vercel pull"));
  });

  it("fails the deploy unless the commit came from a merged PR labelled staging-verified", () => {
    expect(gateStep).toContain("listPullRequestsAssociatedWithCommit");
    expect(gateStep).toContain("pr.merged_at && pr.base.ref === 'main'");
    expect(gateStep).toContain("label.name === 'staging-verified'");
    expect(gateStep).toContain("core.setFailed(");
  });
});

describe("release PR checklist", () => {
  it("exists and tells the reviewer to verify staging before adding the label", () => {
    expect(existsSync(new URL("../.github/pull_request_template.md", import.meta.url))).toBe(true);
    const template = read(".github/pull_request_template.md");
    expect(template).toContain("staging-verified");
    expect(template).toContain("https://bible-speed-reading-staging.vercel.app");
    expect(template).toContain("--project-ref ztozevcqkfrohgjmngcj --dry-run");
    expect(template).toContain("Create a merge commit");
  });
});
