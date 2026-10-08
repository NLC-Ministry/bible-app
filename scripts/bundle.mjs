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

// release-policy.json → /version.json's minVersion. The cutoff is a wall-clock
// time with an explicit offset (Vercel builds in UTC, so a bare local time
// would silently shift by 8h). Converted to the same UTC YYYYMMDDHHmmss form
// as build ids so the client compares plain strings.
export function resolveMinVersion(policy, buildVer) {
  const raw = policy?.forceUpdateBuiltBefore;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(raw.trim())) {
    throw new Error(`release-policy.json: forceUpdateBuiltBefore must be an ISO time with a timezone, e.g. 2026-09-23T13:00:00+08:00 (got ${JSON.stringify(raw)})`);
  }
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) {
    throw new Error(`release-policy.json: forceUpdateBuiltBefore is not a valid time: ${raw}`);
  }
  const minVersion = date.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  // A cutoff after this build would force-reload this very build forever.
  if (minVersion > buildVer) {
    throw new Error(`release-policy.json: forceUpdateBuiltBefore (${raw}) is later than this build (${buildVer} UTC)`);
  }
  return minVersion;
}

export function readReleasePolicy(root) {
  const path = join(root, "release-policy.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

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

// supabase-js 改由自己的網站提供（#418）：原始 HTML 仍寫固定版本的 jsdelivr 標籤（版本號只寫在那裡），
// 建置時換成同網域、內容雜湊檔名的 vendor 檔。它仍是同步載入、留在關鍵路徑上——真的 Supabase
// client 是 Logto session 失效時讀公開表的退路，不能延後或拿掉（見 vendor/README.md）。
export const SUPABASE_CDN_TAG_RE = /<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@(\d+\.\d+\.\d+)"[^>]*><\/script>/;

export function prepareSupabaseVendor(root, htmlSources) {
  const versions = new Set();
  for (const [, source] of htmlSources) {
    const match = String(source || "").match(SUPABASE_CDN_TAG_RE);
    if (match) versions.add(match[1]);
  }
  if (versions.size === 0) return null;
  if (versions.size > 1) {
    throw new Error(`supabase-js versions differ between pages (${[...versions].join(", ")}); pin every HTML entry to the same version.`);
  }
  const [version] = versions;
  const vendorPath = join(root, "vendor", "supabase-js", version, "supabase.js");
  if (!existsSync(vendorPath)) {
    throw new Error(`vendor/supabase-js/${version}/supabase.js is missing: the HTML pins supabase-js@${version}; add that version to vendor/ (see vendor/README.md).`);
  }
  const content = readFileSync(vendorPath, "utf8");
  const file = `supabase.${contentHash(content)}.js`;
  return {
    version,
    file,
    content,
    rewrite: (html) => html.replace(SUPABASE_CDN_TAG_RE, `<script src="/${file}"></script>`)
  };
}

// Tailwind 改成建置時產生（#418 第二階段）：原本 index.html 載入 cdn.tailwindcss.com，在瀏覽器端
// 掃 DOM 即時產生 CSS。現在用與 CDN 同版本的 Tailwind CLI 依 tailwind.config.cjs 掃原始碼產生，
// 輸出成獨立的 tailwind.<hash>.css、只給 index.html（read/exam/grade 原本就沒有 Tailwind，
// 併進共用的 index.<hash>.css 會讓 .container/.flex/.border 之類的規則套到那些頁面）。
// 直接執行 node_modules/.bin 裡的工具，不透過 npx（#457）：每次 npx 在 Windows 上要先花數秒
// 解析套件，一次建置呼叫好幾次，本機建置／bundle 測試因此慢到超時。找不到時才退回 npx。
const BIN_DIR = fileURLToPath(new URL("../node_modules/.bin/", import.meta.url));
export function localBin(name, { binDir = BIN_DIR, platform = process.platform } = {}) {
  const bin = join(binDir, platform === "win32" ? `${name}.cmd` : name);
  return existsSync(bin) ? `"${bin}"` : `npx ${name}`;
}

export const TAILWIND_PLACEHOLDER = "<!-- build:tailwind-css -->";

export function buildTailwindCss(root, esbuildCmd = localBin("esbuild")) {
  const configPath = join(root, "tailwind.config.cjs");
  if (!existsSync(configPath)) throw new Error("bundle: missing tailwind.config.cjs");
  const tmp = mkdtempSync(join(tmpdir(), "bible-tailwind-"));
  try {
    const inFile = join(tmp, "in.css");
    const rawFile = join(tmp, "raw.css");
    const outFile = join(tmp, "out.css");
    writeFileSync(inFile, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n", "utf8");
    try {
      // cwd = root：tailwind.config.cjs 的 content 路徑是相對於專案根目錄。
      execSync(`${localBin("tailwindcss")} -c "${configPath}" -i "${inFile}" -o "${rawFile}"`, {
        encoding: "utf8",
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new Error(`bundle: tailwind CSS build failed: ${err.stderr || err.message}`);
    }
    const raw = readFileSync(rawFile, "utf8");
    // 沒有工具類規則代表 content 設定或 CLI 壞了；寧可建置失敗，也不要上線一份沒有樣式的 App。
    if (!/\.flex\s*\{/.test(raw)) throw new Error("bundle: tailwind CSS output has no utilities; check tailwind.config.cjs content globs");
    // 和 index.css 一樣用 esbuild 壓縮（只去空白／註解，不改選擇器）；失敗就用未壓縮版。
    try {
      execSync(`${esbuildCmd} "${rawFile}" --minify --charset=utf8 --outfile="${outFile}"`, {
        encoding: "utf8",
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const minified = readFileSync(outFile, "utf8");
      if (minified && minified.length > raw.length * 0.3) return minified;
      console.warn("[bundle] tailwind CSS minify output looked wrong; keeping raw CSS.");
    } catch (err) {
      console.warn("[bundle] tailwind CSS minify failed; keeping raw CSS.", err.stderr || err.message);
    }
    return raw;
  } finally {
    rmDirRecursive(tmp);
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
  const esbuildCmd = localBin("esbuild");
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
  if (!html.includes(TAILWIND_PLACEHOLDER)) throw new Error(`bundle: index.html is missing the ${TAILWIND_PLACEHOLDER} placeholder`);
  const tailwindCss = buildTailwindCss(root, esbuildCmd);
  const tailwindFile = `tailwind.${contentHash(tailwindCss)}.css`;
  const readOptionalHtml = (name) => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : "");
  const supabaseVendor = prepareSupabaseVendor(root, [
    ["index.html", html],
    ["exam.html", readOptionalHtml("exam.html")],
    ["grade.html", readOptionalHtml("grade.html")]
  ]);
  const withSupabaseVendor = (source) => (supabaseVendor ? supabaseVendor.rewrite(source) : source);

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
  writeFileSync(join(outDir, tailwindFile), tailwindCss, "utf8");
  writeFileSync(join(outDir, "tailwind.css"), tailwindCss, "utf8");
  if (supabaseVendor) writeFileSync(join(outDir, supabaseVendor.file), supabaseVendor.content, "utf8");
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
  outHtml = outHtml.replace(
    TAILWIND_PLACEHOLDER,
    `<link rel="stylesheet" href="/${tailwindFile}" onerror="window.showAppStyleRecovery(this)">`
  );
  // 一定要在 SCRIPT_RE 之後：換好的同網域標籤也是本機 <script src>，先換會被當成 app 的 script 吃掉。
  outHtml = withSupabaseVendor(outHtml);
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
  // ── 快速啟動聖經的獨立讀經頁（#416）：read.html + esbuild(js/read-entry.js) 打包成單一 bundle。
  // 要在寫 sw.js 之前打包：SW 要預先快取 /read 和它的 bundle，離線也打得開。
  let readJsFile = "";
  const readHtmlPath = join(root, "read.html");
  const readEntryPath = join(root, "js", "read-entry.js");
  if (existsSync(readHtmlPath) && existsSync(readEntryPath)) {
    console.log("DEBUG: Bundling read.html entry...");
    const readTmpDir = mkdtempSync(join(tmpdir(), "bible-read-"));
    const readTmpFile = join(readTmpDir, "read.bundle.js");
    let readJs;
    try {
      execSync(
        `${esbuildCmd} "${readEntryPath}" --bundle --minify --target=es2020 --format=esm --alias:@=. --outfile="${readTmpFile}"`,
        { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] }
      );
      readJs = readFileSync(readTmpFile, "utf8").replace(/__BUILD_VERSION__/g, buildVer);
    } catch (err) {
      console.error("esbuild(read) failed stderr:", err.stderr || err.message);
      throw new Error(`esbuild read entry failed: ${err.message}`);
    } finally {
      rmDirRecursive(readTmpDir);
    }
    readJsFile = `read.${contentHash(readJs)}.js`;
    writeFileSync(join(outDir, readJsFile), readJs, "utf8");
    const outReadHtml = readFileSync(readHtmlPath, "utf8")
      .replace(SCRIPT_RE, `<script type="module" src="/${readJsFile}"></script>`)
      .replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`);
    writeFileSync(join(outDir, "read.html"), outReadHtml, "utf8");
    console.log("DEBUG: read.html + " + readJsFile + " written!");
  }

  console.log("DEBUG: Copying Service Worker and PWA runtime modules...");
  const serviceWorker = readFileSync(join(root, "sw.js"), "utf8")
    .replaceAll("__BUILD_VERSION__", buildVer)
    .replaceAll("__BUILD_JS_PATH__", `/${jsFile}`)
    .replaceAll("__BUILD_CSS_PATH__", `/${cssFile}`)
    .replaceAll("__BUILD_TAILWIND_CSS_PATH__", `/${tailwindFile}`)
    .replaceAll("__BUILD_READ_JS_PATH__", readJsFile ? `/${readJsFile}` : "")
    .replaceAll("__BUILD_SUPABASE_JS_PATH__", supabaseVendor ? `/${supabaseVendor.file}` : "");
  writeFileSync(join(outDir, "sw.js"), serviceWorker, "utf8");
  // Probe for js/pwa/VersionWatcher.js: same build id baked into app.js, so a
  // running tab can tell it is stale. Generated every build — never hand-edited.
  const minVersion = resolveMinVersion(readReleasePolicy(root), buildVer);
  writeFileSync(join(outDir, "version.json"), JSON.stringify(minVersion ? { version: buildVer, minVersion } : { version: buildVer }), "utf8");
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
    const outExamHtml = withSupabaseVendor(readFileSync(examHtmlPath, "utf8")
      .replace(SCRIPT_RE, `<script type="module" src="/${examJsFile}"></script>`)
      .replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`));
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
    const outGradeHtml = withSupabaseVendor(readFileSync(gradeHtmlPath, "utf8")
      .replace(SCRIPT_RE, `<script type="module" src="/${gradeJsFile}"></script>`)
      .replace(CSS_RE, `<link rel="stylesheet" href="/${cssFile}">`));
    writeFileSync(join(outDir, "grade.html"), outGradeHtml, "utf8");
    console.log("DEBUG: grade.html + " + gradeJsFile + " written!");
  }
  console.log("DEBUG: emitBundle complete!");

  return { jsFile, cssFile, tailwindFile, supabaseFile: supabaseVendor ? supabaseVendor.file : null };
}

import { resolve } from "node:path";
const currentPath = resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentPath === entryPath) {
  const root = dirname(dirname(currentPath));
  const { jsFile, cssFile } = emitBundle({ root, outDir: join(root, "dist") });
  console.log(`bundle: wrote dist/${jsFile} and dist/${cssFile}`);
}
