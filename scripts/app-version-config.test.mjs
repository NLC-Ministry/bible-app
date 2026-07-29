import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const buildConfig = readFileSync("build-config.js", "utf8");
const sw = readFileSync("sw.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
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

describe("release onboarding startup timing", () => {
  it("imports the onboarding helper from the app entry", () => {
    expect(app).toContain("maybeShowReleaseOnboarding");
    expect(app).toContain("./modules/onboarding-helper.js?v=");
  });

  it("checks onboarding only after initial data load and dashboard render", () => {
    const loadUserData = app.indexOf("db.loadUserData(true)");
    const firstDashboard = app.indexOf("await appRouter.switchTab('dashboard-view')");
    const onboarding = app.indexOf("maybeShowReleaseOnboarding({");

    expect(loadUserData).toBeGreaterThan(-1);
    expect(firstDashboard).toBeGreaterThan(loadUserData);
    expect(onboarding).toBeGreaterThan(firstDashboard);
  });
});
