import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const biblePath = join(root, "js/modules/bible.js");

function topLevelFunctionNames(source) {
  return [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map(match => match[1]);
}

describe("lazy-loaded reader module syntax", () => {
  it("declares each top-level function once so the browser can parse bible.js", () => {
    const names = topLevelFunctionNames(readFileSync(biblePath, "utf8"));
    const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    expect(duplicates).toEqual([]);
  });

  // esbuild 的 JS API 直接解析，不透過 `npx`（Windows 上叫 npx.cmd，execFileSync("npx") 會 ENOENT，#325）。
  it("parses as ESM so the reader can lazy-load and render verses", () => {
    expect(() => transformSync(readFileSync(biblePath, "utf8"), { format: "esm", loader: "js", sourcefile: biblePath }))
      .not.toThrow();
  });

  it("styles the load-retry state that replaces empty placeholder scripture", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    expect(css).toContain(".reader-load-retry-state {");
    expect(css).toContain(".reader-load-retry-state__button {");
  });
});
