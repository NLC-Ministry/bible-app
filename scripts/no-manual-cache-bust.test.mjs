import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// JS and CSS reach production only through scripts/bundle.mjs: the entries and
// stylesheet are content-hashed (app.<hash>.js, index.<hash>.css) and lazy
// modules become hashed chunks (dist/chunks/). A hand-maintained ?v= on an
// import or <script>/<link> tag therefore does nothing in production. It was
// also the thing people forgot to bump, so it must not come back.
// (?v= on images under assets/ is different and stays: those are not hashed.)
const SPECIFIER_WITH_V = /\.(?:js|mjs|css)\?v=/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe("no manual ?v= cache-busting on JS/CSS", () => {
  it("HTML entry points reference scripts and stylesheets without ?v=", () => {
    for (const page of ["index.html", "exam.html", "grade.html"]) {
      expect(readFileSync(page, "utf8"), page).not.toMatch(SPECIFIER_WITH_V);
    }
  });

  it("no JS module imports another with ?v=", () => {
    const files = [...sourceFiles("js"), "sw.js"];
    const offenders = files.filter(file => SPECIFIER_WITH_V.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the manual bump script is gone", () => {
    expect(existsSync("scripts/bump-version.mjs")).toBe(false);
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts.bump).toBeUndefined();
  });
});
