import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("read-only admin user directory", () => {
  it("renders a separate read-only user management section", () => {
    const html = read("index.html");
    const start = html.indexOf('id="admin-user-directory-col"');
    const end = html.indexOf('id="admin-managed-scopes-col"');
    const section = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(section).toContain("使用者管理");
    expect(section).toContain("使用者基本資料");
    expect(section).toContain("本區不會修改帳號");
    expect(section).toContain('id="admin-user-directory-disclosure"');
    expect(section).toContain('<details class="glass-card admin-user-directory"');
    expect(section).toContain('id="admin-user-directory-search"');
    expect(section).toContain('id="admin-user-directory-filter-incomplete"');
    expect(section).toContain("未填會員資料（沒有牧區或沒有名稱）");
    expect(section).toContain('id="admin-user-directory-filter-stage-one"');
    expect(section).toContain("未加入第一階段計畫");
    expect(section).not.toContain("<button");
  });

  it("loads every real profile through an admin-only read query", () => {
    const db = read("js/db.js");
    const start = db.indexOf("async fetchAdminUserProfiles()");
    const end = db.indexOf("async fetchManagedScopeProfiles()");
    const method = db.slice(start, end);

    expect(method).toContain('getUserRoleCode(state.currentUser) !== "admin"');
    expect(method).toContain('.from("profiles")');
    expect(method).toContain('member_context_synced_at');
    expect(method).toContain('.eq("is_demo", false)');
    expect(method).not.toContain('.eq("is_active", true)');
    expect(method).not.toContain(".update(");
    expect(method).not.toContain(".delete(");
    expect(method).not.toContain(".upsert(");
    expect(method).toContain('const firstStageGlobalPlanId = "00000000-0000-0000-c026-000000000001"');
    expect(method).toContain('.from("reading_plans")');
    expect(method).toContain('const firstStagePresetKey = "church_stage_01"');
    expect(method).toContain('.or(`global_plan_id.eq.${firstStageGlobalPlanId},preset_key.eq.${firstStagePresetKey}`)');
    expect(method).toContain("joined_stage_one:");
  });

  it("escapes profile data and exposes no write operation", () => {
    const admin = read("js/modules/admin.js");
    const start = admin.indexOf("function renderAdminUserDirectoryList");
    const end = admin.indexOf("let managedScopeProfiles");
    const directory = admin.slice(start, end);

    expect(directory).toContain("db.fetchAdminUserProfiles()");
    expect(directory).toContain("escapeHTML(name)");
    expect(directory).toContain("escapeHTML(email)");
    expect(directory).toContain("escapeHTML(roleLabel)");
    expect(directory).toContain('<details class="admin-user-directory__card">');
    expect(directory).toContain('class="admin-user-directory__card-summary"');
    expect(directory).toContain("escapeHTML(pastoralZone)");
    expect(directory).toContain("missingRequiredProfile");
    expect(directory).toContain('["NLC User", "尚未取得姓名", "未命名使用者"]');
    expect(directory).toContain("placeholderNames.has(normalizedName)");
    expect(directory).toContain("notJoinedStageOneOnly");
    expect(directory).toContain("profile.joined_stage_one === true");
    expect(directory).toContain("profile.is_active === true");
    expect(directory).toContain("String(profile.id || \"\") !== currentProfileId");
    expect(directory).toContain("第一階段計畫");
    expect(directory).not.toContain("db.update");
    expect(directory).not.toContain("onclick");
  });
});
