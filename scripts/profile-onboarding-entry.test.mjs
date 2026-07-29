import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");
const app = readFileSync("js/app.js", "utf8");
const helper = readFileSync("js/modules/onboarding-helper.js", "utf8");
const iconRegistry = readFileSync("js/design/icon-registry.js", "utf8");

describe("Profile Settings onboarding recall entry", () => {
  it("adds a 使用說明 settings item", () => {
    expect(html).toContain('id="btn-release-onboarding-help"');
    expect(html).toContain("使用說明");
    expect(html).toContain('id="profile-app-version"');
  });

  it("wires the settings item to open the release onboarding helper manually", () => {
    expect(profile).toContain("window.openOnboardingHelper");
    expect(profile).toContain('document.getElementById("btn-release-onboarding-help")');
    expect(profile).toContain("manual: true");
  });

  it("uses the bundled onboarding controller for automatic and manual opening", () => {
    expect(app).toContain("maybeShowReleaseOnboarding");
    expect(app).toContain("loadReleaseOnboardingHelper");
    expect(helper).toContain("globalThis.openOnboardingHelper = openOnboardingHelper");
    expect(profile).not.toContain('from "./onboarding-helper.js"');
  });

  it("uses icon keys available in the generated registry", () => {
    expect(html).toContain('data-icon="bookOpen"');
    expect(html).toContain('data-icon="chevronRight"');
    expect(iconRegistry).toContain('"bookOpen"');
    expect(iconRegistry).toContain('"chevronRight"');
    expect(html).not.toContain('data-icon="help-circle"');
    expect(html).not.toContain('data-icon="chevron-right"');
  });
});
