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

describe("reading team icon action usage", () => {
  it("uses the shared icon-button primitive for icon-only reminder actions", () => {
    const reminderTags = [...teamRegistration.matchAll(/<button[^>]*class="[^"]*reading-team-remind-btn[^"]*"[^>]*>/g)].map(match => match[0]);
    expect(reminderTags.length).toBeGreaterThan(0);
    for (const tag of reminderTags) {
      expect(tag).toMatch(/class="[^"]*reading-team-remind-btn[^"]*icon-button/);
    }
    expect(teamCss).not.toMatch(/\.reading-team-remind-btn\s*\{[^}]*height:\s*36px/);
    expect(teamCss).not.toMatch(/\.reading-team-remind-btn\s*\{[^}]*width:\s*36px/);
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

const files = {
  html,
  plan,
  teamRegistration,
  onboardingHelper,
  responsiveDialog,
};

const openingTagPattern = /<(?!!|\/)[^>]+>/g;
const closeLabelPattern = /\baria-label\s*=\s*["'][^"']*(?:關閉|Close)[^"']*["']/i;
const stylePattern = /\bstyle\s*=\s*["']([^"']*)["']/i;
const widthPattern = /(?:width|inline-size)\s*:\s*\d+px\b/i;
const heightPattern = /(?:height|block-size)\s*:\s*\d+px\b/i;

const hasInlineCloseButtonChrome = source => [...source.matchAll(openingTagPattern)].some(([tag]) => {
  const style = tag.match(stylePattern)?.[1];
  return closeLabelPattern.test(tag) && style && widthPattern.test(style) && heightPattern.test(style);
});

const inlineCloseButtonChromeFixtures = [
  '<button aria-label="Close" style="width: 30px; height: 30px">',
  '<button style="height: 30px; width: 30px" aria-label="Close">',
];

describe("close button anti-regression guards", () => {
  it("detects inline close-button chrome regardless of attribute or property order", () => {
    for (const fixture of inlineCloseButtonChromeFixtures) {
      expect(hasInlineCloseButtonChrome(fixture)).toBe(true);
    }
  });

  it("does not add inline width/height close-button chrome in common UI files", () => {
    for (const [name, source] of Object.entries(files)) {
      expect(hasInlineCloseButtonChrome(source), name).toBe(false);
    }
  });

  it("does not use circular-action-btn for close or dismiss controls", () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/(關閉|Close)[\s\S]{0,240}circular-action-btn/);
      expect(source, name).not.toMatch(/circular-action-btn[\s\S]{0,240}(關閉|Close)/);
    }
  });

  it("keeps icon-only controls square under global touch target rules", () => {
    expect(css).toMatch(/\.icon-button\s*\{[\s\S]*inline-size:\s*44px[\s\S]*block-size:\s*44px[\s\S]*min-inline-size:\s*44px[\s\S]*min-block-size:\s*44px[\s\S]*aspect-ratio:\s*1/);
    expect(css).toMatch(/\.circular-action-btn\s*\{[\s\S]*width:\s*44px[\s\S]*height:\s*44px[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px[\s\S]*aspect-ratio:\s*1/);
  });
});
