// #418: Tailwind CSS is generated at build time by scanning source files (tailwind.config.cjs
// content globs), not the live DOM like the old play CDN. A class name assembled at runtime —
// `bg-${tone}` or "text-" + size — never appears whole in the source, so its rule is never
// generated and that screen silently loses its style. Write full class names (pick between
// complete strings) instead.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN_DIRS = ["js", "components", "lib"];
const EXTENSIONS = /\.(js|mjs|ts|tsx)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const UTILITY_PREFIX = String.raw`(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|rounded|p[xytrbl]?|m[xytrbl]?|w|h|min-w|min-h|max-w|max-h|gap|space-[xy]|z|top|left|right|bottom|inset|opacity|grid-cols|col-span|row-span|translate-[xy]|font|leading|tracking|outline|divide)`;
// `bg-${...}` inside a template literal, or "bg-" + expr / 'bg-' + expr
const DYNAMIC_CLASS = new RegExp(String.raw`(?:^|[\s"'\x60:])(?:[a-z-]+:)*${UTILITY_PREFIX}-(?:\$\{|["']\s*\+)`);

describe("Tailwind classes are written as full strings (#418)", () => {
  it("no utility class is assembled from a prefix + runtime value", () => {
    const offenders = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(root, dir))) {
        readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (DYNAMIC_CLASS.test(line)) offenders.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself catches the patterns it is meant to", () => {
    expect(DYNAMIC_CLASS.test("className={`p-2 bg-${tone}-100`}")).toBe(true);
    expect(DYNAMIC_CLASS.test(`el.className = "text-" + size;`)).toBe(true);
    expect(DYNAMIC_CLASS.test("`dark:bg-${tone}`")).toBe(true);
    expect(DYNAMIC_CLASS.test(`const cls = active ? "bg-primary" : "bg-card";`)).toBe(false);
    expect(DYNAMIC_CLASS.test("`flex gap-2 ${extra}`")).toBe(false);
  });
});
