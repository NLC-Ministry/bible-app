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
    expect(fabBlock).toMatch(/position:\s*fixed/);
    expect(fabBlock).toMatch(/z-index:\s*var\(--z-sheet\)/);
    expect(css).toMatch(
      /@media\s*\(min-width:\s*769px\)\s*\{[^}]*\.issue-report-fab\s*\{[^}]*bottom:\s*calc\(\s*var\(--app-safe-bottom/s
    );
  });
});

describe("Issue report visibility lifecycle", () => {
  it("reacts when the login gate is hidden after authentication", () => {
    expect(fab).toContain("isLoginGateVisible");
    expect(fab).toContain("MutationObserver");
    expect(fab).toContain('attributeFilter: ["class"]');
  });
});
describe("Issue report responsive composer surface", () => {
  it("uses a report-specific full-screen mobile composer instead of a Vaul drawer", () => {
    expect(reportDrawer).not.toMatch(/from ["'].*ui\/drawer/);
    expect(reportDrawer).not.toContain("DrawerContent");
    expect(reportDrawer).not.toContain("DrawerFooter");
    expect(reportDrawer).toContain("role=\"dialog\"");
    expect(reportDrawer).toContain("aria-modal=\"true\"");
    expect(reportDrawer).toContain("h-[100dvh]");
    expect(reportDrawer).toContain("md:h-auto");
  });

  it("keeps the whole report form in one natural scroll flow for mobile keyboard stability", () => {
    expect(reportDrawer).toContain("overflow-y-auto");
    expect(reportDrawer).toContain("safe-area-inset-bottom");
    expect(reportDrawer).toContain("primary-btn w-full");
    expect(reportDrawer).toContain("secondary-btn w-full");
    expect(reportDrawer).not.toContain("scrollIntoView");
    expect(reportDrawer).not.toContain("requestAnimationFrame");
    expect(reportDrawer).not.toContain("onFocus={handleReportFieldFocus}");
  });

  it("leaves the shared Vaul drawer wrapper generic", () => {
    expect(uiDrawer).not.toMatch(/fixed\s*=\s*true/);
    expect(uiDrawer).not.toMatch(/repositionInputs\s*=\s*true/);
    expect(uiDrawer).not.toContain("fixed={fixed}");
    expect(uiDrawer).not.toContain("repositionInputs={repositionInputs}");
  });
});
