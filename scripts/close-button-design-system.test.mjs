import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("index.css");
const html = read("index.html");
const designSystem = read("docs/design-system.md");

describe("close button design system", () => {
  it("defines a central square icon-button primitive", () => {
    expect(css).toContain(".icon-button {");
    expect(css).toContain("inline-size: 44px");
    expect(css).toContain("block-size: 44px");
    expect(css).toContain("min-inline-size: 44px");
    expect(css).toContain("min-block-size: 44px");
    expect(css).toContain("aspect-ratio: 1");
    expect(css).toContain(".dialog-close-button");
  });

  it("documents close-button primitives and anti-patterns", () => {
    expect(designSystem).toContain("Close / dismiss controls");
    expect(designSystem).toContain("Use `.dialog-close-button.icon-button`");
    expect(designSystem).toContain("Do not use `.circular-action-btn` for dialog close buttons");
    expect(designSystem).toContain("Do not inline width/height on close buttons");
  });
});

describe("static close button usage", () => {
  it("does not use circular-action-btn for close buttons", () => {
    expect(html).not.toMatch(/id="btn-close-plan-team-invite"[^>]*class="[^"]*circular-action-btn/);
    expect(html).not.toMatch(/aria-label="[^"]*關閉[^"]*"[^>]*class="[^"]*circular-action-btn/);
  });

  it("uses the central icon button primitive for static close controls", () => {
    expect(html).toContain('id="btn-close-plan-team-invite"');
    expect(html).toMatch(/id="btn-close-plan-team-invite"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(html).toMatch(/id="typography-sheet-close-btn"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(html).toMatch(/id="btn-close-bottom-sheet"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
  });

  it("keeps bottom-sheet close controls square through the shared primitive", () => {
    expect(css).toContain(".bottom-sheet-close-x");
    expect(css).toContain(".bottom-sheet-close-btn");
    expect(css).not.toMatch(/\.bottom-sheet-close-x\s*\{[^}]*width:\s*32px/);
  });
});

const plan = read("js/modules/plan.js");
const teamRegistration = read("js/modules/team-registration.js");
const onboardingHelper = read("js/modules/onboarding-helper.js");
const teamCss = read("css/team-registration.css");

describe("dynamic close button usage", () => {
  it("does not generate close buttons with circular-action-btn or inline square sizing", () => {
    expect(plan).not.toMatch(/aria-label="關閉"[\s\S]{0,180}class="[^"]*circular-action-btn/);
    expect(plan).not.toMatch(/aria-label="關閉"[\s\S]{0,220}width:\s*\d+px;\s*height:\s*\d+px/);
    expect(plan).not.toContain('style="position:absolute;top:1rem;right:1rem;width:30px;height:30px');
  });

  it("uses the central primitive for dynamic close controls", () => {
    expect(plan).toMatch(/id="plan-details-x-btn"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(plan).toMatch(/aria-label="關閉"[^>]*class="[^"]*dialog-close-button[^"]*icon-button/);
    expect(teamRegistration).toContain("dialog-close-button icon-button");
    expect(onboardingHelper).toContain("dialog-close-button icon-button");
  });

  it("does not keep a separate reading-team close button sizing system", () => {
    expect(teamCss).not.toContain(".reading-team-close {");
  });
});

const responsiveDialog = read("components/ui/ResponsiveDialog.tsx");

describe("React close button usage", () => {
  it("uses existing shadcn Button for ResponsiveDialog close chrome", () => {
    expect(responsiveDialog).toContain('import { Button } from "@/components/ui/button"');
    expect(responsiveDialog).toContain('import { X } from "lucide-react"');
    expect(responsiveDialog).toContain('<Button');
    expect(responsiveDialog).toContain('variant="ghost"');
    expect(responsiveDialog).toContain('size="icon"');
    expect(responsiveDialog).toContain("<X");
    expect(responsiveDialog).toContain('data-testid="responsive-dialog-close-btn"');
    expect(responsiveDialog).not.toContain("w-8 h-8 flex items-center justify-center");
  });
});
