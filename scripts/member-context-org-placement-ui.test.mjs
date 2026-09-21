import { describe, expect, it } from "vitest";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("index.css", "utf8");
const profileJs = fs.readFileSync("js/modules/profile.js", "utf8");
const dbJs = fs.readFileSync("js/db.js", "utf8");
const nlcSession = fs.readFileSync("supabase/functions/nlc-session/index.ts", "utf8");

describe("Member Hub org placement UI", () => {
  it("shows 大區/牧區/小組 only in the profile header, not a duplicate placement box or card", () => {
    // Org placement lives solely in the header breadcrumb (#profile-summary-org).
    // The "新生命會員中心" card (sync-status caption + 管理身份與牧區歸屬 +
    // 重新同步 rows) was removed: Member Hub navigation moved into the
    // "個人資訊" subpage, and resync is now the icon-only button on the
    // summary card header (#btn-profile-summary-refresh).
    expect(html).toContain('id="profile-summary-org"');
    expect(html).not.toContain('id="member-hub-org-sync-status"');
    expect(html).not.toContain('id="profile-member-hub-card"');
    expect(html).not.toContain('id="btn-member-hub-structure"');
    // The old standalone placement box must not come back (it duplicated the header).
    expect(html).not.toContain('id="member-hub-org-placement"');
    expect(html).not.toContain('id="member-hub-org-great-region"');
    expect(html).not.toContain('id="member-hub-org-pastoral-zone"');
    expect(html).not.toContain('id="member-hub-org-small-group"');
    expect(html).not.toContain('id="member-hub-org-empty"');
  });
});

describe("Member Hub org placement refresh", () => {
  it("wires an icon-only refresh button on the summary card to force a Member Hub session sync and re-render", () => {
    expect(html).toContain('id="btn-profile-summary-refresh"');
    expect(profileJs).toContain('document.getElementById("btn-profile-summary-refresh")');
    expect(profileJs).toContain("syncNlcSessionWithSupabase(true)");
    expect(profileJs).toContain("renderProfileView()");
  });

  it("keeps Hub-owned organization fields locked for Logto users", () => {
    // The local hasLockedIdentity computation in profile.js was only ever
    // used to gate a "唯讀由會員中心管理" notice HTML that no longer exists
    // (removed along with the 新生命會員中心 card), so this now checks the
    // actual enforcement points: nlc-session's per-field lock list, and
    // db.js storing whatever nlc-session returns as state.profileLockedFields.
    expect(nlcSession).toContain('const HUB_OWNED_PROFILE_FIELDS = ["name", "great_region", "pastoral_zone", "small_group"]');
    expect(dbJs).toContain("state.profileLockedFields");
  });

  it("routes identity management to Member Hub onboarding, not pastoral admin", () => {
    expect(profileJs).toContain('getMemberHubUrl("onboarding")');
    expect(profileJs).toContain("identityUrl = urls.onboarding");
    expect(profileJs).not.toContain("pastoral/structure");
  });

  it("styles the profile logout action with theme-aware danger tokens", () => {
    expect(html).toContain('class="profile-logout-btn"');
    expect(css).toContain("--color-danger-foreground");
    expect(css).toContain("--color-danger-muted");
    expect(css).toContain(".profile-logout-btn");
    expect(html).not.toContain("hover:text-danger");
  });
});
