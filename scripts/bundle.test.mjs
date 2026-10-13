// scripts/bundle.test.mjs
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readFileSync as rf, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveLocalAssets, concatScripts, contentHash, emitBundle, assertParses, assertChunksDoNotImportEntry, resolveMinVersion, readReleasePolicy, prepareSupabaseVendor, localBin } from "./bundle.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe("resolveLocalAssets", () => {
  it("returns local scripts in document order, external excluded, queries stripped", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn/x.css">
      <link rel="stylesheet" href="index.css?v=abc">
      <link rel="stylesheet" href="css/team-registration.css?v=def">
      <script src="https://cdn/lib.js"></script>
      <script src="config.js?v=1"></script>
      <script src="js/state.js?v=2"></script>`;
    const out = resolveLocalAssets(html);
    expect(out.scripts).toEqual(["config.js", "js/state.js"]);
    expect(out.stylesheet).toBe("index.css");
    expect(out.stylesheets).toEqual(["index.css", "css/team-registration.css"]);
  });

  it("extracts src regardless of attribute order, still excluding external and inline", () => {
    const html = `
      <script defer src="js/a.js"></script>
      <script type="module" src="js/b.js"></script>
      <script src="https://cdn/lib.js" crossorigin></script>
      <script>window.x = "src=inline";</script>`;
    expect(resolveLocalAssets(html).scripts).toEqual(["js/a.js", "js/b.js"]);
  });

  it("returns null stylesheet when there is no local stylesheet link", () => {
    expect(resolveLocalAssets(`<script src="js/a.js"></script>`).stylesheet).toBeNull();
  });

  it("resolves the real index.html to the exact 1-file order", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const { scripts, stylesheets } = resolveLocalAssets(html);
    expect(scripts).toEqual([
      "js/app.js"
    ]);
  });
});

describe("concatScripts", () => {
  it("joins file contents in order with ASI-safe separators", () => {
    const read = (p) => ({ "a.js": "var a=1", "b.js": "var b=2" })[p];
    expect(concatScripts(["a.js", "b.js"], read)).toBe("var a=1\n;\nvar b=2");
  });
});

describe("contentHash", () => {
  it("is deterministic and 8 hex chars", () => {
    const h = contentHash("hello");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(h).toBe(contentHash("hello"));
    expect(h).not.toBe(contentHash("world"));
  });
});

describe("assertParses", () => {
  it("passes for valid concatenated JS", () => {
    expect(() => assertParses("var a=1;\n;\nfunction f(){ return a; }")).not.toThrow();
  });
  it("throws a descriptive error for a syntax error", () => {
    expect(() => assertParses("var a = ;")).toThrow(/failed syntax check/);
  });
});

describe("localBin (#457: no npx in the build)", () => {
  it("points at node_modules/.bin, with the .cmd shim on Windows", () => {
    const binDir = mkdtempSync(join(tmpdir(), "bin-"));
    try {
      writeFileSync(join(binDir, "esbuild"), "");
      writeFileSync(join(binDir, "esbuild.cmd"), "");
      expect(localBin("esbuild", { binDir, platform: "linux" })).toBe(`"${join(binDir, "esbuild")}"`);
      expect(localBin("esbuild", { binDir, platform: "win32" })).toBe(`"${join(binDir, "esbuild.cmd")}"`);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("falls back to npx when the binary is not installed", () => {
    expect(localBin("esbuild", { binDir: join(tmpdir(), "no-such-bin-dir") })).toBe("npx esbuild");
  });

  it("the build never shells out through npx directly", () => {
    const source = readFileSync(join(root, "scripts/bundle.mjs"), "utf8");
    expect(source).not.toMatch(/execSync\(`npx /);
    expect(source).not.toMatch(/= "npx /);
  });
});

