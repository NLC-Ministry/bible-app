import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  it("parses as ESM so the reader can lazy-load and render verses", () => {
    const outDir = mkdtempSync(join(tmpdir(), "reader-module-syntax-"));
    try {
      execFileSync(
        "npx",
        ["esbuild", biblePath, "--format=esm", `--outfile=${join(outDir, "bible.js")}`],
        { cwd: root, stdio: "pipe" }
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("styles the load-retry state that replaces empty placeholder scripture", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    expect(css).toContain(".reader-load-retry-state {");
    expect(css).toContain(".reader-load-retry-state__button {");
  });
});
