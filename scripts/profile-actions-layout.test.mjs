import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

describe("profile action hierarchy", () => {
  it("shows organization information before all member-center actions", () => {
    const placementIndex = html.indexOf('id="member-hub-org-placement"');
    const manageIndex = html.indexOf('id="btn-member-hub-structure"');
    const refreshIndex = html.indexOf('id="btn-member-hub-refresh"');
    expect(placementIndex).toBeGreaterThan(-1);
    expect(manageIndex).toBeGreaterThan(placementIndex);
    expect(refreshIndex).toBeGreaterThan(manageIndex);
  });

  it("groups APP sharing and help below the member-center section", () => {
    const placementIndex = html.indexOf('id="member-hub-org-placement"');
    const appHelpIndex = html.indexOf('class="profile-settings-section-label">APP 與協助');
    expect(appHelpIndex).toBeGreaterThan(placementIndex);
    expect(html.indexOf('id="btn-share-app"')).toBeGreaterThan(appHelpIndex);
    expect(html.indexOf('id="btn-release-onboarding-help"')).toBeGreaterThan(appHelpIndex);
    expect(css).toContain(".profile-settings-section-label");
  });

  it("uses chevrons only for navigation rows, not immediate actions", () => {
    const shareStart = html.indexOf('id="btn-share-app"');
    const helpStart = html.indexOf('id="btn-release-onboarding-help"');
    const shareMarkup = html.slice(shareStart, helpStart);
    const refreshStart = html.indexOf('id="btn-member-hub-refresh"');
    const refreshMarkup = html.slice(refreshStart, html.indexOf('</button>', refreshStart));
    expect(shareMarkup).not.toContain("app-settings-item__chevron");
    expect(refreshMarkup).not.toContain("app-settings-item__chevron");
    expect(html.slice(helpStart, html.indexOf('</button>', helpStart))).toContain("app-settings-item__chevron");
  });
});
