// scripts/bundle.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_RE = /<script\s+src="(?!https?:|\/\/)([^"?#]+)(?:[?#][^"]*)?"[^>]*>\s*<\/script>/g;
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

export function emitBundle({ root, outDir }) {
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) throw new Error(`bundle: missing ${indexPath}`);
  const html = readFileSync(indexPath, "utf8");
  const { scripts, stylesheet } = resolveLocalAssets(html);

  const readSource = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`bundle: referenced file missing: ${rel}`);
    return readFileSync(abs, "utf8");
  };

  // Guard 2: document.currentScript changes meaning after concatenation.
  for (const rel of scripts) {
    if (readSource(rel).includes("document.currentScript")) {
      throw new Error(`bundle: ${rel} uses document.currentScript; unsafe to concatenate`);
    }
  }

  const bundleJs = concatScripts(scripts, readSource);
  // Guard 3: byte-identity.
  for (const rel of scripts) {
    if (!bundleJs.includes(readSource(rel))) {
      throw new Error(`bundle: concatenated output missing verbatim content of ${rel}`);
    }
  }

  const cssContent = readSource(stylesheet);
  const jsFile = `app.${contentHash(bundleJs)}.js`;
  const cssFile = `index.${contentHash(cssContent)}.css`;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, jsFile), bundleJs, "utf8");
  writeFileSync(join(outDir, cssFile), cssContent, "utf8");

  // Rewrite HTML: last local script tag -> bundle tag; others -> "".
  // Note: SCRIPT_RE assumes src is the first attribute on <script> tags (true for this repo's index.html).
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

  return { jsFile, cssFile };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { jsFile, cssFile } = emitBundle({ root, outDir: join(root, "dist") });
  console.log(`bundle: wrote dist/${jsFile} and dist/${cssFile}`);
}
