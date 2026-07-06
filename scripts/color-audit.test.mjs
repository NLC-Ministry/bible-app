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
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
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
  });

  it("blocks hardcoded mint (#66F78F) outside token definition files", () => {
    const hits = scanPattern(CANONICAL_MINT, TOKEN_FILES);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("blocks Tailwind legacy hex outside allowlisted files", () => {
    const hits = [];
    for (const pattern of LEGACY_TAILWIND_HEX) {
      for (const rel of scanPattern(pattern, TOKEN_FILES)) {
        if (ALLOWLIST_FILES.has(rel)) continue;
        hits.push(`${rel}: ${pattern.source}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

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
});
