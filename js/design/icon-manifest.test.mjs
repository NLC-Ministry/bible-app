import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifestPath = join(root, "js/design/icon-manifest.json");
const registryPath = join(root, "js/design/icon-registry.js");

describe("icon manifest registry", () => {
  it("generates non-empty SVG for every manifest key with no duplicates", () => {
    execSync("node scripts/generate-icon-registry.mjs", { cwd: root, stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const keys = Object.keys(manifest);
    expect(keys.length).toBeGreaterThan(40);
    expect(new Set(keys).size).toBe(keys.length);

    const registrySrc = readFileSync(registryPath, "utf8");
    expect(registrySrc).toContain("window.NLC_ICON_SVGS");

    const match = registrySrc.match(/window\.NLC_ICON_SVGS = (\{[\s\S]*\});/);
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
});
