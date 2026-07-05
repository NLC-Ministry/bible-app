import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const TOKEN_FILES = new Set([
  "index.css",
  "js/design-tokens.js",
  "docs/design-system.md",
]);

const EXCLUDE = new Set(["scripts/color-audit.test.mjs"]);

const LEGACY_GREEN = /#10b981|rgba\(\s*16\s*,\s*185\s*,\s*129/gi;
const CANONICAL_MINT = /#66F78F/gi;

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
    const rel = relative(root, abs);
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
});
