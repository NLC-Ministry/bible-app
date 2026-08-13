import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const table = readFileSync("components/issue-report/AdminReportTable.tsx", "utf8");
const css = readFileSync("index.css", "utf8");

describe("admin report theme", () => {
  it("uses a semantic root and app theme tokens for the report manager", () => {
    expect(table).toContain('className="admin-report-view ');
    expect(css).toContain("#admin-reports-root .admin-report-view {");
    expect(css).toMatch(/#admin-reports-root \.admin-report-view \{[\s\S]*background: var\(--bg-card\) !important;/);
    expect(css).toContain('class~="bg-slate-950"');
    expect(css).toContain('color: var(--text-primary) !important');
    expect(css).toContain('border-color: var(--border-card) !important');
  });

  it("uses the correct native color scheme for light and dark controls", () => {
    expect(css).toMatch(/#admin-reports-root \.admin-report-view select,[\s\S]*color-scheme: light;/);
    expect(css).toMatch(/body\.dark-theme #admin-reports-root \.admin-report-view select,[\s\S]*color-scheme: dark;/);
  });
});