describe("emitBundle esbuild invocation", () => {
  it("writes esbuild output to a file instead of capturing stdout", () => {
    const source = readFileSync(join(root, "scripts/bundle.mjs"), "utf8");
    expect(source).toContain("--outfile=");
    expect(source).toContain("ENOBUFS");
    expect(source).toMatch(/--splitting --format=esm/);
    expect(source).not.toMatch(
      /execSync\(`\$\{esbuildCmd\} "\$\{entryPoint\}" --bundle --minify --target=es2020`/
    );
  });
});

describe("emitBundle guards", () => {
  it("throws a descriptive error when index.html has no local stylesheet", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-nocss-"));
    try {
      writeFileSync(join(dir, "index.html"), `<script src="a.js"></script>`);
      expect(() => emitBundle({ root: dir, outDir: join(dir, "out") })).toThrow(/no local stylesheet/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("split chunk guards", () => {
  it("rejects a chunk that imports the renamed entry file back", () => {
    expect(() => assertChunksDoNotImportEntry({ "plan.X.js": 'import{a}from"../app.js";' }, "app.js")).toThrow(/imports the entry file/);
    expect(() => assertChunksDoNotImportEntry({ "plan.X.js": 'import{a}from"./chunk.Y.js";' }, "app.js")).not.toThrow();
  });
});
// #418：supabase-js 改由自己的網站提供，版本以 HTML 的 CDN 標籤為準。
describe("prepareSupabaseVendor", () => {
  const tag = version => `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${version}" crossorigin="anonymous"></script>`;

  it("finds the vendored file for the pinned version and rewrites the tag to a same-origin hashed file", () => {
    const vendor = prepareSupabaseVendor(root, [["index.html", `<head>${tag("2.115.0")}</head>`]]);
    expect(vendor.version).toBe("2.115.0");
    expect(vendor.file).toMatch(/^supabase\.[0-9a-f]{8}\.js$/);
    expect(vendor.content).toBe(rf(join(root, "vendor", "supabase-js", "2.115.0", "supabase.js"), "utf8"));
    expect(vendor.rewrite(`<head>${tag("2.115.0")}</head>`)).toBe(`<head><script src="/${vendor.file}"></script></head>`);
  });

  it("fails the build when pages pin different versions", () => {
    expect(() => prepareSupabaseVendor(root, [["index.html", tag("2.115.0")], ["exam.html", tag("2.116.0")]]))
      .toThrow(/versions differ/);
  });

  it("fails the build when the pinned version is not vendored", () => {
    expect(() => prepareSupabaseVendor(root, [["index.html", tag("9.9.9")]])).toThrow(/vendor\/supabase-js\/9\.9\.9/);
  });

  it("does nothing for pages without the tag", () => {
    expect(prepareSupabaseVendor(root, [["index.html", "<head></head>"]])).toBeNull();
  });
});

describe("emitBundle (integration, real repo)", () => {
  // config.js is git-ignored and generated by build-config.js. In a clean checkout
  // (e.g. CI, where `npm test` runs before the build step) it does not exist yet,
  // so generate it here to make this real-repo test self-sufficient.
  beforeAll(() => {
    if (!existsSync(join(root, "config.js"))) {
      execSync("node build-config.js", { cwd: root, stdio: "ignore" });
    }
  });

  it("produces one hashed JS bundle + hashed CSS and a rewritten index.html", () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-"));
    try {
      const { jsFile, cssFile, tailwindFile, supabaseFile } = emitBundle({ root, outDir: out });
      // hashed filenames
      expect(jsFile).toMatch(/^app\.[0-9a-f]{8}\.js$/);
      expect(cssFile).toMatch(/^index\.[0-9a-f]{8}\.css$/);
      expect(existsSync(join(out, jsFile))).toBe(true);
      expect(existsSync(join(out, "app.js"))).toBe(true);
      expect(existsSync(join(out, cssFile))).toBe(true);
      expect(existsSync(join(out, "index.css"))).toBe(true);
      // rewritten HTML: exactly one app script tag, no leftover local js/ tags
      const html = rf(join(out, "index.html"), "utf8");
      expect(html).toContain(`<script type="module" src="/${jsFile}"></script>`);
      expect(html).not.toMatch(/<script\s+src="js\//);
      expect(html).not.toMatch(/<script\s+src="config\.js/);
      expect(html).toContain(`href="/${cssFile}" onerror="window.showAppStyleRecovery(this)"`);
      expect((html.match(new RegExp(`href="/${cssFile}"`, "g")) || []).length).toBe(1);
      const bundledCss = rf(join(out, cssFile), "utf8");
      expect(bundledCss).toContain(".reading-team-overlay");
      expect(rf(join(out, "index.css"), "utf8")).toBe(bundledCss);
      const serviceWorker = rf(join(out, "sw.js"), "utf8");
      expect(serviceWorker).not.toContain("__BUILD_VERSION__");
      expect(serviceWorker).not.toContain("__BUILD_JS_PATH__");
      expect(serviceWorker).not.toContain("__BUILD_CSS_PATH__");
      expect(serviceWorker).toContain(`"/${jsFile}"`);
      expect(serviceWorker).toContain(`"/${cssFile}"`);
      expect(serviceWorker).toContain('"/index.css"');
      expect(serviceWorker).toMatch(/const VERSION = "\d{14}"/);
      // Stale-build probe carries the same build id as the SW / app bundle.
      const versionProbe = JSON.parse(rf(join(out, "version.json"), "utf8"));
      expect(versionProbe.version).toMatch(/^\d{14}$/);
      expect(serviceWorker).toContain(`const VERSION = "${versionProbe.version}"`);

      // supabase-js served same-origin (#418): synchronous classic script, before the app module, on every page
      expect(supabaseFile).toMatch(/^supabase\.[0-9a-f]{8}\.js$/);
      expect(rf(join(out, supabaseFile), "utf8")).toBe(rf(join(root, "vendor", "supabase-js", "2.115.0", "supabase.js"), "utf8"));
      for (const page of ["index.html", "exam.html", "grade.html"]) {
        const pageHtml = rf(join(out, page), "utf8");
        expect(pageHtml, page).toContain(`<script src="/${supabaseFile}"></script>`);
        expect(pageHtml, page).not.toContain("cdn.jsdelivr.net/npm/@supabase");
        expect(pageHtml.indexOf(`/${supabaseFile}`), page).toBeLessThan(pageHtml.indexOf('<script type="module"'));
      }
      expect(serviceWorker).not.toContain("__BUILD_SUPABASE_JS_PATH__");
      expect(serviceWorker).toContain(`"/${supabaseFile}"`);

      // Tailwind generated at build time (#418 phase 2): its own hashed file, index.html only,
      // linked after the app stylesheet (the play-CDN <style> used to land at the end of <head>).
      expect(tailwindFile).toMatch(/^tailwind\.[0-9a-f]{8}\.css$/);
      const tailwindCss = rf(join(out, tailwindFile), "utf8");
      expect(rf(join(out, "tailwind.css"), "utf8")).toBe(tailwindCss);
      expect(tailwindCss).toMatch(/\.flex\{display:flex\}/);
      // theme bridge from tailwind.config.cjs, dark: keyed off the .dark class, no preflight
      expect(tailwindCss).toContain("var(--color-brand)");
      expect(tailwindCss).toMatch(/\.dark\\:[^{]*:is\(\.dark \*\)\{/);
      expect(tailwindCss).not.toContain("prefers-color-scheme");
      expect(tailwindCss).not.toMatch(/(^|\})html\{line-height/);
      expect(html).toContain(`<link rel="stylesheet" href="/${tailwindFile}" onerror="window.showAppStyleRecovery(this)">`);
      expect(html.indexOf(`/${tailwindFile}`)).toBeGreaterThan(html.indexOf(`/${cssFile}`));
      expect(html).not.toContain("cdn.tailwindcss.com");
      expect(html).not.toContain("build:tailwind-css");
      for (const page of ["exam.html", "grade.html", "read.html", "repair.html"]) {
        const pageHtml = rf(join(out, page), "utf8");
        expect(pageHtml, page).not.toContain("tailwind");
      }
      expect(serviceWorker).not.toContain("__BUILD_TAILWIND_CSS_PATH__");
      expect(serviceWorker).toContain(`"/${tailwindFile}"`);

      // assets copied
      expect(existsSync(join(out, "manifest.json"))).toBe(true);
      expect(existsSync(join(out, "repair.html"))).toBe(true);
      expect(existsSync(join(out, "sw.js"))).toBe(true);
      expect(existsSync(join(out, "js", "pwa", "CacheManager.js"))).toBe(true);
      expect(existsSync(join(out, "js", "pwa", "SupabaseRepository.js"))).toBe(true);
      expect(readdirSync(join(out, "assets")).length).toBeGreaterThan(0);
      // 後台（#555）只在自己的網域：會友 App 的輸出沒有後台頁面（/admin 拿不到後台）
      expect(existsSync(join(out, "admin.html"))).toBe(false);
      expect(existsSync(join(out, "admin"))).toBe(false);
      expect(readdirSync(out).some((file) => /^admin\.[A-Z0-9]+\.(js|css)$/i.test(file))).toBe(false);
      // lazy view modules are content-hashed chunks, not raw copies
      expect(existsSync(join(out, "modules"))).toBe(false);
      expect(existsSync(join(out, "data"))).toBe(false);
      const chunks = readdirSync(join(out, "chunks"));
      const hasChunk = (name) => chunks.some((file) => new RegExp(`^${name}\\.[A-Z0-9]{8}\\.js$`).test(file));
      for (const name of ["home", "bible", "plan", "profile", "pastoral", "exam", "team-registration", "onboarding-helper", "issue-report-ui"]) {
        expect(hasChunk(name), name).toBe(true);
      }
      // #551：系統管理的程式在管理後台，會友 App 的 dist/ 一支都沒有
      for (const name of ["admin", "plan-admin", "campaign-rule-editor"]) expect(hasChunk(name), name).toBe(false);
      const issueReportChunk = chunks.find((file) => file.startsWith("issue-report-ui."));
      const issueReportCode = rf(join(out, "chunks", issueReportChunk), "utf8");
      expect(issueReportCode).toMatch(/mountIssueReportUi/);
      expect(issueReportCode).not.toContain("admin-reports-root");
      // contains app bundle code
      const bundle = rf(join(out, jsFile), "utf8");
      expect(bundle.includes("MODULE_LOAD_FAILED")).toBe(true);
      expect(bundle).not.toContain("__BUILD_VERSION__");
      expect(bundle).toContain(`"${versionProbe.version}"`);
      expect(bundle).toMatch(/import\("\.\/chunks\/plan\.[A-Z0-9]{8}\.js"\)/);
      // React stays in its own lazy chunk, out of the initial download
      expect(bundle).not.toContain("react-dom.production");
      expect(bundle).not.toMatch(/\.includes\("\d{14}"\)/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120000);
});

describe("release policy → minVersion", () => {
  const BUILD = "20260923060000";
  it("is null when no forced update is configured", () => {
    expect(resolveMinVersion({ forceUpdateBuiltBefore: null }, BUILD)).toBeNull();
    expect(resolveMinVersion({}, BUILD)).toBeNull();
  });
  it("converts a Taipei-time cutoff to the UTC build-id format", () => {
    expect(resolveMinVersion({ forceUpdateBuiltBefore: "2026-09-23T13:00:00+08:00" }, BUILD)).toBe("20260923050000");
  });
  it("rejects a cutoff without a timezone (Vercel builds in UTC)", () => {
    expect(() => resolveMinVersion({ forceUpdateBuiltBefore: "2026-09-23T13:00:00" }, BUILD)).toThrow(/timezone/);
  });
  it("rejects a cutoff later than the build, which would force-reload forever", () => {
    expect(() => resolveMinVersion({ forceUpdateBuiltBefore: "2026-09-23T15:00:00+08:00" }, BUILD)).toThrow(/later than this build/);
  });
  // The committed file is the only source of this value (Vercel builds from git),
  // so a release that needs a forced update must commit a cutoff. Only guard
  // against values that would break the build: no timezone, or a future time.
  it("repo policy is either off or a valid past cutoff", () => {
    const nowBuild = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    expect(() => resolveMinVersion(readReleasePolicy(root), nowBuild)).not.toThrow();
  });
});
