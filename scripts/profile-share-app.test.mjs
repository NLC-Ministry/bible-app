import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");

describe("profile APP sharing", () => {
  it("shows a Share APP action in the profile settings page", () => {
    expect(html).toContain('id="btn-share-app"');
    expect(html).toContain('<span class="app-settings-item__title">分享 APP</span>');
    expect(html).toContain('data-icon="share"');
  });

  it("shares only the canonical production APP link without current-page auth parameters", () => {
    expect(profile).toContain('export const APP_SHARE_URL = "https://bible.newlife.org.tw/"');
    expect(profile).toContain('await navigator.share(shareData)');
    expect(profile).toContain('url: APP_SHARE_URL');
    expect(profile).not.toContain('url: window.location.href');
  });

  it("copies the APP link when native sharing is unavailable and handles cancellation quietly", () => {
    expect(profile).toContain('navigator.clipboard.writeText(APP_SHARE_URL)');
    expect(profile).toContain('error?.name === "AbortError"');
    expect(profile).toContain('APP 連結已複製，可以貼給朋友了');
  });
});
