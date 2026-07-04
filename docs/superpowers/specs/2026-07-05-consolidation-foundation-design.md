# Consolidation — Stage 1: Foundation (Design Spec)

**Date:** 2026-07-05
**Status:** Draft for review
**Part of:** the "big consolidation" toward long-run reliability (Tier C — Full Health), decomposed into three sequenced, independently-deployable sub-projects. This spec covers **Stage 1 only**.

## Context

The app (see `CLAUDE.md`) is a buildless vanilla-JS PWA: ~15 classic global `<script>` files with load-order coupling, served from the repo root on Vercel. Its most acute, recurring operational wound is stale mobile caches — the git history shows dozens of commits fighting it, ending in a self-destructing service worker. Phase 0 (already merged on this branch) made the existing `?v=` cache-busting content-based and automatic; this stage supersedes and hardens that into the permanent solution, and lays the tooling groundwork for later stages — **without changing any runtime logic.**

## Decisions locked in brainstorming

- **Target ambition:** Tier C (full health), reached across three stages. Stage 1 = Foundation.
- **Parallel development:** a **short feature freeze** covers Stage 1 only (the one part that can't be sliced small). Stages 2–3 run interleaved with the feature train, no freeze.
- **Type strategy:** gradual TypeScript (`allowJs`) — but **no `.ts` files or type tooling land in Stage 1** (YAGNI); TS scaffolding arrives in Stage 2 with the first real module.
- **Migration mechanism:** "bundle-only, keep globals" for the freeze. The JS files are **not** converted to ES modules in Stage 1. Real modularization is deferred to Stage 2, where it is lower-risk and interleaved.
- **Vite timing:** empirically, Vite cannot bundle classic global scripts. So Stage 1's bundler is a minimal concatenate-and-content-hash step. **Vite formally enters in Stage 2**, when files become modules and it can do its job.

## Goal

During a short freeze, deliver a build that produces one content-hashed JavaScript bundle (and a content-hashed stylesheet) from the existing global scripts, retire the self-destructing service worker, and prove the app behaves byte-for-byte identically. Every commit stays deployable.

## Non-goals (explicitly out of scope for Stage 1)

- Converting any file to an ES module.
- Decomposing `db.js` / `plan.js` or any other file.
- Introducing Vite, TypeScript, `.ts` files, or a type-check CI step.
- Hashing static assets (icons, `manifest.json`) — they are stable and not part of the cache wound.
- Any change to application behavior, DOM, styling, or copy.

## Architecture

A **dev/prod split**, the same philosophy Vite uses, implemented minimally for classic scripts:

- **Dev** (`npm run dev` → `npx serve .`): unchanged. `index.html` keeps its individual `<script>` tags; developers iterate on raw files with no build. Stale cache is a non-issue on localhost.
- **Prod** (Vercel build): a new bundler reads `index.html`, concatenates the local JS it references (in exact document order) into one file, content-hashes it by filename (`app.<hash>.js` — filename hashing, not query-string, so it is immune to proxies that ignore query strings), does the same for `index.css` (`index.<hash>.css`), rewrites a copy of `index.html` to reference the hashed bundle + stylesheet, and writes everything to a `dist/` output directory.

### Components

**1. Bundler script (`scripts/bundle.mjs`)** — pure, testable, no framework. Responsibilities:
- Parse `index.html` for local `<script src>` tags (the ~15 app files, in order) and the local `<link rel="stylesheet">`.
- Concatenate the JS files in document order into a single string, separated by newlines and `//# sourceURL=<original path>` markers (so runtime stack traces still name the original file — preserves the app's existing `window.onerror` debugging affordance).
- Compute an 8-char content hash of the concatenated JS and of the CSS; write `dist/app.<hash>.js` and `dist/index.<hash>.css`.
- Emit `dist/index.html`: the ~15 script tags replaced by one `<script src="/app.<hash>.js"></script>` **at the position of the last (bottom) script tag** so execution order relative to inline scripts is preserved; the stylesheet link repointed to the hashed CSS.
- Copy remaining referenced files (`assets/`, `manifest.json`, and any other static references) into `dist/` unchanged.
- Deliberately NOT copy `sw.js` (see service-worker retirement).

The concatenation-order function is factored out as a pure unit (`resolveScriptOrder(html) => string[]`) and tested against the real `index.html`.

**2. Build orchestration** — `npm run build` becomes: `node build-config.js` (generate `config.js` from env, unchanged) → `node scripts/bundle.mjs`. `vercel.json` `outputDirectory` changes from `.` to `dist`. The Phase 0 `scripts/hash-assets.mjs` (query-string hashing) is **retired** — its job is subsumed by filename-hashed bundling; its unit tests are removed with it.

`vercel.json` `headers` are updated to match the hashed-asset model, and this is a required deliverable — hashed filenames are pointless without it:
- **Retain** `no-store` on `/` and `/index.html` (the entry HTML must never be cached, so clients always fetch the newest hash references).
- **Drop** the `/config.js` and `/sw.js` header entries (both files are gone from output — `config.js` is bundled, `sw.js` is deleted).
- **Add** `Cache-Control: public, max-age=31536000, immutable` for the hashed assets (`/app.*.js`, `/*.css`) — safe precisely because their filenames change on every content change.

**3. Service-worker retirement** — delete `sw.js`. Keep the existing SW-unregister + cache-clear block in `js/main.js` (it actively removes any lingering old service worker from clients that still have one) — it is harmless once no SW is registered and protects existing installs during the transition. A later stage may remove it once telemetry shows no registered SWs remain.

### Data flow (build time)

```
.env ──build-config.js──▶ config.js ─┐
index.html ──bundle.mjs──▶ reads script/link order
js/*.js (15 files, incl. config.js) ─┴─concat+hash─▶ dist/app.<hash>.js
index.css ──hash──▶ dist/index.<hash>.css
index.html ──rewrite──▶ dist/index.html (1 script tag, hashed css link)
assets/, manifest.json ──copy──▶ dist/
sw.js ──(dropped)
```

Note: `config.js` (public Supabase anon key + NLC client id — already shipped to the browser today) is concatenated into the bundle. This is intentional: it lets the bundle hash change when config changes and removes the need for the special `no-store` header on `config.js`.

## Correctness strategy: prove byte-identical behavior

The core risk is that concatenation changes execution semantics. Mitigations, each a required verification step in the plan:

1. **Global-scope equivalence:** classic scripts all execute in global scope in sequence; concatenating them in the same order is semantically identical *unless* a file relies on per-script isolation. The plan must grep for and rule out: top-level `return`, `document.currentScript`, and duplicate top-level `const`/`let` declarations across files (which would collide when concatenated but not as separate scripts). Any hit is a blocker to resolve before bundling.
2. **Ordering vs. inline scripts:** three JS files currently load early (`config.js`, `bible_data.js`, `bible_verse_counts.js`) while three inline `<script>` blocks (error handler, `MOCK_*` defaults, localhost demo loader) sit between them and the bottom scripts. Moving the early files into the bottom bundle is safe only if no inline block depends on their globals — the plan verifies this by inspection (it does not today). If any dependency exists, fall back to emitting **two** bundles (early + main) at the original split points.
3. **Bundle-vs-source diff check:** a build-time assertion that the concatenated bundle contains each source file's content verbatim and in order.
4. **Manual smoke on a Vercel preview:** load the preview URL, confirm the app boots, the reader/plan/stats views render, login flow initiates, and DevTools shows exactly one hashed `app.<hash>.js` + one hashed CSS with far-future cache headers and no service worker registered. This is the human gate before production promotion.

## Error handling

- The bundler fails loudly (non-zero exit) if: `index.html` is missing, a referenced local script file is missing, the isolation grep (step 1) finds a collision, or `dist/` cannot be written. A failed build blocks the Vercel deploy — the running production app is unaffected.
- Runtime error handling is unchanged; the `//# sourceURL` markers preserve the existing on-screen `window.onerror` debug banner's file attribution.

## Testing

- **Unit (Vitest):** `resolveScriptOrder(html)` returns the exact ordered list of local scripts from the real `index.html`; the hash function is deterministic; the isolation-collision detector flags a synthetic duplicate-`const` fixture and passes clean fixtures.
- **Build integration:** running `npm run build` against the repo produces `dist/` with one `app.<hash>.js`, one `index.<hash>.css`, a rewritten `dist/index.html` with a single app script tag, and the byte-for-byte concatenation assertion (step 3) passing.
- **CI:** extend the existing `.github/workflows/ci.yml` to run the build and assert `dist/app.*.js` exists. No type-check step yet.
- **Human gate:** the preview-URL smoke (correctness step 4) before promoting to production.

## Rollback

Purely build-layer. Reverting the `vercel.json` `outputDirectory` back to `.` and restoring the Phase 0 state returns to per-file `?v=` hashing with zero code changes. Because no runtime logic was touched, rollback risk is minimal.

## Deliverables checklist

- `scripts/bundle.mjs` + tests; `scripts/hash-assets.mjs` retired.
- `npm run build` = config-gen → bundle; `vercel.json` `outputDirectory: dist` + updated cache headers (no-store entry HTML, immutable hashed assets, drop config.js/sw.js).
- `sw.js` deleted; `main.js` SW-unregister retained.
- CI runs the build and asserts bundled output.
- Verified byte-identical on a Vercel preview before production.

## What comes after (not this spec)

- **Stage 2 — Data/domain hardening (interleaved):** files become ES modules; Vite replaces the concat bundler; `db.js`/`plan.js` decompose; gradual-TS types + the single-sourced shim↔Edge-Function contract; broaden tests (building on the Task 1.1 shim contract already banked).
- **Stage 3 — Presentation overhaul (interleaved):** extract inline styles/HTML into components, accessibility pass, dead-code removal.
