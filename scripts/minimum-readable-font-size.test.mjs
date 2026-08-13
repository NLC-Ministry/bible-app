import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectSourceFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.(?:js|mjs)$/.test(name) ? [path] : [];
  });
}

const files = ["index.css", "index.html", ...collectSourceFiles("js")];
const fontSizePattern = /font-size\s*:\s*(\d*\.?\d+)(px|rem)/gi;

describe("minimum readable font size", () => {
  it("does not declare visible text below the 14px application baseline", () => {
    const violations = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(fontSizePattern)) {
        const pixels = Number(match[1]) * (match[2].toLowerCase() === "rem" ? 16 : 1);
        if (pixels < 14) violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
