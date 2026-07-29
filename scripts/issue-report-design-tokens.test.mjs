import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const fab = readFileSync(join(root, "components/issue-report/SupportFab.tsx"), "utf8");
const drawer = readFileSync(join(root, "components/issue-report/ReportDrawer.tsx"), "utf8");

describe("Tailwind CDN design-token bridge", () => {
  it("maps shadcn semantic colors to Bible app CSS variables", () => {
    expect(html).toContain("tailwind.config");
    expect(html).toMatch(/primary:\s*["']var\(--color-brand\)["']/);
    expect(html).toMatch(/["']primary-foreground["']\s*:\s*["']#FFFFFF["']/);
    expect(html).toMatch(/background:\s*["']var\(--bg-app\)["']/);
    expect(html).toMatch(/foreground:\s*["']var\(--text-primary\)["']/);
    expect(html).toMatch(/card:\s*["']var\(--bg-card\)["']/);
    expect(html).toMatch(/["']card-foreground["']\s*:\s*["']var\(--text-primary\)["']/);
    expect(html).toMatch(/muted:\s*["']var\(--bg-input\)["']/);
    expect(html).toMatch(/["']muted-foreground["']\s*:\s*["']var\(--text-muted\)["']/);
    expect(html).toMatch(/accent:\s*["']color-mix\(in srgb, var\(--text-primary\) 6%, var\(--bg-card\)\)["']/);
    expect(html).toMatch(/secondary:\s*["']color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-card\)\)["']/);
    expect(html).toMatch(/destructive:\s*["']var\(--color-danger\)["']/);
    expect(html).toMatch(/["']destructive-foreground["']\s*:\s*["']var\(--color-danger-foreground\)["']/);
    expect(html).toMatch(/border:\s*["']var\(--border-default\)["']/);
    expect(html).toMatch(/input:\s*["']var\(--border-card\)["']/);
    expect(html).toMatch(/ring:\s*["']var\(--color-brand-ring\)["']/);
    expect(html).toContain("preflight: false");
  });
});

describe("Issue report FAB + drawer token restyle", () => {
  it("does not hardcode emerald success colors or unbounded z-[9999]", () => {
    expect(fab).not.toContain("emerald-");
    expect(drawer).not.toContain("emerald-");
    expect(fab).not.toContain("z-[9999]");
    expect(drawer).not.toContain("z-[9999]");
  });

  it("uses solid card surface and design-system success tokens in the drawer", () => {
    expect(drawer).not.toContain("bg-card/95");
    expect(drawer).toMatch(/success-subtle|color-success-subtle|--color-success/);
    expect(drawer).toMatch(/font-medium|type-weight-strong|font-\[var\(--type-weight-strong\)\]/);
  });

  it("uses a square shadcn icon Button for the drawer close control", () => {
    expect(drawer).toContain('from "../ui/button');
    expect(drawer).toContain('variant="ghost"');
    expect(drawer).toContain('size="icon"');
    expect(drawer).toContain('aria-label="關閉"');
    expect(drawer).toContain("absolute right-0 top-0");
    expect(drawer).toContain("text-muted-foreground");
    expect(drawer).toContain("hover:bg-transparent");
  });

  it("keeps the FAB flat brand without glass chrome", () => {
    expect(fab).toContain("bg-primary");
    expect(fab).toContain("issue-report-fab");
    expect(fab).not.toContain("backdrop-blur");
  });
});
