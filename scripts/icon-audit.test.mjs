import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const EXCLUDE = new Set([
  "scripts/migrate-icons.mjs",
  "scripts/icon-audit.test.mjs",
  "js/icon-registry.js",
]);

const BI_CLASS = /\bbi bi-[a-z0-9-]+/i;
const BI_PREFIX = /\bbi-[a-z0-9-]+/i;
const BOOTSTRAP_CDN = /bootstrap-icons/i;

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

describe("icon audit", () => {
  it("has no Bootstrap Icons class usage in source", () => {
    const hits = findMatches(BI_CLASS);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no bootstrap-icons CDN references", () => {
    const hits = findMatches(BOOTSTRAP_CDN);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("has no legacy bi- icon keys in app source (except migration tooling)", () => {
    const hits = findMatches(BI_PREFIX).filter((rel) => !EXCLUDE.has(rel));
    expect(hits, hits.join(", ")).toEqual([]);
  });
});
