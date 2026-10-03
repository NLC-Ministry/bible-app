import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
// Since #418 the Tailwind config lives in tailwind.config.cjs and is compiled at build time (scripts/bundle.mjs).
const tailwindConfig = readFileSync(join(root, "tailwind.config.cjs"), "utf8");
const fab = readFileSync(join(root, "components/issue-report/SupportFab.tsx"), "utf8");
const reportDrawer = readFileSync(join(root, "components/issue-report/ReportDrawer.tsx"), "utf8");
const uiDrawerPath = join(root, "components/ui/drawer.tsx");

describe("Tailwind design-token bridge (tailwind.config.cjs)", () => {
  it("maps shadcn semantic colors to Bible app CSS variables", () => {
    expect(html).not.toContain("cdn.tailwindcss.com");
    expect(tailwindConfig).toMatch(/primary:\s*["']var\(--color-brand\)["']/);
    // Was "#FFFFFF" — measured 2.76:1 against --color-brand, fails WCAG AA
    // (see scripts/color-contrast-audit.test.mjs). --color-solid-fill-foreground
    // is a fixed dark color (not theme-flipping, unlike --text-primary) —
    // deliberately fixed because --color-brand itself doesn't change across
    // light/dark/warm theme. Measures 6.95:1 in every theme.
    expect(tailwindConfig).toMatch(/["']primary-foreground["']\s*:\s*["']var\(--color-solid-fill-foreground\)["']/);
    expect(tailwindConfig).toMatch(/background:\s*["']var\(--bg-app\)["']/);
    expect(tailwindConfig).toMatch(/foreground:\s*["']var\(--text-primary\)["']/);
    expect(tailwindConfig).toMatch(/card:\s*["']var\(--bg-card\)["']/);
    expect(tailwindConfig).toMatch(/["']card-foreground["']\s*:\s*["']var\(--text-primary\)["']/);
    expect(tailwindConfig).toMatch(/muted:\s*["']var\(--bg-input\)["']/);
    expect(tailwindConfig).toMatch(/["']muted-foreground["']\s*:\s*["']var\(--text-muted\)["']/);
    expect(tailwindConfig).toMatch(/accent:\s*["']color-mix\(in srgb, var\(--text-primary\) 6%, var\(--bg-card\)\)["']/);
    expect(tailwindConfig).toMatch(/secondary:\s*["']color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-card\)\)["']/);
    expect(tailwindConfig).toMatch(/destructive:\s*["']var\(--color-danger\)["']/);
    // Was var(--color-danger-foreground) — that token is designed for the
    // *-subtle tint-background pattern (~4.45:1 there), not for sitting on
    // the solid --color-danger fill, where it only measured 1.47:1. Same
    // fixed dark token as primary-foreground above — measures 5.31:1 in
    // every theme.
    expect(tailwindConfig).toMatch(/["']destructive-foreground["']\s*:\s*["']var\(--color-solid-fill-foreground\)["']/);
    expect(tailwindConfig).toMatch(/border:\s*["']var\(--border-default\)["']/);
    expect(tailwindConfig).toMatch(/input:\s*["']var\(--border-card\)["']/);
    expect(tailwindConfig).toMatch(/ring:\s*["']var\(--color-brand-ring\)["']/);
    expect(tailwindConfig).toContain("preflight: false");
  });
});

describe("shadcn Vaul drawer wrapper", () => {
  it("provides stock DrawerContent/DrawerClose with app z-tokens", () => {
    expect(existsSync(uiDrawerPath)).toBe(true);
    const uiDrawer = readFileSync(uiDrawerPath, "utf8");
    expect(uiDrawer).toContain('from "vaul"');
    expect(uiDrawer).toContain("DrawerContent");
    expect(uiDrawer).toContain("DrawerClose");
    expect(uiDrawer).toContain("DrawerHeader");
    expect(uiDrawer).toContain("DrawerFooter");
    expect(uiDrawer).toContain("z-overlay");
    expect(uiDrawer).toContain("z-sheet");
    expect(uiDrawer).not.toContain("z-50");
  });
});

describe("Issue report FAB + composer token restyle", () => {
  it("does not hardcode emerald success colors or unbounded z-[9999]", () => {
    expect(fab).not.toContain("emerald-");
    expect(reportDrawer).not.toContain("emerald-");
    expect(fab).not.toContain("z-[9999]");
    expect(reportDrawer).not.toContain("z-[9999]");
  });

  it("uses design-system success tokens in the composer", () => {
    expect(reportDrawer).toMatch(/success-subtle|color-success-subtle|--color-success/);
  });

  it("uses a report-specific composer instead of a Vaul drawer for text entry", () => {
    expect(reportDrawer).not.toMatch(/from ["'].*ui\/drawer/);
    expect(reportDrawer).not.toContain('from "vaul"');
    expect(reportDrawer).not.toContain("DrawerContent");
    expect(reportDrawer).not.toContain("DrawerFooter");
    expect(reportDrawer).toContain('role="dialog"');
    expect(reportDrawer).toContain('aria-modal="true"');
    expect(reportDrawer).toContain("primary-btn");
    expect(reportDrawer).toContain("secondary-btn");
    expect(reportDrawer).not.toContain("issue-report-submit");
    expect(reportDrawer).not.toContain("whileHover");
  });

  it("keeps the FAB flat brand without glass chrome", () => {
    expect(fab).toContain("bg-primary");
    expect(fab).toContain("issue-report-fab");
    expect(fab).not.toContain("backdrop-blur");
  });
});
