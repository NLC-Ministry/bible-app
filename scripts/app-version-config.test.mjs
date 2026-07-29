import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const buildConfig = readFileSync("build-config.js", "utf8");
const sw = readFileSync("sw.js", "utf8");
describe("Bible app release version contract", () => {
  it("declares product version 0.1.0", () => {
    expect(pkg.version).toBe("0.1.0");
  });

  it("generates runtime APP_CONFIG and APP_VERSION for browser support", () => {
    expect(buildConfig).toContain('const APP_CONFIG = {');
    expect(buildConfig).toContain('appVersion: "0.1.0"');
    expect(buildConfig).toContain('onboardingVersion: "0.1.0"');
    expect(buildConfig).toContain("window.APP_CONFIG = APP_CONFIG");
    expect(buildConfig).toContain("window.APP_VERSION = APP_CONFIG.appVersion");
  });

  it("aligns service worker cache version with the release", () => {
    expect(sw).toContain('const VERSION = "0.1.0"');
    expect(sw).toContain('version: VERSION');
  });
});
