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
});
