// scripts/bundle.test.mjs
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveLocalAssets, concatScripts, contentHash, emitBundle } from "./bundle.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe("resolveLocalAssets", () => {
  it("returns local scripts in document order, external excluded, queries stripped", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn/x.css">
      <link rel="stylesheet" href="index.css?v=abc">
      <script src="https://cdn/lib.js"></script>
      <script src="config.js?v=1"></script>
      <script src="js/state.js?v=2"></script>`;
    const out = resolveLocalAssets(html);
    expect(out.scripts).toEqual(["config.js", "js/state.js"]);
    expect(out.stylesheet).toBe("index.css");
  });

  it("resolves the real index.html to the exact 16-file order", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const { scripts } = resolveLocalAssets(html);
    expect(scripts).toEqual([
      "config.js", "js/data/bible_data.js", "js/data/bible_verse_counts.js",
      "js/copy/zh-Hant.js", "js/design-tokens.js", "js/state.js", "js/auth.js",
      "js/views/plan.js", "js/db.js", "js/utils.js", "js/gamification.js",
      "js/views/dashboard.js", "js/views/reader.js", "js/views/stats.js",
      "js/views/profile.js", "js/main.js",
    ]);
  });
});

describe("concatScripts", () => {
  it("joins file contents in order with ASI-safe separators", () => {
    const read = (p) => ({ "a.js": "var a=1", "b.js": "var b=2" })[p];
    expect(concatScripts(["a.js", "b.js"], read)).toBe("var a=1\n;\nvar b=2");
  });
});

describe("contentHash", () => {
  it("is deterministic and 8 hex chars", () => {
    const h = contentHash("hello");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(h).toBe(contentHash("hello"));
    expect(h).not.toBe(contentHash("world"));
  });
});

describe("emitBundle (integration, real repo)", () => {
  it("produces one hashed JS bundle + hashed CSS and a rewritten index.html", () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-"));
    try {
      const { jsFile, cssFile } = emitBundle({ root, outDir: out });
      // hashed filenames
      expect(jsFile).toMatch(/^app\.[0-9a-f]{8}\.js$/);
      expect(cssFile).toMatch(/^index\.[0-9a-f]{8}\.css$/);
      expect(existsSync(join(out, jsFile))).toBe(true);
      expect(existsSync(join(out, cssFile))).toBe(true);
      // rewritten HTML: exactly one app script tag, no leftover local js/ tags
      const html = rf(join(out, "index.html"), "utf8");
      expect(html).toContain(`<script src="/${jsFile}"></script>`);
      expect(html).not.toMatch(/<script\s+src="js\//);
      expect(html).not.toMatch(/<script\s+src="config\.js/);
      expect(html).toContain(`href="/${cssFile}"`);
      // assets copied
      expect(existsSync(join(out, "manifest.json"))).toBe(true);
      expect(readdirSync(join(out, "assets")).length).toBeGreaterThan(0);
      // byte-identity: main.js body present verbatim in the bundle
      const bundle = rf(join(out, jsFile), "utf8");
      const mainSrc = rf(join(root, "js/main.js"), "utf8");
      expect(bundle.includes(mainSrc)).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
