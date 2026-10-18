import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const yaml = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

describe("CI/CD workflow", () => {
  it("runs deploy only after every test shard and the build succeed", () => {
    // ci.yml 是 CRLF；JS 的 . 不吃 \r，所以中間的行用 [^\n]*
    expect(yaml).toMatch(/deploy:\s*\n(?:[ \t]+[^\n]*\n)*[ \t]+needs:\s*\[test, build\]/);
  });

  it("splits the unit tests into shards that together cover the whole suite (#457)", () => {
    const test = yaml.slice(yaml.indexOf("  test:"), yaml.indexOf("  build:"));
    expect(test).toMatch(/shard:\s*\[1, 2, 3\]/);
    expect(test).toContain("npx vitest run --shard=${{ matrix.shard }}/3");
  });

  it("caches the pinned Vercel CLI instead of reinstalling it every deploy (#457)", () => {
    expect(yaml).toContain("key: vercel-cli-59.1.3-${{ runner.os }}");
    expect(yaml).toContain("if: steps.vercel-cli-cache.outputs.cache-hit != 'true'");
  });

  describe("security scans live in the build job, not a new job (#461)", () => {
    const build = yaml.slice(yaml.indexOf("\n  build:"), yaml.indexOf("\n  deploy:"));

    it("blocks on high production advisories and only reports dev-tool ones", () => {
      expect(build).toContain("run: npm audit --omit=dev --audit-level=high");
      expect(build).toContain("npm audit > npm-audit.txt 2>&1 || true");
      expect(build).toContain('>> "$GITHUB_STEP_SUMMARY"');
      // 擋的那一步不能被 || true 吃掉
      expect(build).not.toMatch(/npm audit --omit=dev --audit-level=high[^\n]*\|\| true/);
    });

    it("runs a pinned, checksum-verified gitleaks on the newly pushed commits only", () => {
      expect(build).toContain('GITLEAKS_VERSION: "8.30.1"');
      expect(build).toMatch(/GITLEAKS_SHA256: "[0-9a-f]{64}"/);
      expect(build).toContain('sha256sum -c -');
      expect(build.indexOf("sha256sum -c -")).toBeLessThan(build.indexOf("tar -xzf"));
      expect(build).toContain('RANGE="${PR_BASE}..${PR_HEAD}"');
      expect(build).toContain('RANGE="${PUSH_BEFORE}..${PUSH_AFTER}"');
      expect(build).toContain('--redact');
      expect(build).toContain("--config .gitleaks.toml");
      expect(build).toContain("fetch-depth: 0");
    });

    it("keeps the event values out of the shell script (passed via env)", () => {
      const script = build.slice(build.indexOf("curl -sSfL"));
      expect(script).not.toContain("${{");
    });

    it("the gitleaks config extends the default rules", () => {
      const config = readFileSync(join(root, ".gitleaks.toml"), "utf8");
      expect(config).toMatch(/\[extend\]\s*\r?\nuseDefault = true/);
    });
  });

  it("skips deploy for Dependabot PRs, which get no Actions secrets (#461)", () => {
    expect(yaml).toContain("github.actor != 'dependabot[bot]'");
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

  it("deploys the staging branch as a preview on a fixed staging alias", () => {
    // ci.yml 是 CRLF；JS 的 . 不吃 \r，所以註解行用 [^\n]*
    expect(yaml).toMatch(/push:\s*\n(?:[ \t]*#[^\n]*\n)*[ \t]+branches:\s*\[main, staging\]/);
    const aliasStep = yaml.slice(yaml.indexOf("- name: Alias staging deployment"), yaml.indexOf("- name: Comment preview URL"));
    expect(aliasStep).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/staging'");
    expect(aliasStep).toContain('vercel alias set "$DEPLOY_URL" bible-speed-reading-staging.vercel.app');
    // 綁定只能發生在 staging 分支，絕不能碰到正式環境的部署或正式網址
    expect(aliasStep).not.toMatch(/refs\/heads\/main|--prod|bible\.newlife\.org\.tw|bible-speed-reading\.vercel\.app/);
  });

  it("builds production only from main, so a staging push stays a preview", () => {
    for (const line of yaml.split(/\r?\n/).filter(l => /--prod/.test(l))) {
      const block = yaml.slice(0, yaml.indexOf(line));
      expect(block.slice(block.lastIndexOf("if ["))).toContain('"refs/heads/main"');
    }
  });

  it("skips fork pull requests", () => {
    expect(yaml).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository"
    );
  });

  describe("admin console deploy (#555)", () => {
    const job = yaml.slice(yaml.indexOf("\n  deploy-admin:"));
    const build = yaml.slice(yaml.indexOf("\n  build:"), yaml.indexOf("\n  deploy:"));

    it("builds the admin console in the build job with placeholder settings", () => {
      expect(build).toContain("node scripts/build-admin.mjs");
      expect(build).toContain("test ! -e dist/admin.html");
    });

    it("deploys only after the member app deploy, on pushes, to its own Vercel project", () => {
      expect(job).toMatch(/needs:\s*\[deploy\]/);
      expect(job).toContain("if: github.event_name == 'push'");
      expect(job).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_ADMIN_PROJECT_ID }}");
      expect(job).toContain("cp vercel.admin.json vercel.json");
      expect(job.indexOf("cp vercel.admin.json vercel.json")).toBeLessThan(job.indexOf("vercel pull"));
    });

    it("skips quietly until the admin Vercel project exists", () => {
      expect(job).toContain('if [ -z "$VERCEL_PROJECT_ID" ]; then');
      expect(job).toContain("steps.configured.outputs.enabled == 'true'");
    });

    it("aliases staging to the fixed admin staging URL and never touches the member app domains", () => {
      expect(job).toContain('vercel alias set "$URL" bible-speed-reading-admin-staging.vercel.app');
      expect(job).not.toMatch(/bible\.newlife\.org\.tw|alias set "\$URL" bible-speed-reading-staging\.vercel\.app/);
    });
  });
});
