import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const TOKEN_FILES = new Set([
  "index.css",
  "js/design/design-tokens.js",
  "docs/design-system.md",
]);

const EXCLUDE = new Set(["scripts/color-audit.test.mjs"]);

const LEGACY_GREEN = /#10b981|rgba\(\s*16\s*,\s*185\s*,\s*129/gi;
const CANONICAL_MINT = /#66F78F/gi;

const LEGACY_TAILWIND_HEX = [
  /#ef4444/gi,
  /#3b82f6/gi,
  /#ff4757/gi,
  /#f43f5e/gi,
  /#64748b/gi,
  /#94a3b8/gi,
  /#e2e8f0/gi,
  /#cbd5e1/gi,
];

const ALLOWLIST_FILES = new Set([
  "index.html", // Google SSO SVG brand colors, highlighter presets
  "js/views/reader.js", // highlighter preset colors on verses
  "js/views/dashboard.js", // NLC round palette + canvas via NLC_DESIGN
]);

const INLINE_STYLE_COLOR_HEX =
  /style\s*=\s*["'][^"']*(?:color|background(?:-color)?)\s*:\s*[^"']*#[0-9a-f]{3,8}/gi;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git" || name === ".worktrees" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (/\.(js|css|html|mjs)$/.test(name)) acc.push(abs);
  }
  return acc;
}

function scanPattern(pattern, allowFiles = null) {
  const hits = [];
  for (const abs of walk(root)) {
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (EXCLUDE.has(rel)) continue;
    if (allowFiles && allowFiles.has(rel)) continue;
    const content = readFileSync(abs, "utf8");
    if (pattern.test(content)) hits.push(rel);
    pattern.lastIndex = 0;
  }
  return hits;
}

