import { describe, expect, it } from "vitest";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("index.css", "utf8");
const profileJs = fs.readFileSync("js/modules/profile.js", "utf8");

describe("Member Hub org placement UI", () => {
  it("defines a read-only placement section with the required labels and sync status target", () => {
    expect(html).toContain('id="member-hub-org-placement"');
    expect(html).toContain('id="member-hub-org-great-region"');
    expect(html).toContain('id="member-hub-org-pastoral-zone"');
    expect(html).toContain('id="member-hub-org-small-group"');
    expect(html).toContain('id="member-hub-org-sync-status"');
    expect(html).toContain("大區");
    expect(html).toContain("牧區");
    expect(html).toContain("小組");
  });

  it("styles the placement section without relying on inline styles", () => {
    expect(css).toContain(".member-hub-org-placement");
    expect(css).toContain(".member-hub-org-placement__grid");
    expect(css).toContain(".member-hub-org-placement__sync");
  });

  it("renders placement values and formats the Member Hub sync timestamp", () => {
    expect(profileJs).toContain("function formatMemberContextSyncedAt");
    expect(profileJs).toContain("function renderMemberHubOrgPlacement");
    expect(profileJs).toContain("已同步自會員中心");
    expect(profileJs).toContain("尚未設定");
  });
});

describe("Member Hub org placement refresh", () => {
  it("wires the refresh button to force a Member Hub session sync and re-render", () => {
    expect(html).toContain('id="btn-member-hub-refresh"');
    expect(profileJs).toContain('document.getElementById("btn-member-hub-refresh")');
    expect(profileJs).toContain("syncNlcSessionWithSupabase(true)");
    expect(profileJs).toContain("renderProfileView()");
  });

  it("keeps Hub-owned organization fields locked for Logto users", () => {
    expect(profileJs).toContain('"great_region"');
    expect(profileJs).toContain('"pastoral_zone"');
    expect(profileJs).toContain('"small_group"');
    expect(profileJs).toContain("lockedFields.has");
  });

  it("routes identity management to Member Hub onboarding, not pastoral admin", () => {
    expect(profileJs).toContain('getMemberHubUrl("onboarding")');
    expect(profileJs).toContain("identityUrl = urls.onboarding");
    expect(profileJs).not.toContain("pastoral/structure");
  });
});
