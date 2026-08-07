// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { convertUserDirectoryToCSV } from "../js/modules/admin.js";

describe("Admin User Directory CSV Export Tests", () => {
  it("verifies index.html contains export button", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="admin-user-directory-export-btn"');
    expect(html).toContain("匯出會員名單");
  });

  it("converts user directory array into CSV with required columns (大區, 牧區, 小組, 姓名)", () => {
    const mockProfiles = [
      {
        great_region: "第一大區",
        pastoral_zone: "西區牧區",
        small_group: "約書亞小組",
        name: "張三",
        email: "zhang@example.com",
        role_definition: { label: "小組長" },
        team_name: "光照團隊",
        member_role: "leader",
        is_active: true
      },
      {
        great_region: "第二大區",
        pastoral_zone: "北區牧區",
        small_group: "彼得小組",
        name: "李四",
        email: "li@example.com",
        role_definition: null,
        team_name: null,
        is_active: false
      }
    ];

    const csv = convertUserDirectoryToCSV(mockProfiles);
    expect(csv).toContain("大區,牧區,小組,姓名,電子信箱,角色,組隊狀態,帳號狀態");
    expect(csv).toContain('"第一大區","西區牧區","約書亞小組","張三","zhang@example.com","小組長","[隊長] 光照團隊","啟用中"');
    expect(csv).toContain('"第二大區","北區牧區","彼得小組","李四","li@example.com","一般會友","未加入團隊 (個人速讀中)","已停用"');
  });

  it("handles empty profile list gracefully", () => {
    expect(convertUserDirectoryToCSV([])).toBe("");
    expect(convertUserDirectoryToCSV(null)).toBe("");
  });
});
