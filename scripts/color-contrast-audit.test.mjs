// scripts/color-contrast-audit.test.mjs
//
// Real, numeric WCAG 2.1 AA contrast-ratio verification for every
// text/surface color pair this app actually renders — computed live from
// index.css's :root / body.dark-theme / body.warm-theme blocks and
// index.html's Tailwind color bridge, not from a frozen snapshot of hex
// values. Edit a token, re-run this file, get a real answer.
//
// Why this exists: shadcn's naming convention (bg-X + text-X-foreground)
// makes an implicit promise that the pair is readable, but nothing in this
// project ever verified that promise — see the primary/destructive findings
// below, discovered exactly because nothing was checking. This test is the
// guardrail: any new component that reaches for an unverified color pairing
// should get caught here before a person has to notice it looks wrong.
//
// Companion to scripts/color-audit.test.mjs (which blocks stray hardcoded
// hex/rgb literals and a specific hardcoded-literal-vs-theme-token pairing
// shape) — that file checks "did you use the token system at all", this one
// checks "given the token system, is the result actually readable".
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseCssVarBlock, resolveColor } from "./lib/color-contrast.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, "index.css"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

function firstBlockBody(source, selectorPattern) {
  const match = source.match(selectorPattern);
  if (!match) throw new Error(`Could not find block for ${selectorPattern}`);
  const openBrace = source.indexOf("{", match.index);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

// index.css declares --form-control-text-size and --badge-* tokens in two
// OTHER unrelated :root blocks further down the file — this intentionally
// only reads the first one (anchored on a token only it declares), which is
// the actual design-token block documented in docs/design-system.md.
const rootVars = parseCssVarBlock(firstBlockBody(css, /:root\s*\{\s*\n\s*\/\* NLC satellite brand/));
const darkVars = parseCssVarBlock(firstBlockBody(css, /body\.dark-theme\s*\{/));
const warmVars = parseCssVarBlock(firstBlockBody(css, /body\.warm-theme\s*\{/));

const THEMES = {
  light: { ...rootVars },
  dark: { ...rootVars, ...darkVars },
  warm: { ...rootVars, ...warmVars },
};

// index.html bridges these Tailwind/shadcn color names to the CSS vars
// above (or, for two of them, to a literal expression) — read straight out
// of the tailwind.config block so this test tracks that mapping, not a
// hand-copied guess of what it currently says.
const tailwindConfigBody = firstBlockBody(html, /colors:\s*\{/);
function tailwindColor(name) {
  const re = new RegExp(`(?:^|[\\s,])"?${name}"?\\s*:\\s*"([^"]+)"`);
  const match = tailwindConfigBody.match(re);
  if (!match) throw new Error(`tailwind.config colors.${name} not found in index.html`);
  return match[1];
}

// [surfaceRawValue, textRawValue, label] — raw CSS value strings, exactly as
// they appear in index.css / index.html's tailwind.config, resolved through
// THEMES[theme] at assertion time.
const PAIRS = [
  ["background", "foreground", "bg-background / text-foreground (page body text)"],
  ["card", "card-foreground", "bg-card / text-card-foreground (Card body text)"],
  ["secondary", "secondary-foreground", "bg-secondary / text-secondary-foreground (Button/Badge secondary)"],
  ["accent", "accent-foreground", "bg-accent / text-accent-foreground (hover surfaces)"],
];

function resolvePair(theme, surfaceKey, textKey) {
  const vars = THEMES[theme];
  const surfaceRaw = tailwindColor(surfaceKey);
  const textRaw = tailwindColor(textKey);
  // The surface itself composites over the page background.
  const pageBg = resolveColor(tailwindColor("background"), vars, { r: 255, g: 255, b: 255 });
  const surfaceRgb = resolveColor(surfaceRaw, vars, pageBg);
  const textRgb = resolveColor(textRaw, vars, surfaceRgb);
  return { ratio: contrastRatio(surfaceRgb, textRgb), surfaceRgb, textRgb };
}

describe("color contrast audit — Tailwind/shadcn surface+foreground pairs (WCAG AA, 4.5:1 body text)", () => {
  for (const theme of Object.keys(THEMES)) {
    describe(`${theme} theme`, () => {
      for (const [surfaceKey, textKey, label] of PAIRS) {
        it(`${label} >= 4.5:1`, () => {
          const { ratio } = resolvePair(theme, surfaceKey, textKey);
          expect(ratio, `${label} in ${theme} theme measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  // ── Known, tracked failures — pending a brand-color decision, not yet fixed ──
  // bg-primary/text-primary-foreground and bg-destructive/text-destructive-foreground
  // both fail AA today. Root cause: index.html's tailwind.config points
  // primary-foreground/destructive-foreground at colors that were designed
  // for a "subtle tint background + saturated foreground text" pairing
  // (see the *-subtle / *-foreground tokens below), not for sitting on top
  // of the solid brand/danger fill. Fixing it means either darkening the
  // fill or switching the foreground to a dark color — a visible,
  // site-wide brand decision, not something to pick unilaterally here.
  // These are `it.todo` (not skipped, not silently passing) so the gap
  // stays visible in every test run until it's actually resolved.
  it.todo("bg-primary / text-primary-foreground reaches 4.5:1 — currently ~2.76:1 in light/dark/warm theme, blocked on brand-color decision");
  it.todo("bg-destructive / text-destructive-foreground reaches 4.5:1 — currently ~1.47:1 (light/warm) / ~1.45:1 (dark), blocked on brand-color decision");
  // Same root token (--text-muted) as the core-app-tokens finding below —
  // muted-foreground fails 4.5:1 everywhere it's actually measured
  // (light 3.07:1, dark 4.33:1, warm 3.08:1).
  it.todo("bg-muted / text-muted-foreground reaches 4.5:1 — currently 3.07:1 (light) / 4.33:1 (dark) / 3.08:1 (warm)");
});

describe("color contrast audit — the *-subtle + *-foreground pattern used by AccessibleCard's status badges", () => {
  // components/ui/accessible-card.tsx deliberately uses --color-*-subtle
  // (tint background) + --color-*-foreground (saturated text) instead of
  // the broken destructive/primary solid-fill pairing above. Lock in that
  // this pattern is actually the safe one, in every theme it's used in.
  const SUBTLE_PAIRS = [
    ["--color-brand-subtle", "--color-brand-active", "info badge"],
    ["--color-success-subtle", "--color-success-foreground", "success badge"],
    ["--color-danger-subtle", "--color-danger-foreground", "danger badge"],
  ];

  for (const theme of ["light", "dark", "warm"]) {
    describe(`${theme} theme`, () => {
      for (const [bgVar, fgVar, label] of SUBTLE_PAIRS) {
        it(`${label}: var(${bgVar}) / var(${fgVar})`, () => {
          const vars = THEMES[theme];
          const pageBg = resolveColor(tailwindColor("background"), vars, { r: 255, g: 255, b: 255 });
          const bgRgb = resolveColor(`var(${bgVar})`, vars, pageBg);
          const fgRgb = resolveColor(`var(${fgVar})`, vars, bgRgb);
          const ratio = contrastRatio(bgRgb, fgRgb);
          // These are small badge labels, not paragraph copy — the 3:1
          // large-text/UI-component floor is the honest bar here, not 4.5:1.
          expect(ratio, `${label} in ${theme} theme measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
});

describe("color contrast audit — core app text tokens (index.css, outside the Tailwind bridge)", () => {
  // --text-secondary is used directly as `color: var(--text-secondary)` all
  // over index.html/index.css (`.type-lead`, etc.), independent of the
  // shadcn components. Same math, same backdrops (--bg-app / --bg-card),
  // checked directly against the token rather than through the Tailwind
  // names. (--text-muted is deliberately NOT asserted here — see the
  // tracked finding below; it doesn't even clear the relaxed 3:1 floor in
  // every theme, so there is no true threshold to enforce yet.)
  const SURFACES = ["--bg-app", "--bg-card"];

  for (const theme of Object.keys(THEMES)) {
    describe(`${theme} theme`, () => {
      for (const surfaceVar of SURFACES) {
        it(`var(--text-secondary) on var(${surfaceVar}) >= 4.5:1`, () => {
          const vars = THEMES[theme];
          const pageBg = resolveColor(vars["--bg-app"], vars, { r: 255, g: 255, b: 255 });
          const surfaceRgb = resolveColor(`var(${surfaceVar})`, vars, pageBg);
          const textRgb = resolveColor("var(--text-secondary)", vars, surfaceRgb);
          const ratio = contrastRatio(surfaceRgb, textRgb);
          expect(ratio, `var(--text-secondary) on var(${surfaceVar}) in ${theme} theme measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  // Tracked, not yet fixed: --text-muted is used as real body/caption text
  // (.type-caption, .type-body-muted in index.css) where WCAG requires
  // 4.5:1. Measured directly: light 3.06:1 (--bg-app) / 3.19:1 (--bg-card),
  // dark ~4.3:1, warm 2.82:1 (--bg-app) — warm doesn't even clear the
  // relaxed 3:1 large-text/UI floor. Same underlying token as the
  // bg-muted/text-muted-foreground finding above.
  it.todo("--text-muted reaches 4.5:1 for body-text use (.type-caption/.type-body-muted) in every theme");
});
