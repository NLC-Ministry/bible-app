// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { convertOrgStructureToCSV } from "../js/modules/admin.js";

describe("Admin Org Structure CSV Export Tests", () => {
  it("verifies index.html contains export org structure button", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="admin-export-org-structure-btn"');
    expect(html).toContain("匯出組織架構 CSV");
  });

  it("converts org structure object into CSV format", () => {
    const mockOrgStructure = {
      regions: ["第一大區", "第二大區"],
      zones: {
        "第一大區": ["西區牧區", "東區牧區"],
        "第二大區": []
      },
      groups: {
        "西區牧區": ["約書亞小組", "彼得小組"],
        "東區牧區": []
      }
    };

    const csv = convertOrgStructureToCSV(mockOrgStructure, new Date("2026-08-12T04:34:56Z"));
    expect(csv.split("\n")[0]).toBe('"匯出時間（台灣時間）","2026-08-12 12:34:56（台灣時間 UTC+8）"');
    expect(csv).toContain("大區,牧區,小組");
    expect(csv).toContain('"第一大區","西區牧區","約書亞小組"');
    expect(csv).toContain('"第一大區","西區牧區","彼得小組"');
    expect(csv).toContain('"第一大區","東區牧區","無下屬小組"');
    expect(csv).toContain('"第二大區","無下屬牧區","無下屬小組"');
  });

  it("handles null or empty org structure gracefully", () => {
    expect(convertOrgStructureToCSV(null)).toBe("");
    expect(convertOrgStructureToCSV({ regions: [] })).toBe("");
  });
});
