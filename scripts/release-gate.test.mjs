import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// 上線審核（2026-09-27）：日常開發在 staging 分支，上線要開 staging → main 的 PR，
// 使用者在 staging 網站確認後按 merge 就代表確認上線；CI 部署正式環境前會檢查
// 這個 commit 是從 staging（或 hotfix/*）的 PR merge 進來的。免費的私人 repo 不能設
// 分支保護，所以把關放在部署這一步。見 docs/staging.md。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ci = read(".github/workflows/ci.yml");
const gate = read(".github/workflows/release-gate.yml");

describe("release-gate workflow", () => {
  it("runs on PRs into main", () => {
    expect(gate).toMatch(/pull_request:\s*\r?\n\s+branches:\s*\[main\]/);
    expect(gate).toMatch(/types:\s*\[opened, reopened, synchronize\]/);
  });

  it("only accepts staging or hotfix/* as the source branch", () => {
    expect(gate).toContain("staging|hotfix/*)");
  });

  it("requires every non-merge commit on main to already be in the PR (hotfixes merged back)", () => {
    expect(gate).toContain('git rev-list --no-merges "$HEAD_SHA..origin/main"');
  });

  it("no longer needs a label: merging is the approval", () => {
    expect(gate).not.toContain("staging-verified");
    expect(gate).not.toMatch(/labeled/);
  });

  it("passes PR data through env vars, never interpolated straight into the script", () => {
    expect(gate).toContain("HEAD_REF: ${{ github.head_ref }}");
    const run = gate.slice(gate.indexOf("run: |"));
    expect(run).not.toMatch(/\$\{\{/);
  });
});

describe("production deploy gate in ci.yml", () => {
  // #592：CI 合成一個工作，閘門是第一個步驟
  const gateStep = ci.slice(ci.indexOf("- name: Require a release PR before production deploy"), ci.indexOf("- name: Skip checks already passed"));

  it("runs only for pushes to main, before anything is built or deployed", () => {
    expect(gateStep).toContain("if: env.IS_PRODUCTION == 'true'");
    expect(ci).toContain("IS_PRODUCTION: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}");
    expect(ci.indexOf("Require a release PR")).toBeLessThan(ci.indexOf("- name: Deploy"));
    expect(ci.indexOf("Require a release PR")).toBeLessThan(ci.indexOf("vercel pull"));
    expect(ci.indexOf("Require a release PR")).toBeLessThan(ci.indexOf("npm run build"));
  });

  it("fails the deploy unless the commit came from a merged PR from staging or hotfix/*", () => {
    expect(gateStep).toContain("listPullRequestsAssociatedWithCommit");
    expect(gateStep).toContain("pr.merged_at && pr.base.ref === 'main'");
    expect(gateStep).toContain("pr.head.ref === 'staging' || pr.head.ref.startsWith('hotfix/')");
    expect(gateStep).toContain("core.setFailed(");
    expect(gateStep).not.toContain("staging-verified");
  });
});

describe("release PR checklist", () => {
  it("exists and asks the reviewer to check staging, then merge", () => {
    expect(existsSync(new URL("../.github/pull_request_template.md", import.meta.url))).toBe(true);
    const template = read(".github/pull_request_template.md");
    expect(template).toContain("https://bible-speed-reading-staging.vercel.app");
    expect(template).toContain("打開 ______ → 應該看到 ______");
    expect(template).toContain("Create a merge commit");
    expect(template).not.toContain("staging-verified");
  });
});
