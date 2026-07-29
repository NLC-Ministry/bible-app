import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");

describe("Profile Settings onboarding recall entry", () => {
  it("adds a 使用說明 settings item", () => {
    expect(html).toContain('id="btn-release-onboarding-help"');
    expect(html).toContain("使用說明");
    expect(html).toContain('id="profile-app-version"');
  });

  it("wires the settings item to open the release onboarding helper manually", () => {
    expect(profile).toContain("openOnboardingHelper");
    expect(profile).toContain('document.getElementById("btn-release-onboarding-help")');
    expect(profile).toContain("manual: true");
  });
});
