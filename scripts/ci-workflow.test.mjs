import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const yaml = readFileSync(join(root, ".github/workflows/cicd.yml"), "utf8");

describe("CI/CD workflow", () => {
  it("is named CICD", () => {
    expect(yaml).toMatch(/^name: CICD$/m);
  });

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
