import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Windows 取出的檔案是 CRLF、CI（Linux）是 LF：統一成 LF 再比對，兩邊結果才一樣
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const yaml = read(".github/workflows/ci.yml");
const step = (name) => {
  const start = yaml.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const next = yaml.indexOf("\n      - ", start + 1);
  return yaml.slice(start, next < 0 ? undefined : next);
};
const at = (text) => yaml.indexOf(text);

describe("CI/CD workflow", () => {
  // #599：repo 設定強制 actions 釘選完整 SHA（tag 可被改指，SHA 不會）；註解標版本給人和 Dependabot 看
  it("pins every action to a full commit SHA with a version comment (#599)", () => {
    for (const file of [".github/workflows/ci.yml", ".github/workflows/release-gate.yml"]) {
      const uses = read(file).split("\n").filter((line) => /^\s*-?\s*uses:/.test(line));
      expect(uses.length, file).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line, file).toMatch(/^\s*-?\s*uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+)*\s*$/);
      }
    }
  });

  it("lets Dependabot bump the pinned actions weekly (#599)", () => {
    const dependabot = read(".github/dependabot.yml");
    expect(dependabot).toMatch(/package-ecosystem: github-actions/);
    expect(dependabot).toMatch(/interval: weekly/);
    // npm 只開安全更新（#461），這裡不能出現 npm 的一般升版
    expect(dependabot).not.toMatch(/package-ecosystem: "?npm/);
  });

  // #592：一個工作從頭跑到部署——每個工作各自進位成整分鐘計費，拆開反而貴
  it("runs everything in one job on a pinned runner (#592)", () => {
    const jobs = yaml.slice(yaml.indexOf("\njobs:"));
    expect(jobs.match(/^  [a-z-]+:\s*$/gm)).toEqual(["  ci:"]);
    // ubuntu-latest 會自己換版本（2026-10-19 起換成 Ubuntu 26）——兩個 workflow 都固定版本
    for (const file of ["ci.yml", "release-gate.yml"]) {
      const text = read(`.github/workflows/${file}`);
      const runners = text.match(/runs-on:[^\n]*/g);
      expect(runners.length).toBeGreaterThan(0);
      for (const runner of runners) expect(runner).toMatch(/^runs-on: ubuntu-\d+\.\d+\s*$/);
    }
  });

  // #597：Node 20 已停止維護。版本只寫在 .node-version，CI（也就是正式站建置）照它裝
  it("takes the Node version from .node-version, which is a maintained LTS (#597)", () => {
    // 步驟本身縮排 6 格，with: 底下的設定縮排 8 格以上
    const setups = yaml.match(/- uses: actions\/setup-node@[^\n]*\n(?: {8,}[^\n]*\n)+/g);
    expect(setups.length).toBeGreaterThan(0);
    for (const setup of setups) {
      expect(setup).toContain("node-version-file: .node-version");
      expect(setup).not.toMatch(/node-version:\s/);
    }
    const version = readFileSync(join(root, ".node-version"), "utf8").trim();
    expect(version).toMatch(/^\d+$/);
    expect(Number(version)).toBeGreaterThanOrEqual(24);
  });

  it("deploys only after the tests, audits and builds, none of which may be skipped by an error (#592)", () => {
    const deployAt = at("- name: Deploy member app");
    for (const check of ["- name: Unit tests", "- name: Audit production dependencies", "- name: Scan new commits", "- name: Build and verify bundled output", "- name: Build and verify admin console", "- name: Build tests"]) {
      expect(at(check)).toBeGreaterThan(0);
      expect(at(check)).toBeLessThan(deployAt);
    }
    expect(yaml).not.toContain("continue-on-error");
  });

  it("covers the whole suite: npm test plus the build tests it leaves out (#592)", () => {
    expect(step("Unit tests")).toContain("run: npm test");
    expect(step("Build tests")).toContain("run: npm run test:build");
    const config = readFileSync(join(root, "vitest.config.ts"), "utf8");
    const buildConfig = readFileSync(join(root, "vitest.build.config.ts"), "utf8");
    expect(config).toContain("exclude: [...BASE_EXCLUDE, ...BUILD_TESTS]");
    expect(buildConfig).toContain("include: BUILD_TESTS");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts["test:build"]).toBe("vitest run --config vitest.build.config.ts");
  });

  it("skips runs that only touch docs or agent settings (#592)", () => {
    const ignored = yaml.match(/paths-ignore:\s*\n(?:[ \t]+(?:#[^\n]*|- [^\n]*)\n)+/g);
    expect(ignored).toHaveLength(2); // pull_request 和 push 各一份
    for (const block of ignored) {
      for (const path of ['"docs/**"', '"**/*.md"', '".claude/**"']) expect(block).toContain(path);
      // 程式碼、設定、migration 都不能被略過
      expect(block).not.toMatch(/js\/|supabase|\.github|package|\*\*\/\*"/);
    }
  });

  it("does not test or preview-deploy the release PR again — staging already did (#592)", () => {
    expect(yaml).toContain("if: github.event_name != 'pull_request' || github.head_ref != 'staging'");
  });

  describe("main push skips checks only for content already tested (#592)", () => {
    const skip = step("Skip checks already passed on the release PR's head");

    it("runs only on the production path, after the release gate", () => {
      expect(skip).toContain("if: env.IS_PRODUCTION == 'true'");
      expect(at("- name: Require a release PR")).toBeLessThan(at("- name: Skip checks already passed"));
    });

    it("requires the same tree and a passing run that really ran the tests", () => {
      expect(skip).toContain(`"$(git rev-parse 'HEAD^{tree}')" != "$(git rev-parse "\${HEAD_SHA}^{tree}")"`);
      expect(skip).toContain("status=success");
      // 上線 PR 自己的 run 會整個略過（也算 success），不能拿來當作測過
      expect(skip).toContain('.event == "push" or (.event == "pull_request" and .head_branch != "staging")');
      expect(skip).toContain('echo "skip=true"');
    });

    it("gates every check step on it, but never the deploy", () => {
      for (const name of ["Unit tests", "Audit production dependencies", "Report all dependency advisories", "Scan new commits for leaked secrets (gitleaks)", "Build and verify bundled output", "Build and verify admin console", "Build tests"]) {
        expect(step(name)).toContain("if: steps.tested.outputs.skip != 'true'");
      }
      expect(step("Deploy member app")).not.toContain("steps.tested");
    });
  });

  it("caches the pinned Vercel CLI instead of reinstalling it every deploy (#457)", () => {
    expect(yaml).toContain("key: vercel-cli-59.1.3-${{ runner.os }}");
    expect(yaml).toContain("steps.vercel-cli-cache.outputs.cache-hit != 'true'");
  });

  describe("security scans (#461)", () => {
    it("blocks on high production advisories and only reports dev-tool ones", () => {
      expect(yaml).toContain("run: npm audit --omit=dev --audit-level=high");
      expect(yaml).toContain("npm audit > npm-audit.txt 2>&1 || true");
      expect(yaml).toContain('>> "$GITHUB_STEP_SUMMARY"');
      // 擋的那一步不能被 || true 吃掉
      expect(yaml).not.toMatch(/npm audit --omit=dev --audit-level=high[^\n]*\|\| true/);
    });

    it("runs a pinned, checksum-verified gitleaks on the newly pushed commits only", () => {
      const scan = step("Scan new commits for leaked secrets (gitleaks)");
      expect(scan).toContain('GITLEAKS_VERSION: "8.30.1"');
      expect(scan).toMatch(/GITLEAKS_SHA256: "[0-9a-f]{64}"/);
      expect(scan).toContain('sha256sum -c -');
      expect(scan.indexOf("sha256sum -c -")).toBeLessThan(scan.indexOf("tar -xzf"));
      expect(scan).toContain('RANGE="${PR_BASE}..${PR_HEAD}"');
      expect(scan).toContain('RANGE="${PUSH_BEFORE}..${PUSH_AFTER}"');
      expect(scan).toContain('--redact');
      expect(scan).toContain("--config .gitleaks.toml");
      expect(yaml).toContain("fetch-depth: 0");
    });

    it("keeps the event values out of the shell script (passed via env)", () => {
      const scan = step("Scan new commits for leaked secrets (gitleaks)");
      expect(scan.slice(scan.indexOf("curl -sSfL"))).not.toContain("${{");
      const skip = step("Skip checks already passed on the release PR's head");
      expect(skip.slice(skip.indexOf("run: |"))).not.toContain("${{");
    });

    it("the gitleaks config extends the default rules", () => {
      const config = readFileSync(join(root, ".gitleaks.toml"), "utf8");
      expect(config).toMatch(/\[extend\]\s*\r?\nuseDefault = true/);
    });
  });

  it("skips deploy for Dependabot PRs, which get no Actions secrets (#461)", () => {
    expect(yaml).toContain("github.actor != 'dependabot[bot]'");
    expect(step("Deploy member app")).toContain("if: env.CAN_DEPLOY == 'true'");
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
    const aliasStep = step("Alias staging deployment");
    expect(aliasStep).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/staging'");
    expect(aliasStep).toContain('vercel alias set "$DEPLOY_URL" bible-speed-reading-staging.vercel.app');
    // 綁定只能發生在 staging 分支，絕不能碰到正式環境的部署或正式網址
    expect(aliasStep).not.toMatch(/refs\/heads\/main|--prod|bible\.newlife\.org\.tw|bible-speed-reading\.vercel\.app/);
  });

  it("builds production only from main, so a staging push stays a preview", () => {
    expect(yaml).toContain("IS_PRODUCTION: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}");
    for (const line of yaml.split(/\r?\n/).filter(l => /--prod/.test(l))) {
      const block = yaml.slice(0, yaml.indexOf(line));
      expect(block.slice(block.lastIndexOf("if ["))).toContain('"$IS_PRODUCTION" = "true"');
    }
  });

  it("skips fork pull requests", () => {
    expect(yaml).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository"
    );
  });

  describe("admin console deploy (#555)", () => {
    const deploy = step("Deploy admin console");

    it("builds the admin console with placeholder settings before any deploy", () => {
      const build = step("Build and verify admin console");
      expect(build).toContain("node scripts/build-admin.mjs");
      expect(build).toContain("test ! -e dist/admin.html");
    });

    it("deploys only after the member app deploy, on pushes, to its own Vercel project", () => {
      expect(at("- name: Deploy admin console")).toBeGreaterThan(at("- name: Deploy member app"));
      expect(deploy).toContain("if: github.event_name == 'push'");
      expect(deploy).toContain("VERCEL_PROJECT_ID: ${{ secrets.VERCEL_ADMIN_PROJECT_ID }}");
      expect(deploy).toContain("cp vercel.admin.json vercel.json");
      expect(deploy.indexOf("cp vercel.admin.json vercel.json")).toBeLessThan(deploy.indexOf("vercel pull"));
      // 會友 App 的 .vercel（專案設定、build 輸出）不能混進後台部署
      expect(deploy.indexOf("rm -rf .vercel")).toBeLessThan(deploy.indexOf("vercel pull"));
    });

    it("skips quietly until the admin Vercel project exists", () => {
      expect(deploy).toContain('if [ -z "$VERCEL_PROJECT_ID" ]; then');
      expect(deploy.slice(deploy.indexOf('if [ -z "$VERCEL_PROJECT_ID" ]'))).toMatch(/exit 0/);
    });

    it("aliases staging to the fixed admin staging URL and never touches the member app domains", () => {
      expect(deploy).toContain('vercel alias set "$URL" bible-speed-reading-admin-staging.vercel.app');
      expect(deploy).not.toMatch(/bible\.newlife\.org\.tw|alias set "\$URL" bible-speed-reading-staging\.vercel\.app/);
    });
  });
});
