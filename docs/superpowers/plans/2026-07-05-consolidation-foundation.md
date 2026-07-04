# Consolidation Stage 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a short feature freeze, replace fragile cache-busting with a filename-hashed production bundle built from the existing global scripts, retire the self-destructing service worker, and prove the app behaves byte-for-byte identically — changing zero runtime logic.

**Architecture:** A dev/prod split. Dev is unchanged (`npx serve .` on raw individual files). A new pure-Node bundler (`scripts/bundle.mjs`) reads `index.html`, concatenates the local JS it references in exact document order into one content-hashed `app.<hash>.js` (plus a hashed `index.<hash>.css`), rewrites a copy of the HTML to reference them, and writes everything to `dist/`. Vercel serves `dist/`.

**Tech Stack:** Node 20+ (repo on v25), Vitest, plain ES modules (`.mjs`) for build tooling. No Vite, no TypeScript, no ES-module conversion of app code in this stage.

## Global Constraints

- **Zero runtime-logic change.** No file under `js/`, nor `config.js`, `index.css`, or the inline `<script>` blocks in `index.html`, changes in content or execution order relative to each other. Only asset *delivery* changes.
- **App stays deployable at every commit.** A failed build blocks the deploy; it never ships a broken app.
- **Node >= 20.** Build tooling is ES modules with `.mjs` extension. Do NOT add `"type": "module"` to `package.json` (keeps `build-config.js` CommonJS).
- **Filename hashing, not query-string.** Hashed assets are `app.<hash>.js` / `index.<hash>.css`, where `<hash>` = first 8 hex chars of the file's sha256.
- **No Vite, no TypeScript, no `.ts` files, no type-check CI step** in this stage (deferred to Stage 2).
- **Do not hash static assets** (`assets/`, `manifest.json`) — copy them unchanged.
- **Exact current script order** (from `index.html`), which the bundle MUST preserve:
  `config.js`, `js/data/bible_data.js`, `js/data/bible_verse_counts.js`, `js/copy/zh-Hant.js`, `js/design-tokens.js`, `js/state.js`, `js/auth.js`, `js/views/plan.js`, `js/db.js`, `js/utils.js`, `js/gamification.js`, `js/views/dashboard.js`, `js/views/reader.js`, `js/views/stats.js`, `js/views/profile.js`, `js/main.js`.
- **Traditional-Chinese** for any user-facing copy (none is added in this stage).

---

## File Structure

- `scripts/bundle.mjs` — the bundler: pure helpers (asset resolution, concatenation, hashing) + a CLI `main` that emits `dist/`. One responsibility: turn the source tree into a hashed production bundle.
- `scripts/bundle.test.mjs` — Vitest unit + integration tests for the bundler.
- `scripts/hash-assets.mjs` + `scripts/hash-assets.test.mjs` — **retired** (superseded by the bundler).
- `package.json` — `build` script points at the bundler.
- `vercel.json` — `outputDirectory: dist` + cache headers.
- `sw.js` — **deleted**.
- `.github/workflows/ci.yml` — asserts bundled output.
- `index.html` — source keeps individual `<script>` tags (dev); the now-meaningless Phase 0 `?v=` query strings are stripped. The bundler reads this file but writes its rewritten output only to `dist/`.

---

## Task 1: Pure bundler core (resolution, concatenation, hashing)

**Files:**
- Create: `scripts/bundle.mjs`
- Test: `scripts/bundle.test.mjs`

**Interfaces:**
- Produces: `resolveLocalAssets(html: string) => { scripts: string[], stylesheet: string }` — ordered local script paths (external `http(s)://` and `//` excluded; any `?…`/`#…` query stripped) and the single local stylesheet path.
- Produces: `concatScripts(paths: string[], readFile: (p: string) => string) => string` — concatenates file contents in order, separated by `\n;\n` (ASI-safe).
- Produces: `contentHash(text: string) => string` — first 8 hex chars of sha256.

- [ ] **Step 1: Write the failing test**