describe("color audit", () => {
  it("blocks legacy emerald greens outside token definition files", () => {
    const hits = scanPattern(LEGACY_GREEN);
    expect(hits, hits.join(", ")).toEqual([]);
  }, 20000);

  it("blocks hardcoded mint (#66F78F) outside token definition files", () => {
    const hits = scanPattern(CANONICAL_MINT, TOKEN_FILES);
    expect(hits, hits.join(", ")).toEqual([]);
  }, 20000);

  it("blocks Tailwind legacy hex outside allowlisted files", () => {
    const hits = [];
    for (const pattern of LEGACY_TAILWIND_HEX) {
      for (const rel of scanPattern(pattern, TOKEN_FILES)) {
        if (ALLOWLIST_FILES.has(rel)) continue;
        hits.push(`${rel}: ${pattern.source}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  }, 20000);

  it("blocks inline style color/background hex in js/modules templates", () => {
    const hits = [];
    for (const abs of walk(join(root, "js/modules"))) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      const content = readFileSync(abs, "utf8");
      if (INLINE_STYLE_COLOR_HEX.test(content)) hits.push(rel);
      INLINE_STYLE_COLOR_HEX.lastIndex = 0;
    }
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("honor badge icon rules use opaque icon tokens and transparent glyph backgrounds", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    const iconBlock = css.match(/\.honor-badge-item__icon[\s\S]*?\.honor-badge-item__title/);
    expect(iconBlock).toBeTruthy();
    expect(iconBlock[0]).not.toMatch(/--text-muted|--text-secondary/);
    expect(iconBlock[0]).toMatch(/background:\s*transparent/);
    expect(iconBlock[0]).not.toMatch(/background:\s*var\(--bg-card\)/);
    const lockRule = css.match(/\.honor-badge-item__lock\s*\{[^}]+\}/);
    expect(lockRule, ".honor-badge-item__lock").toBeTruthy();
    expect(lockRule[0]).not.toMatch(/opacity\s*:/);
  });

  it("mobile nav icons use opaque icon tokens", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    expect(css).toMatch(/\.mobile-nav-btn \.nlc-icon[\s\S]*?--color-icon-muted/);
    expect(css).toMatch(/\.mobile-nav-btn\.active \.nlc-icon[\s\S]*?--color-icon-brand/);
  });

  it("never references --primary-hover, a token that has never been declared anywhere", () => {
    // Regression: .congrats-upgrade-btn's background was
    // linear-gradient(135deg, var(--primary-color), var(--primary-hover)).
    // --primary-hover was never defined in :root or any theme block — an
    // unresolvable var() with no fallback invalidates the WHOLE `background`
    // shorthand, so the button rendered fully transparent. That read as
    // invisible white button text in light theme (the modal behind it is
    // white) and happened to still look fine in dark theme (dark modal
    // behind it), which is why it only got reported for light mode.
    const css = readFileSync(join(root, "index.css"), "utf8");
    expect(css).not.toContain("--primary-hover");
  });
});

// ── Theme-contrast regressions ──────────────────────────────────────────
// A recurring bug class in this app: a component pairs a hardcoded literal
// color/background (hex, rgb()/rgba(), or a named color) with the OTHER
// side of the pairing left as a theme token (var(--text-*) / var(--bg-*)).
// The pairing can look fine in whichever theme it was designed against and
// become low/zero contrast in the other two. See supabase-free fixes for
// #global-search-overlay, #reader-view .floating-nav-btn, and
// .plan-inline-footer (all previously hardcoded rgba(15, 23, 42, ...) dark
// navy chrome behind var(--text-primary) text).
describe("theme contrast regressions", () => {
  const css = readFileSync(join(root, "index.css"), "utf8");
  const html = readFileSync(join(root, "index.html"), "utf8");

  it("keeps the fixed dark-navy chrome literal out of the search overlay", () => {
    // rgba(15, 23, 42, 0.72) caused the #global-search-overlay bug and had
    // no other legitimate use in the file at the time of the fix.
    expect(css).not.toContain("background: rgba(15, 23, 42, 0.72)");
  });

  it("keeps the search overlay chrome and input on theme surface tokens", () => {
    expect(css).toMatch(/\.bible-native-overlay-header,\s*\n\.search-header,\s*\n\.segmented-control,\s*\n\.mode-selector-bar\s*\{\s*\n\s*background:\s*var\(--bg-card\)/);
    expect(css).toMatch(/\.search-input-field\s*\{\s*\n\s*background:\s*color-mix\(in srgb, var\(--text-primary\)/);
  });

  it("keeps the reader floating nav buttons on a theme-derived background", () => {
    // Anchored on a leading newline so this only matches the standalone
    // `#reader-view .floating-nav-btn { ... }` rule, not the substring
    // inside `body.reader-modal-open #reader-view .floating-nav-btn { ... }`.
    const floatingNavBlock = css.match(/\n#reader-view \.floating-nav-btn \{([^}]+)\}/);
    expect(floatingNavBlock, "#reader-view .floating-nav-btn rule").toBeTruthy();
    expect(floatingNavBlock[1]).toMatch(/background:\s*color-mix\(in srgb, var\(--bg-card\)/);
    expect(floatingNavBlock[1]).not.toMatch(/background:\s*rgba\(/);
  });

  it("keeps the plan inline reader footer on a theme surface token", () => {
    expect(html).not.toContain("background: rgba(15, 23, 42, 0.95)");
    expect(html).toContain('class="plan-inline-footer"');
    const footerMatch = html.match(/<div class="plan-inline-footer"\s*\n\s*style="([^"]*)"/);
    expect(footerMatch, ".plan-inline-footer style attribute").toBeTruthy();
    expect(footerMatch[1]).toContain("background: var(--bg-card)");
  });

  // Forward-looking heuristic: the three bugs this guards against all had
  // the same shape — a literal background paired with `color: var(--text-primary
  // | --text-secondary)` (or the mirror: a literal text color sat on
  // `background: var(--bg-app|--bg-card|--bg-input)`). Those two text tokens
  // flip between near-black and near-white across themes, and those three bg
  // tokens flip between near-white and near-black to match — pairing either
  // with a literal on the *other* property is what breaks contrast in two
  // out of three themes. `--text-muted`/`--text-secondary`-as-a-*background*
  // (e.g. a solid rank-badge fill) is intentionally NOT flagged: those tokens
  // are engineered as usable mid-tone fills in every theme, not black/white
  // extremes, so pairing them with a fixed white/black glyph is normal and
  // safe (see `.rank-number`). Token-definition blocks (:root and the
  // theme-class blocks) are exempt since that's where the literals belong.
  const THEME_SELECTOR_RE = /^(:root|body\.(light|dark|warm)-theme)$/;
  const COLOR_PROP_RE = /(^|[;{])\s*(color|background|background-color)\s*:\s*([^;{}]+?)\s*(?=;|$)/gi;
  const LITERAL_VALUE_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|white|black|navy|gray|grey)\b/i;
  const TEXT_FLIP_TOKEN_RE = /var\(--text-(primary|secondary)\)/i;
  const BG_FLIP_TOKEN_RE = /var\(--bg-(app|card|input)\)/i;

  function isRiskyPair(declarations) {
    const color = declarations.color;
    const background = declarations.background;
    const literalBg = background && LITERAL_VALUE_RE.test(background);
    const literalColor = color && LITERAL_VALUE_RE.test(color);
    const flipTextColor = color && TEXT_FLIP_TOKEN_RE.test(color);
    const flipBgToken = background && BG_FLIP_TOKEN_RE.test(background);
    return (literalBg && flipTextColor) || (literalColor && flipBgToken);
  }

  function extractRuleBlocks(source) {
    const blocks = [];
    let i = 0;
    while (i < source.length) {
      const openBrace = source.indexOf("{", i);
      if (openBrace === -1) break;
      // Selector text is everything since the last '}' (or start) up to '{'.
      const selectorStart = source.lastIndexOf("}", openBrace - 1) + 1;
      const selector = source.slice(selectorStart, openBrace).trim();
      const closeBrace = source.indexOf("}", openBrace);
      if (closeBrace === -1) break;
      const body = source.slice(openBrace + 1, closeBrace);
      // Skip at-rule wrappers (@media/@keyframes/@font-face preludes) — only
      // keep blocks whose body looks like plain declarations, not nested rules.
      if (!selector.startsWith("@") && !body.includes("{")) {
        blocks.push({ selector, body });
      }
      i = closeBrace + 1;
    }
    return blocks;
  }

  function readDeclarations(body) {
    const declarations = {};
    let match;
    COLOR_PROP_RE.lastIndex = 0;
    while ((match = COLOR_PROP_RE.exec(body))) {
      const prop = match[2].toLowerCase() === "background-color" ? "background" : match[2].toLowerCase();
      declarations[prop] = match[3].trim();
    }
    return declarations;
  }

  it("does not pair a hardcoded literal background with var(--text-primary|secondary), or a literal text color with var(--bg-app|card|input), in the same CSS rule", () => {
    const hits = [];
    for (const { selector, body } of extractRuleBlocks(css)) {
      if (THEME_SELECTOR_RE.test(selector)) continue;
      if (isRiskyPair(readDeclarations(body))) hits.push(selector);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("does not pair a hardcoded literal background with var(--text-primary|secondary), or a literal text color with var(--bg-app|card|input), in the same inline style attribute", () => {
    const hits = [];
    const STYLE_ATTR_RE = /style\s*=\s*"([^"]*)"/gi;
    let match;
    while ((match = STYLE_ATTR_RE.exec(html))) {
      const style = match[1];
      if (isRiskyPair(readDeclarations(style))) hits.push(style.slice(0, 120));
    }
    expect(hits, hits.join("\n---\n")).toEqual([]);
  });
});
