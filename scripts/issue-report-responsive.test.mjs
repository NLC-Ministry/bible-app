import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, "index.css"), "utf8");
const fab = readFileSync(join(root, "components/issue-report/SupportFab.tsx"), "utf8");
const reportDrawer = readFileSync(join(root, "components/issue-report/ReportDrawer.tsx"), "utf8");
const uiDrawer = readFileSync(join(root, "components/ui/drawer.tsx"), "utf8");

describe("Issue report responsive FAB position", () => {
  it("positions FAB with nav + safe-area tokens, not magic Tailwind offsets", () => {
    expect(fab).not.toContain("bottom-28");
    expect(fab).not.toContain("right-6");
    expect(fab).toContain("issue-report-fab");
    expect(fab).toContain("fixed");
    expect(fab).toContain("z-sheet");

    const fabBlock = css.match(/\.issue-report-fab\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(fabBlock).toMatch(/--app-bottom-nav-height/);
    expect(fabBlock).toMatch(/--app-safe-bottom/);
    expect(fabBlock).toMatch(/safe-area-inset-right/);
    expect(css).toMatch(
      /@media\s*\(min-width:\s*769px\)\s*\{[^}]*\.issue-report-fab\s*\{[^}]*bottom:\s*calc\(\s*var\(--app-safe-bottom/s
    );
  });
});

describe("Issue report responsive drawer shell", () => {
  it("caps drawer height and scrolls the form body with safe footer padding", () => {
    expect(uiDrawer).toMatch(/max-h-\[(?:85dvh|min\(96dvh)/);
    expect(reportDrawer).toMatch(/overflow-y-auto/);
    expect(reportDrawer).toMatch(/min-h-0/);
    expect(reportDrawer).toMatch(/safe-area-inset-bottom/);
  });
});