```js
// scripts/bundle.test.mjs
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveLocalAssets, concatScripts, contentHash } from "./bundle.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe("resolveLocalAssets", () => {
  it("returns local scripts in document order, external excluded, queries stripped", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn/x.css">
      <link rel="stylesheet" href="index.css?v=abc">
      <script src="https://cdn/lib.js"></script>
      <script src="config.js?v=1"></script>
      <script src="js/state.js?v=2"></script>`;
    const out = resolveLocalAssets(html);
    expect(out.scripts).toEqual(["config.js", "js/state.js"]);
    expect(out.stylesheet).toBe("index.css");
  });

  it("resolves the real index.html to the exact 16-file order", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const { scripts } = resolveLocalAssets(html);
    expect(scripts).toEqual([
      "config.js", "js/data/bible_data.js", "js/data/bible_verse_counts.js",
      "js/copy/zh-Hant.js", "js/design-tokens.js", "js/state.js", "js/auth.js",
      "js/views/plan.js", "js/db.js", "js/utils.js", "js/gamification.js",
      "js/views/dashboard.js", "js/views/reader.js", "js/views/stats.js",
      "js/views/profile.js", "js/main.js",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/bundle.test.mjs`
Expected: FAIL — cannot find module `./bundle.mjs` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/bundle.mjs
import { createHash } from "node:crypto";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/bundle.test.mjs`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/bundle.mjs scripts/bundle.test.mjs
git commit -m "build: pure bundler core (resolve, concat, hash)"
```

---

## Task 2: Build emission — produce `dist/` with the hashed bundle

**Files:**
- Modify: `scripts/bundle.mjs` (add `emitBundle` + CLI main)
- Test: `scripts/bundle.test.mjs` (add integration test)

**Interfaces:**
- Consumes: `resolveLocalAssets`, `concatScripts`, `contentHash` from Task 1.
- Produces: `emitBundle({ root, outDir }) => { jsFile: string, cssFile: string }` — reads `<root>/index.html`, writes the bundle + rewritten HTML + copied assets into `<outDir>`, and returns the hashed filenames. Also runs the safety guards below (throws on violation).
- Produces (CLI): `node scripts/bundle.mjs` runs `emitBundle({ root: repoRoot, outDir: repoRoot/dist })`.

Safety guards `emitBundle` MUST enforce (throw, non-zero exit):
1. `index.html` missing, or any referenced local script/stylesheet file missing.
2. Any source script contains `document.currentScript` (would behave differently once concatenated).
3. Byte-identity: every source script's exact content is a substring of the concatenated bundle.

Rewrite rules for `dist/index.html`:
- Replace the **last** local `<script src>` tag with `<script src="/{jsFile}"></script>`; replace every **other** local `<script src>` tag with the empty string. (Last position preserves the original bottom-of-body execution timing relative to the inline `<script>` blocks.)
- Repoint the local stylesheet `<link>` to `/{cssFile}`.
- Copy `assets/` (recursively) and `manifest.json` into `dist/` unchanged. Do not copy `sw.js`.

- [ ] **Step 1: Write the failing test**

```js
// append to scripts/bundle.test.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync as rf, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { emitBundle } from "./bundle.mjs";

describe("emitBundle (integration, real repo)", () => {
  it("produces one hashed JS bundle + hashed CSS and a rewritten index.html", () => {
    const out = mkdtempSync(join(tmpdir(), "bundle-"));
    try {
      const { jsFile, cssFile } = emitBundle({ root, outDir: out });
      // hashed filenames
      expect(jsFile).toMatch(/^app\.[0-9a-f]{8}\.js$/);
      expect(cssFile).toMatch(/^index\.[0-9a-f]{8}\.css$/);
      expect(existsSync(join(out, jsFile))).toBe(true);
      expect(existsSync(join(out, cssFile))).toBe(true);
      // rewritten HTML: exactly one app script tag, no leftover local js/ tags
      const html = rf(join(out, "index.html"), "utf8");
      expect(html).toContain(`<script src="/${jsFile}"></script>`);
      expect(html).not.toMatch(/<script\s+src="js\//);
      expect(html).not.toMatch(/<script\s+src="config\.js/);
      expect(html).toContain(`href="/${cssFile}"`);
      // assets copied
      expect(existsSync(join(out, "manifest.json"))).toBe(true);
      expect(readdirSync(join(out, "assets")).length).toBeGreaterThan(0);
      // byte-identity: main.js body present verbatim in the bundle
      const bundle = rf(join(out, jsFile), "utf8");
      const mainSrc = rf(join(root, "js/main.js"), "utf8");
      expect(bundle.includes(mainSrc)).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/bundle.test.mjs`
Expected: FAIL — `emitBundle` is not exported.

Note: the test reads the real `config.js`; if it is absent, run `node build-config.js` first (it is git-ignored and generated).

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/bundle.mjs`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node build-config.js && npx vitest run scripts/bundle.test.mjs`
Expected: PASS. If `config.js` was missing, `build-config.js` generates it first.

- [ ] **Step 5: Run the CLI and inspect real output**

Run: `node build-config.js && node scripts/bundle.mjs && ls dist && grep -c '<script src="js/' dist/index.html`
Expected: `dist/` contains one `app.<hash>.js`, one `index.<hash>.css`, `index.html`, `manifest.json`, `assets/`; the grep prints `0` (no leftover local js script tags).

- [ ] **Step 6: Commit**

```bash
git add scripts/bundle.mjs scripts/bundle.test.mjs
git commit -m "build: emit hashed dist bundle from global scripts"
```

---

## Task 3: Wire the build; retire Phase 0 hashing; delete the service worker

**Files:**
- Modify: `package.json` (build script)
- Delete: `scripts/hash-assets.mjs`, `scripts/hash-assets.test.mjs`
- Delete: `sw.js`
- Modify: `index.html` (strip now-meaningless `?v=` query strings from local `src`/`href`)

**Interfaces:**
- Consumes: `node scripts/bundle.mjs` from Task 2.
- Produces: `npm run build` = `node build-config.js && node scripts/bundle.mjs`.

- [ ] **Step 1: Point the build script at the bundler**

Edit `package.json` `scripts.build`:

```json
"build": "node build-config.js && node scripts/bundle.mjs",
```

- [ ] **Step 2: Delete the retired Phase 0 hasher and its tests, and the service worker**

```bash
git rm scripts/hash-assets.mjs scripts/hash-assets.test.mjs sw.js
```

- [ ] **Step 3: Strip meaningless `?v=` query strings from source `index.html`**

The bundler hashes at build time, so the Phase 0 `?v=<hash>` on source tags is now noise. Remove only the `?v=...` query (keep the paths). Run this one-shot rewrite, then verify:

```bash
node -e '
const fs=require("fs");
let h=fs.readFileSync("index.html","utf8");
h=h.replace(/(src|href)="(?!https?:|\/\/)([^"?#]+)\?v=[^"#]*"/g,(m,a,p)=>`${a}="${p}"`);
fs.writeFileSync("index.html",h);
'
grep -c '?v=' index.html
```
Expected grep output: `0` (the only remaining `?v=` would be the dev-only `demo/mock_stats.js` string assignment inside an inline script, which uses `.src = "…"` not an attribute and is not matched — confirm it is still present with `grep -c "mock_stats.js" index.html` → `1`).

- [ ] **Step 4: Verify the full build and suite**

Run: `npm run build && npm test`
Expected: build prints `bundle: wrote dist/app.<hash>.js …`; Vitest runs only `scripts/bundle.test.mjs` (hash-assets tests are gone) and passes.

- [ ] **Step 5: Commit**

```bash
git add package.json index.html
git commit -m "build: switch build to bundler; retire query-string hashing and service worker"
```

---

## Task 4: Vercel output directory and cache headers

**Files:**
- Modify: `vercel.json`
- Test: `scripts/vercel-config.test.mjs`

**Interfaces:**
- Consumes: the `dist/` output from Task 2/3.

- [ ] **Step 1: Write the failing test**

```js
// scripts/vercel-config.test.mjs
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

const headerFor = (source) => {
  const rule = cfg.headers.find((h) => h.source === source);
  return rule ? rule.headers.find((x) => x.key === "Cache-Control")?.value : undefined;
};

describe("vercel.json", () => {
  it("outputs the dist directory", () => {
    expect(cfg.outputDirectory).toBe("dist");
  });
  it("keeps entry HTML uncacheable", () => {
    expect(headerFor("/")).toContain("no-store");
    expect(headerFor("/index.html")).toContain("no-store");
  });
  it("marks hashed assets immutable and long-lived", () => {
    expect(headerFor("/app.(.*).js") || headerFor("/(.*).js")).toContain("immutable");
    expect(headerFor("/(.*).css") || headerFor("/app.(.*).js")).toContain("max-age=31536000");
  });
  it("drops the removed config.js and sw.js header rules", () => {
    expect(cfg.headers.some((h) => h.source === "/config.js")).toBe(false);
    expect(cfg.headers.some((h) => h.source === "/sw.js")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/vercel-config.test.mjs`
Expected: FAIL — `outputDirectory` is `.`, config.js/sw.js rules still present, no immutable rule.

- [ ] **Step 3: Rewrite `vercel.json`**

```json
{
  "cleanUrls": true,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)\\.js",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/(.*)\\.css",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/",
      "headers": [{ "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" }]
    },
    {
      "source": "/index.html",
      "headers": [{ "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" }]
    }
  ]
}
```

Note: the test's `headerFor` looks up exact `source` strings. Update the test's expected sources to match these regex sources (`/(.*)\\.js`, `/(.*)\\.css`) before running — i.e. in Step 1 the lookups already fall back to `/(.*).js` / `/(.*).css`. Confirm the fallbacks match the sources you wrote; adjust the test literals to equal the `vercel.json` `source` values exactly if needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/vercel-config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel.json scripts/vercel-config.test.mjs
git commit -m "build: serve dist with immutable hashed assets and uncacheable entry HTML"
```

---

## Task 5: CI asserts the bundled output

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a bundle-output assertion to the build step**

Replace the existing `Verify build succeeds` step in `.github/workflows/ci.yml` with:

```yaml
      - name: Build and verify bundled output
        run: |
          npm run build
          test -n "$(ls dist/app.*.js 2>/dev/null)" || { echo "no hashed app bundle in dist/"; exit 1; }
          test -n "$(ls dist/index.*.css 2>/dev/null)" || { echo "no hashed css in dist/"; exit 1; }
          test -f dist/index.html || { echo "no dist/index.html"; exit 1; }
        env:
          SUPABASE_URL: https://placeholder.supabase.co
          SUPABASE_ANON_KEY: placeholder-anon-key
```

- [ ] **Step 2: Validate the workflow parses**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!s.includes('dist/app')) process.exit(1); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Locally simulate the CI build+assert**

Run: `SUPABASE_URL=https://placeholder.supabase.co SUPABASE_ANON_KEY=placeholder npm run build && ls dist/app.*.js dist/index.*.css dist/index.html`
Expected: the three artifacts listed; exit 0. Afterwards regenerate the real config: `node build-config.js`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: assert hashed bundle output is produced"
```

---

## Release gate (human, before production promotion)

Not a code task — the freeze exit criteria. After merge, on a Vercel **preview** deployment:

- [ ] App boots; dashboard, reader, plan, and stats views render.
- [ ] NLC SSO login flow initiates (redirects to Logto).
- [ ] DevTools → Network shows exactly one `app.<hash>.js` and one `index.<hash>.css`, both with `Cache-Control: …immutable`; the entry document is `no-store`.
- [ ] DevTools → Application shows **no** registered service worker (old ones unregistered by the retained `main.js` block).
- [ ] Only after this passes: promote to production, then lift the feature freeze.

---

## Self-Review

- **Spec coverage:** dev/prod split → Tasks 1–3. Filename-hashed bundle + hashed CSS → Task 2. `sw.js` retirement + retained `main.js` unregister → Task 3 (main.js untouched). `vercel.json` output + headers → Task 4. CI → Task 5. Byte-identity + `document.currentScript` guard + ordering-preservation → Task 2 guards + last-tag insertion. `config.js` folded into bundle → Task 2 (it is in the resolved script list). Preview smoke gate → Release gate. Retire `hash-assets.mjs` → Task 3. All spec deliverables mapped.
- **Placeholder scan:** every code step contains complete, runnable content; no TBD/TODO. The one soft spot — Task 4 Step 3's note to align test literals with the `vercel.json` `source` regex strings — is made concrete by giving both the exact sources and the fallback lookups in the test.
- **Type/name consistency:** `resolveLocalAssets`/`concatScripts`/`contentHash`/`emitBundle` names and signatures are identical across Tasks 1, 2, and their tests. `jsFile`/`cssFile` return keys used consistently in Task 2 and Task 5's assertions (`dist/app.*.js`, `dist/index.*.css`).
- **Out of scope confirmed:** no `.ts`, no Vite, no module conversion, no static-asset hashing — consistent with the spec's non-goals.
