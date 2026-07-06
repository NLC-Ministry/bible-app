// scripts/bundle.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

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
  const esbuildPath = join(root, "node_modules", ".bin", "esbuild");
  const esbuildCmd = existsSync(esbuildPath) ? esbuildPath : "npx esbuild";
  
  let bundleJs;
  try {
    bundleJs = execSync(`"${esbuildCmd}" "${entryPoint}" --bundle --minify --target=es2020`, {
      encoding: "utf8",
      cwd: root
    });
  } catch (err) {
    throw new Error(`esbuild compilation failed: ${err.message}`);
  }

  // Guard 4: syntax-check the assembled output before writing.
  assertParses(bundleJs);

  const cssContent = readSource(stylesheet);
  const jsFile = `app.${contentHash(bundleJs)}.js`;
  const cssFile = `index.${contentHash(cssContent)}.css`;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, jsFile), bundleJs, "utf8");
  writeFileSync(join(outDir, cssFile), cssContent, "utf8");

  // Rewrite HTML
  const total = scripts.length;
  let seen = 0;
  let outHtml = html.replace(SCRIPT_RE, () => {
    seen += 1;
    return seen === total ? `<script src="/${jsFile}"></script>` : "";
  });
  outHtml = outHtml.replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`);
  writeFileSync(join(outDir, "index.html"), outHtml, "utf8");

  // Copy static assets unchanged.
  cpSync(join(root, "assets"), join(outDir, "assets"), { recursive: true });
  cpSync(join(root, "manifest.json"), join(outDir, "manifest.json"));

  // Copy modules folder for lazy loading support
  const modulesSrc = join(root, "js/modules");
  if (existsSync(modulesSrc)) {
    cpSync(modulesSrc, join(outDir, "modules"), { recursive: true });
  }

  return { jsFile, cssFile };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { jsFile, cssFile } = emitBundle({ root, outDir: join(root, "dist") });
  console.log(`bundle: wrote dist/${jsFile} and dist/${cssFile}`);
}
