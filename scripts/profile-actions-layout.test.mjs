import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("index.css", "utf8");

describe("profile action hierarchy", () => {
  // The "新生命會員中心" card (sync-status caption + 管理身份與牧區歸屬 +
  // 重新同步 rows) was removed: Member Hub navigation now lives inside the
  // "個人資訊" row (first item of "我的內容"), and resync is the icon-only
  // button on the summary card header, not a row in this list at all.
  it("shows 個人資訊 as the first row of 我的內容, before APP sharing/help", () => {
    const navGroupIndex = html.indexOf('id="profile-content-nav-group"');
    const personalInfoIndex = html.indexOf('data-profile-open="personal-info"');
    const appHelpIndex = html.indexOf('class="profile-settings-section-label">APP 與協助');
    expect(navGroupIndex).toBeGreaterThan(-1);
    expect(personalInfoIndex).toBeGreaterThan(navGroupIndex);
    expect(appHelpIndex).toBeGreaterThan(personalInfoIndex);
    expect(html.indexOf('id="btn-share-app"')).toBeGreaterThan(appHelpIndex);
    expect(html.indexOf('id="btn-release-onboarding-help"')).toBeGreaterThan(appHelpIndex);
    expect(css).toContain(".profile-settings-section-label");
  });

  it("uses chevrons only for navigation rows, not immediate actions", () => {
    const shareStart = html.indexOf('id="btn-share-app"');
    const helpStart = html.indexOf('id="btn-release-onboarding-help"');
    const shareMarkup = html.slice(shareStart, helpStart);
    expect(shareMarkup).not.toContain("app-settings-item__chevron");
    expect(html.slice(helpStart, html.indexOf('</button>', helpStart))).toContain("app-settings-item__chevron");
  });
});
