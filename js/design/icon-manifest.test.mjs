import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIconRegistrySource } from "../../scripts/generate-icon-registry.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifestPath = join(root, "js/design/icon-manifest.json");
const registryPath = join(root, "js/design/icon-registry.js");

// Generate in memory only — running the generator here used to rewrite the tracked
// icon-registry.js on every test run (LF over a CRLF Windows checkout), leaving it
// "modified" in git status (#328).
describe("icon manifest registry", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const generated = buildIconRegistrySource(manifest);

  it("generates non-empty SVG for every manifest key with no duplicates", () => {
    const keys = Object.keys(manifest);
    expect(keys.length).toBeGreaterThan(40);
    expect(new Set(keys).size).toBe(keys.length);

    expect(generated).toContain("window.NLC_ICON_SVGS");
    const match = generated.match(/window\.NLC_ICON_SVGS = (\{[\s\S]*\});/);
    expect(match, "registry export parseable").toBeTruthy();
    const registry = JSON.parse(match[1]);

    for (const key of keys) {
      expect(registry[key], `missing SVG for ${key}`).toBeTruthy();
      expect(registry[key]).toContain("<svg");
      if (key.endsWith("Fill")) {
        expect(registry[key], `${key} should use solid fill`).toMatch(/fill="currentColor"/);
      }
    }
  });

  it("the committed icon-registry.js is up to date with icon-manifest.json", () => {
    const committed = readFileSync(registryPath, "utf8").replace(/\r\n/g, "\n");
    expect(committed === generated, "js/design/icon-registry.js is stale — run `node scripts/generate-icon-registry.mjs`").toBe(true);
  });
});
