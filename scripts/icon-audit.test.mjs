import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const EXCLUDE = new Set([
  "scripts/migrate-icons.mjs",
  "scripts/icon-audit.test.mjs",
  "scripts/generate-icon-registry.mjs",
  "js/icon-manifest.test.mjs",
  "js/icon-registry.js",
  "js/icons.js",
]);

const BI_CLASS = /\bbi bi-[a-z0-9-]+/i;
const BI_PREFIX = /\bbi-[a-z0-9-]+/i;
const BOOTSTRAP_CDN = /bootstrap-icons/i;
const ICON_PARK = /@icon-park\/svg/i;
const INLINE_SVG = /<svg\b/i;
const GOOGLE_BRAND_SVG = /fill="#4285F4"/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (/\.(js|html|css|mjs)$/.test(name)) acc.push(abs);
  }
  return acc;
}

function findMatches(pattern) {
  const hits = [];
  for (const abs of walk(root)) {
    const rel = relative(root, abs);
    if (EXCLUDE.has(rel)) continue;
    const content = readFileSync(abs, "utf8");
    if (pattern.test(content)) hits.push(rel);
    pattern.lastIndex = 0;
  }
  return hits;
}

function stripAllowedInlineSvgs(html) {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, (block) =>
      GOOGLE_BRAND_SVG.test(block) || /class="theme-icon-(?:sun|moon)"/.test(block) ? "" : block
    );
}

function findInlineSvgHits() {
  const hits = [];
  for (const abs of walk(root)) {
    const rel = relative(root, abs);
    if (EXCLUDE.has(rel)) continue;
    const content = readFileSync(abs, "utf8");
    if (!INLINE_SVG.test(content)) continue;
    if (rel === "index.html") {
      const withoutAllowed = stripAllowedInlineSvgs(content);
      if (!INLINE_SVG.test(withoutAllowed)) continue;
    }
    hits.push(rel);
    INLINE_SVG.lastIndex = 0;
  }
  return hits;
}

describe("icon audit", () => {
  it("has no Bootstrap Icons class usage in source", () => {
    const hits = findMatches(BI_CLASS);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no bootstrap-icons CDN references", () => {
    const hits = findMatches(BOOTSTRAP_CDN);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no IconPark package references in app source", () => {
    const hits = findMatches(ICON_PARK);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no legacy bi- icon keys in app source (except migration tooling)", () => {
    const hits = findMatches(BI_PREFIX).filter((rel) => !EXCLUDE.has(rel));
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no inline SVG icons outside the Lucide registry (except Google brand mark and theme toggle)", () => {
    const hits = findInlineSvgHits();
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("nlc-icon base rules keep glyph backgrounds transparent", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    const block = css.match(/\/\* Lucide icons[\s\S]*?\.search-icon-inside/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/\.nlc-icon\s*\{[\s\S]*?background:\s*transparent/);
    expect(block[0]).toMatch(/\.nlc-icon svg\s*\{[\s\S]*?background:\s*transparent/);
  });
});
