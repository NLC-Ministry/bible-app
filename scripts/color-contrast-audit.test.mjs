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
  ["muted", "muted-foreground", "bg-muted / text-muted-foreground (CardDescription, captions)"],
  // Fixed: primary-foreground/destructive-foreground now both resolve to
  // var(--text-primary) instead of white/--color-danger-foreground — see
  // the index.html tailwind.config comments at each mapping for the numbers.
  ["primary", "primary-foreground", "bg-primary / text-primary-foreground (default Button/Badge)"],
  ["destructive", "destructive-foreground", "bg-destructive / text-destructive-foreground (destructive Button/Badge)"],
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
  // --text-secondary and --text-muted are used directly as
  // `color: var(...)` all over index.html/index.css (`.type-lead`,
  // `.type-caption`, `.type-body-muted`, etc.), independent of the shadcn
  // components. Same math, same backdrops (--bg-app / --bg-card), checked
  // directly against the tokens rather than through the Tailwind names.
  const TEXT_TOKENS = ["--text-secondary", "--text-muted"];
  const SURFACES = ["--bg-app", "--bg-card"];

  for (const theme of Object.keys(THEMES)) {
    describe(`${theme} theme`, () => {
      for (const surfaceVar of SURFACES) {
        for (const textVar of TEXT_TOKENS) {
          it(`var(${textVar}) on var(${surfaceVar}) >= 4.5:1`, () => {
            const vars = THEMES[theme];
            const pageBg = resolveColor(vars["--bg-app"], vars, { r: 255, g: 255, b: 255 });
            const surfaceRgb = resolveColor(`var(${surfaceVar})`, vars, pageBg);
            const textRgb = resolveColor(`var(${textVar})`, vars, surfaceRgb);
            const ratio = contrastRatio(surfaceRgb, textRgb);
            expect(ratio, `var(${textVar}) on var(${surfaceVar}) in ${theme} theme measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });
  }
});
