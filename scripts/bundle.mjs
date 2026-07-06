// scripts/bundle.mjs
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  unlinkSync,
  rmdirSync,
  copyFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

export function rmDirRecursive(dirPath) {
  if (existsSync(dirPath)) {
    readdirSync(dirPath).forEach((file) => {
      const curPath = join(dirPath, file);
      if (lstatSync(curPath).isDirectory()) {
        rmDirRecursive(curPath);
      } else {
        unlinkSync(curPath);
      }
    });
    rmdirSync(dirPath);
  }
}

export function cpDirRecursive(src, dest) {
  if (!existsSync(src)) return;
  const stats = lstatSync(src);
  if (stats.isDirectory()) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }
    readdirSync(src).forEach((child) => {
      cpDirRecursive(join(src, child), join(dest, child));
    });
  } else {
    copyFileSync(src, dest);
  }
}

// Matches a local <script src="..."></script> with `src` in ANY attribute position
const SCRIPT_RE = /<script\b[^>]*?\ssrc="(?!https?:|\/\/)([^"?#]+)(?:[?#][^"]*)?"[^>]*>\s*<\/script>/g;
const CSS_RE = /<link\s+rel="stylesheet"\s+href="(?!https?:|\/\/)([^"?#]+)(?:[?#][^"]*)?"[^>]*>/g;

export function resolveLocalAssets(html) {
  const scripts = [...html.matchAll(SCRIPT_RE)].map((m) => m[1]);
  const cssMatch = [...html.matchAll(CSS_RE)].map((m) => m[1]);
  return { scripts, stylesheet: cssMatch[0] ?? null };
}

export function concatScripts(paths, readFile) {
  return paths.map((p) => readFile(p)).join("\n;\n");
}

export function contentHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

export function assertParses(code) {
  try {
    new Function(code);
  } catch (err) {
    throw new Error(`bundle: assembled output failed syntax check: ${err.message}`);
  }
}

export function emitBundle({ root, outDir }) {
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) throw new Error(`bundle: missing ${indexPath}`);
  const html = readFileSync(indexPath, "utf8");
  const { scripts, stylesheet } = resolveLocalAssets(html);
  if (!stylesheet) throw new Error("bundle: no local stylesheet <link> found in index.html");

  const readSource = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`bundle: referenced file missing: ${rel}`);
    return readFileSync(abs, "utf8");
  };

  // Compile using esbuild
  const entryPoint = join(root, "js/app.js");
  if (!existsSync(entryPoint)) throw new Error(`bundle: missing entrypoint ${entryPoint}`);

  console.log(`⚡ [esbuild] Bundling ${entryPoint}...`);
  const esbuildCmd = "npx esbuild";
  
  let bundleJs;
  console.log("DEBUG: Running execSync command...");
  try {
    bundleJs = execSync(`${esbuildCmd} "${entryPoint}" --bundle --minify --target=es2020`, {
      encoding: "utf8",
      cwd: root
    });
    console.log("DEBUG: execSync success! code length:", bundleJs ? bundleJs.length : 0);
  } catch (err) {
    console.log("DEBUG: execSync caught exception:", err);
    console.error("esbuild failed stderr:", err.stderr || err.message);
    throw new Error(`esbuild compilation failed: ${err.message}`);
  }

  console.log("DEBUG: Running assertParses...");
  assertParses(bundleJs);
  console.log("DEBUG: assertParses success!");

  console.log("DEBUG: Reading stylesheet source: " + stylesheet);
  const cssContent = readSource(stylesheet);
  console.log("DEBUG: stylesheet read success, length = " + cssContent.length);

  const jsFile = `app.${contentHash(bundleJs)}.js`;
  const cssFile = `index.${contentHash(cssContent)}.css`;

  console.log("DEBUG: Removing and creating outDir: " + outDir);
  if (existsSync(outDir)) {
    rmDirRecursive(outDir);
  }
  mkdirSync(outDir, { recursive: true });
  console.log("DEBUG: outDir created, writing files...");

  writeFileSync(join(outDir, jsFile), bundleJs, "utf8");
  writeFileSync(join(outDir, cssFile), cssContent, "utf8");
  console.log("DEBUG: Files written successfully!");

  // Rewrite HTML
  console.log("DEBUG: Rewriting HTML...");
  const total = scripts.length;
  let seen = 0;
  let outHtml = html.replace(SCRIPT_RE, () => {
    seen += 1;
    return seen === total ? `<script src="/${jsFile}"></script>` : "";
  });
  outHtml = outHtml.replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`);
  console.log("DEBUG: Writing index.html...");
  writeFileSync(join(outDir, "index.html"), outHtml, "utf8");
  console.log("DEBUG: index.html written!");

  // Copy static assets unchanged.
  console.log("DEBUG: Copying assets...");
  cpDirRecursive(join(root, "assets"), join(outDir, "assets"));
  console.log("DEBUG: Copying manifest.json...");
  cpDirRecursive(join(root, "manifest.json"), join(outDir, "manifest.json"));

  // Copy modules folder for lazy loading support
  const modulesSrc = join(root, "js/modules");
  console.log("DEBUG: Checking modulesSrc: " + modulesSrc);
  if (existsSync(modulesSrc)) {
    console.log("DEBUG: Copying modules...");
    cpDirRecursive(modulesSrc, join(outDir, "modules"));
  }
  console.log("DEBUG: emitBundle complete!");

  return { jsFile, cssFile };
}

import { resolve } from "node:path";
const currentPath = resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentPath === entryPath) {
  const root = dirname(dirname(currentPath));
  const { jsFile, cssFile } = emitBundle({ root, outDir: join(root, "dist") });
  console.log(`bundle: wrote dist/${jsFile} and dist/${cssFile}`);
}
