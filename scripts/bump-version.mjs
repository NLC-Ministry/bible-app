#!/usr/bin/env node
// scripts/bump-version.mjs
// 統一版本號管理工具
//
// 用法：
//   node scripts/bump-version.mjs <描述>
//   npm run bump -- my_feature_name
//
// 效果：
//   把 js/app.js 裡所有手動維護的 ?v=YYYYMMDD_... 字串
//   全部替換成同一個新版本號，並同步更新 index.html。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

const label = process.argv[2];
if (!label) {
  console.error("Error: Please provide a version label\nUsage: npm run bump -- <label>\nExample: npm run bump -- fix_login_bug");
  process.exit(1);
}

if (!/^[a-zA-Z0-9_-]+$/.test(label)) {
  console.error("Error: Label can only contain letters, numbers, underscores, hyphens");
  process.exit(1);
}

const newVersion = today() + "_" + label;
console.log("\nNew version: " + newVersion + "\n");

// 1. Update all static import ?v= strings in js/app.js
const appJsPath = join(ROOT, "js", "app.js");
let appJs = readFileSync(appJsPath, "utf8");

const STATIC_V_RE = /(\?v=)(\d{8}_[a-zA-Z0-9_-]+)(?=['"])/g;
const matches = [...appJs.matchAll(STATIC_V_RE)];

if (matches.length === 0) {
  console.warn("Warning: No static ?v=YYYYMMDD_ strings found in js/app.js");
} else {
  const oldVersions = [...new Set(matches.map(m => m[2]))];
  console.log("Found " + matches.length + " version strings (" + oldVersions.length + " unique):");
  oldVersions.forEach(v => console.log("  - " + v));
  appJs = appJs.replace(STATIC_V_RE, "$1" + newVersion);
  writeFileSync(appJsPath, appJs, "utf8");
  console.log("\njs/app.js: updated " + matches.length + " strings -> ?v=" + newVersion);
}

// 2. Update index.html app.js?v= string
const indexPath = join(ROOT, "index.html");
let indexHtml = readFileSync(indexPath, "utf8");

const HTML_V_RE = /(src="js\/app\.js\?v=)([^"]+)(")/;
const htmlMatch = indexHtml.match(HTML_V_RE);

if (!htmlMatch) {
  console.warn("Warning: No js/app.js?v= found in index.html");
} else {
  indexHtml = indexHtml.replace(HTML_V_RE, "$1" + newVersion + "$3");
  writeFileSync(indexPath, indexHtml, "utf8");
  console.log("index.html:  " + htmlMatch[2] + " -> " + newVersion);
}

// 3. Final consistency check
const finalJs = readFileSync(appJsPath, "utf8");
const finalMatches = [...finalJs.matchAll(STATIC_V_RE)];
const finalVersions = [...new Set(finalMatches.map(m => m[2]))];

console.log("\nConsistency check:");
if (finalVersions.length === 1 && finalVersions[0] === newVersion) {
  console.log("All " + finalMatches.length + " version strings are consistent -> " + newVersion);
} else {
  console.error("WARNING: Inconsistent version strings remain!");
  finalVersions.forEach(v => {
    const count = finalMatches.filter(m => m[2] === v).length;
    console.error("  - " + v + " (" + count + " occurrences)");
  });
}

console.log("\nDone! Remember to git commit this version bump.");
