// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { convertUserDirectoryToCSV } from "../js/modules/admin.js";

describe("Admin User Directory CSV Export Tests", () => {
  it("verifies index.html contains export button", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="admin-user-directory-export-btn"');
    expect(html).toContain('title="依當前篩選結果匯出 CSV 名單"');
    expect(html).toContain("<span>匯出</span>");
  });

  it("keeps the export button and count badge from wrapping into a squeezed vertical column", () => {
    // Regression: on narrower layouts the button text ("匯出會員名單") wrapped
    // one character per line because the button had no white-space:nowrap /
    // flex-shrink:0, and its flex sibling (the title block) had no min-width:0
    // to let it shrink first instead of squeezing the button.
    const html = readFileSync("index.html", "utf8");
    const btnStart = html.indexOf('id="admin-user-directory-export-btn"');
    const btnTagEnd = html.indexOf(">", btnStart);
    const btnOpenTag = html.slice(btnStart, btnTagEnd);
    expect(btnOpenTag).toContain("white-space:nowrap");
    expect(btnOpenTag).toContain("flex-shrink:0");

    const summaryStart = html.indexOf('class="admin-user-directory__summary"');
    const summarySection = html.slice(summaryStart, btnStart);
    expect(summarySection).toContain('style="min-width:0;"');
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

    const csv = convertUserDirectoryToCSV(mockProfiles, new Date("2026-08-12T04:34:56Z"));
    expect(csv.split("\n")[0]).toBe('"匯出時間（台灣時間）","2026-08-12 12:34:56"');
    expect(csv).toContain("大區,牧區,小組,姓名,電子信箱,角色,組隊狀態,帳號狀態");
    expect(csv).toContain('"第一大區","西區牧區","約書亞小組","張三","zhang@example.com","小組長","[隊長] 光照團隊","啟用中"');
    expect(csv).toContain('"第二大區","北區牧區","彼得小組","李四","li@example.com","一般會友","未加入團隊 (個人速讀中)","已停用"');
  });

  it("handles empty profile list gracefully", () => {
    expect(convertUserDirectoryToCSV([])).toBe("");
    expect(convertUserDirectoryToCSV(null)).toBe("");
  });
});
