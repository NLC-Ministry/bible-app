import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// 被測試 import 的模組不能有 shebang（#!/usr/bin/env node）。Windows 的
// core.autocrlf=true 會把它 checkout 成 "#!...\r\n"，vitest 就載入失敗
// （SyntaxError: Invalid or unexpected token），整個測試檔一個都沒跑；
// CI 是 Linux（LF）所以只有本機壞（#471）。CLI 腳本一律用 `node <path>` 執行。
// 只當文字讀、沒有被 import 的腳本（例如 scripts/migrate-icons.mjs）不受限。
const ROOTS = ["scripts", "js", "components"];
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

function testFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(path);
    return /\.test\.(?:mjs|js|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function importedModules() {
  const seen = new Set();
  const queue = ROOTS.flatMap(testFiles);
  while (queue.length) {
    const file = queue.pop();
    for (const [, spec] of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = resolve(dirname(file), spec);
      if (!/\.(?:mjs|js)$/.test(target) || seen.has(target) || !existsSync(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

describe("modules imported by tests have no shebang (#471)", () => {
  it("finds the commentary-import modules through the test graph", () => {
    const found = importedModules().map(path => relative(process.cwd(), path).split(sep).join("/"));
    expect(found).toContain("scripts/commentary-import/extract.mjs");
  });

  it("none of them start with #!", () => {
    const offenders = importedModules()
      .filter(path => readFileSync(path, "utf8").startsWith("#!"))
      .map(path => relative(process.cwd(), path).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
