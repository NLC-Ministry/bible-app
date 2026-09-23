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
  copyFileSync,
  mkdtempSync
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync, execFileSync } from "node:child_process";

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

// Lazy view modules are code-split by esbuild into content-hashed chunks under
// dist/chunks/ (see the app build in emitBundle). A tab open across a deploy
// keeps loading its own build's chunks instead of mixing new plan.js/admin.js
// into old in-memory app/db code, and the chunks are minified for free.
export const CHUNK_DIR = "chunks";

// Syntax-check an ES module file (the split entry has static `import`s, which
// `new Function` cannot parse). `node --check` on a .mjs path parses as ESM.
export function assertModuleParses(filePath) {
  try {
    execFileSync(process.execPath, ["--check", filePath], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    throw new Error(`bundle: ${filePath} failed syntax check: ${err.stderr || err.message}`);
  }
}

// The entry file is renamed after the build (build id injected, content-hashed),
// so no chunk may import it back by its esbuild output name.
export function assertChunksDoNotImportEntry(chunkSources, entryName) {
  for (const [name, source] of Object.entries(chunkSources)) {
    if (source.includes(`../${entryName}"`) || source.includes(`./${entryName}"`)) {
      throw new Error(`bundle: chunk ${name} imports the entry file ${entryName}`);
    }
  }
}

// Matches a local <script src="..."></script> with `src` in ANY attribute position
const SCRIPT_RE = /<script\b[^>]*?\ssrc="(?!https?:|\/\/)([^"?#]+)(?:[?#][^"]*)?"[^>]*>\s*<\/script>/g;
const CSS_RE = /<link\s+rel="stylesheet"\s+href="(?!https?:|\/\/)([^"?#]+)(?:[?#][^"]*)?"[^>]*>/g;

export function resolveLocalAssets(html) {
  const scripts = [...html.matchAll(SCRIPT_RE)].map((m) => m[1]);
  const stylesheets = [...html.matchAll(CSS_RE)].map((m) => m[1]);
  return { scripts, stylesheets, stylesheet: stylesheets[0] ?? null };
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
  const { scripts, stylesheets } = resolveLocalAssets(html);
  if (!stylesheets.length) throw new Error("bundle: no local stylesheet <link> found in index.html");

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
  const tmpOutDir = mkdtempSync(join(tmpdir(), "bible-esbuild-"));

  let bundleJs;
  const chunkSources = {};
  try {
    // --splitting turns every literal import('./modules/x.js') in app.js into
    // its own content-hashed chunk. Output goes to files, not stdout — minified
    // React bundles exceed Node's default execSync maxBuffer (ENOBUFS).
    execSync(
      `${esbuildCmd} "${entryPoint}" --bundle --splitting --format=esm --minify --target=es2020 --alias:@=. --outdir="${tmpOutDir}" --entry-names=app --chunk-names=${CHUNK_DIR}/[name].[hash]`,
      {
        encoding: "utf8",
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    bundleJs = readFileSync(join(tmpOutDir, "app.js"), "utf8");
    const chunkDir = join(tmpOutDir, CHUNK_DIR);
    if (existsSync(chunkDir)) {
      for (const name of readdirSync(chunkDir)) {
        chunkSources[name] = readFileSync(join(chunkDir, name), "utf8");
      }
    }
  } catch (err) {
    console.error("esbuild failed stderr:", err.stderr || err.message);
    throw new Error(`esbuild compilation failed: ${err.message}`);
  } finally {
    rmDirRecursive(tmpOutDir);
  }
  if (!Object.keys(chunkSources).length) throw new Error("bundle: code splitting produced no lazy chunks");
  if (Object.values(chunkSources).some((source) => source.includes("__BUILD_VERSION__"))) {
    throw new Error("bundle: __BUILD_VERSION__ leaked into a lazy chunk; keep it in js/app.js only");
  }
  assertChunksDoNotImportEntry(chunkSources, "app.js");

  const rawCssContent = stylesheets.map((stylesheet) => readSource(stylesheet)).join("\n\n");

  // Minify the concatenated stylesheet with esbuild's CSS minifier (selectors are
  // never renamed — only whitespace/comments/color/shorthand collapsing). This is
  // strictly a size win and cannot regress the build: any failure, or an output
  // that looks wrong, falls straight back to the raw concatenated CSS.
  let cssContent = rawCssContent;
  try {
    const cssTmpDir = mkdtempSync(join(tmpdir(), "bible-css-"));
    const cssInFile = join(cssTmpDir, "in.css");
    const cssOutFile = join(cssTmpDir, "out.css");
    try {
      writeFileSync(cssInFile, rawCssContent, "utf8");
      execSync(`${esbuildCmd} "${cssInFile}" --minify --charset=utf8 --outfile="${cssOutFile}"`, {
        encoding: "utf8",
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const minifiedCss = readFileSync(cssOutFile, "utf8");
      if (minifiedCss && minifiedCss.length > rawCssContent.length * 0.3) {
        cssContent = minifiedCss;
        console.log(`⚡ [esbuild] CSS minified ${rawCssContent.length} → ${minifiedCss.length} bytes`);
      } else {
        console.warn("[bundle] CSS minify output looked wrong; keeping raw CSS.");
      }
    } finally {
      rmDirRecursive(cssTmpDir);
    }
  } catch (err) {
    console.warn("[bundle] CSS minify failed; keeping raw CSS.", err.stderr || err.message);
  }

  // 💡 一勞永逸的快取清除法：動態產生當次建置版號，並替換程式中的 placeholder 欄位
  const buildVer = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const processedJs = bundleJs.replace(/__BUILD_VERSION__/g, buildVer);

  const jsFile = `app.${contentHash(processedJs)}.js`;
  const cssFile = `index.${contentHash(cssContent)}.css`;

  console.log("DEBUG: Removing and creating outDir: " + outDir);
  if (existsSync(outDir)) {
    rmDirRecursive(outDir);
  }
  mkdirSync(outDir, { recursive: true });
  console.log("DEBUG: outDir created, writing files...");

  writeFileSync(join(outDir, jsFile), processedJs, "utf8");
  writeFileSync(join(outDir, "app.js"), processedJs, "utf8");
  mkdirSync(join(outDir, CHUNK_DIR), { recursive: true });
  for (const [name, source] of Object.entries(chunkSources)) {
    writeFileSync(join(outDir, CHUNK_DIR, name), source, "utf8");
  }
  const entryCheckFile = join(outDir, CHUNK_DIR, "__entry_check.mjs");
  writeFileSync(entryCheckFile, processedJs, "utf8");
  try {
    assertModuleParses(entryCheckFile);
  } finally {
    unlinkSync(entryCheckFile);
  }
  writeFileSync(join(outDir, cssFile), cssContent, "utf8");
  writeFileSync(join(outDir, "index.css"), cssContent, "utf8");
  console.log("DEBUG: Files written successfully!");

  // Rewrite HTML
  console.log("DEBUG: Rewriting HTML...");
  const total = scripts.length;
  let seen = 0;
  let outHtml = html.replace(SCRIPT_RE, () => {
    seen += 1;
    return seen === total ? `<script type="module" src="/${jsFile}"></script>` : "";
  });
  let seenStylesheet = 0;
  outHtml = outHtml.replace(CSS_RE, () => {
    seenStylesheet += 1;
    return seenStylesheet === 1 ? `<link rel="stylesheet" href="/${cssFile}" onerror="window.showAppStyleRecovery(this)">` : "";
  });
  console.log("DEBUG: Writing index.html...");
  writeFileSync(join(outDir, "index.html"), outHtml, "utf8");
  console.log("DEBUG: index.html written!");

  // Copy static assets unchanged.
  console.log("DEBUG: Copying assets...");
  cpDirRecursive(join(root, "assets"), join(outDir, "assets"));
  console.log("DEBUG: Copying manifest.json...");
  cpDirRecursive(join(root, "manifest.json"), join(outDir, "manifest.json"));
  const repairPage = join(root, "repair.html");
  if (existsSync(repairPage)) cpDirRecursive(repairPage, join(outDir, "repair.html"));
  console.log("DEBUG: Copying Service Worker and PWA runtime modules...");
  const serviceWorker = readFileSync(join(root, "sw.js"), "utf8")
    .replaceAll("__BUILD_VERSION__", buildVer)
    .replaceAll("__BUILD_JS_PATH__", `/${jsFile}`)
    .replaceAll("__BUILD_CSS_PATH__", `/${cssFile}`);
  writeFileSync(join(outDir, "sw.js"), serviceWorker, "utf8");
  // Probe for js/pwa/VersionWatcher.js: same build id baked into app.js, so a
  // running tab can tell it is stale. Generated every build — never hand-edited.
  writeFileSync(join(outDir, "version.json"), JSON.stringify({ version: buildVer }), "utf8");
  cpDirRecursive(join(root, "js", "pwa"), join(outDir, "js", "pwa"));

  // ── 速讀測驗獨立頁：exam.html + esbuild(js/exam-entry.js) 打包成單一 bundle ──
  const examHtmlPath = join(root, "exam.html");
  const examEntryPath = join(root, "js", "exam-entry.js");
  if (existsSync(examHtmlPath) && existsSync(examEntryPath)) {
    console.log("DEBUG: Bundling exam.html entry...");
    const examTmpDir = mkdtempSync(join(tmpdir(), "bible-exam-"));
    const examTmpFile = join(examTmpDir, "exam.bundle.js");
    let examJs;
    try {
      execSync(
        `${esbuildCmd} "${examEntryPath}" --bundle --minify --target=es2020 --format=esm --alias:@=. --outfile="${examTmpFile}"`,
        { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] }
      );
      examJs = readFileSync(examTmpFile, "utf8").replace(/__BUILD_VERSION__/g, buildVer);
    } catch (err) {
      console.error("esbuild(exam) failed stderr:", err.stderr || err.message);
      throw new Error(`esbuild exam entry failed: ${err.message}`);
    } finally {
      rmDirRecursive(examTmpDir);
    }
    const examJsFile = `exam.${contentHash(examJs)}.js`;
    writeFileSync(join(outDir, examJsFile), examJs, "utf8");
    const outExamHtml = readFileSync(examHtmlPath, "utf8")
      .replace(SCRIPT_RE, `<script type="module" src="/${examJsFile}"></script>`)
      .replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`);
    writeFileSync(join(outDir, "exam.html"), outExamHtml, "utf8");
    console.log("DEBUG: exam.html + " + examJsFile + " written!");
  }

  // ── 線上簡答批改獨立頁：grade.html + esbuild(js/grade-entry.js) ──
  const gradeHtmlPath = join(root, "grade.html");
  const gradeEntryPath = join(root, "js", "grade-entry.js");
  if (existsSync(gradeHtmlPath) && existsSync(gradeEntryPath)) {
    console.log("DEBUG: Bundling grade.html entry...");
    const gradeTmpDir = mkdtempSync(join(tmpdir(), "bible-grade-"));
    const gradeTmpFile = join(gradeTmpDir, "grade.bundle.js");
    let gradeJs;
    try {
      execSync(
        `${esbuildCmd} "${gradeEntryPath}" --bundle --minify --target=es2020 --format=esm --alias:@=. --outfile="${gradeTmpFile}"`,
        { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] }
      );
      gradeJs = readFileSync(gradeTmpFile, "utf8").replace(/__BUILD_VERSION__/g, buildVer);
    } catch (err) {
      console.error("esbuild(grade) failed stderr:", err.stderr || err.message);
      throw new Error(`esbuild grade entry failed: ${err.message}`);
    } finally {
      rmDirRecursive(gradeTmpDir);
    }
    const gradeJsFile = `grade.${contentHash(gradeJs)}.js`;
    writeFileSync(join(outDir, gradeJsFile), gradeJs, "utf8");
    const outGradeHtml = readFileSync(gradeHtmlPath, "utf8")
      .replace(SCRIPT_RE, `<script type="module" src="/${gradeJsFile}"></script>`)
      .replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`);
    writeFileSync(join(outDir, "grade.html"), outGradeHtml, "utf8");
    console.log("DEBUG: grade.html + " + gradeJsFile + " written!");
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
