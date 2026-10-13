import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("admin participant basic information", () => {
  it("uses the existing admin-only permission profile query", () => {
    const db = read("js/db.js");

    expect(db).toContain("fetchManagedScopeProfiles");
    expect(db).toContain('getUserRoleCode(state.currentUser) !== "admin"');
    expect(db).toContain('name, email, great_region, pastoral_zone, small_group');
  });

  it("shows escaped basic details in system settings and keeps plan statistics separate", () => {
    const html = readLegacyIndexHtml();
    const admin = read("js/modules/admin.js");
    // #370：統計、排行、組員狀況在 plan-stats.js，這裡的規則兩檔一起檢查。
    const plan = [read("js/modules/plan.js"), read("js/modules/plan-stats.js")].join("\n");
    const css = read("css/admin-registration-statistics.css");

    expect(html).toContain("使用者基本資料");
    expect(html).toContain("管理範圍設定");
    expect(admin).toContain('escapeHTML(profile.name || "未設定")');
    expect(admin).toContain("escapeHTML(email)");
    expect(admin).toContain("escapeHTML(roleLabel)");
    expect(admin).toContain("escapeHTML(placement)");
    expect(css).toContain("repeat(auto-fit, minmax(min(100%, 12rem), 1fr))");
    expect(plan).not.toContain('aria-label="參與者基本資料"');
    expect(plan).not.toContain("participantEmail");
  });
});
