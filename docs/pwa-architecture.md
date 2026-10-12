# PWA architecture

## Scope

The app uses a deliberately limited offline model:

- Cache same-origin static assets and successful public Bible API chapter responses.
- Use network-first navigation with the last successful app shell as an offline fallback.
- Never cache authentication, Supabase/NLC, rankings, member status, reminders, or admin responses.
- Queue reading-log mutations only when the browser is explicitly offline or a request fails at the network layer.
- Keep NLC and Supabase credentials outside IndexedDB and Cache Storage.
- Permit a previously verified user to enter a restricted offline-reading session for up to 30 days. This local identity is not accepted as server authentication.
- Store explicitly downloaded, public/open-licensed Bible packs in dedicated IndexedDB stores, separate from runtime HTTP caches.

## Modules

- `sw.js`: lifecycle and request-routing entry point only.
- `js/pwa/CacheManager.js`: cache strategies and version cleanup.
- `js/pwa/IndexedDbClient.js`: IndexedDB schema and transaction adapter.
- `js/pwa/OfflineQueueRepository.js`: persistent operation queue.
- `js/pwa/OfflineSyncManager.js`: retry, backoff, and status events.
- `js/pwa/ServiceWorkerRegistrar.js`: browser registration and SW messaging.
- `js/pwa/PwaCoordinator.js`: application integration for authenticated reading logs.
- `js/pwa/OfflineBibleRepository.js`: validates, installs, reads, and removes complete 1,189-chapter Bible packs.
- `js/pwa/OfflineBibleControls.js`: download progress and storage controls in profile preferences.

## Trusted offline reading

- A successful online NLC session unconditionally stores a minimal `offline_trusted_identity` snapshot for every user — this is not a togglable device preference.
- The snapshot expires 30 days after the last successful server verification.
- Offline mode restores cached plans and reading logs, hides management navigation, and never treats the local snapshot as an access token.
- Explicit logout or an authentication rejection removes the trusted identity. A transient network failure does not remove refresh credentials. There is currently no other user-facing action that purges a device's cached identity short of logout.
- Returning online revalidates the NLC session before restoring server-backed features and syncing queued reading logs.
- 快速啟動聖經 (`quick_launch_bible_enabled`, opt-in in 偏好設定): on boot, if a cached identity exists, shows it immediately and lands on the reader tab without waiting for the OIDC code exchange or the NLC session sync — both run in the background via `db.js`'s `startBackgroundSessionReconciliation()`. A reachable-but-erroring (5xx) response from `nlc-session` is treated the same as a dead connection (see `isNetworkUnreachableError()`), so the cached identity is also kept during a backend outage/deploy, not just a real network drop.

## Offline Bible packs

- Online reading defaults to CUNP and continues to use the existing exact-version API path.
- Downloadable packs are currently OCCB Traditional (`CC BY-SA 4.0`) and WEB (`Public Domain`). Their source and attribution metadata travel with each pack.
- A pack is marked installed only after all 1,189 chapters have been parsed and committed to IndexedDB.
- Reader resolution order is installed IndexedDB chapter, exact online source, then the existing visible load-failure fallback.
- Bible packs contain public scripture text only and remain separate from private account caches.

## Data flow

1. Online reading updates continue through `db.logChapterRead()`.
2. Offline updates are applied to local state and written to `offline_operations`.
3. Repeated toggles for the same user/plan/chapter/round replace the queued payload, preserving only the final desired state.
4. `online`, Background Sync, or a SW `SYNC_REQUEST` triggers a flush in an open client.
5. The client uses its current authenticated data client; the Service Worker never stores tokens.
6. Permanent 4xx failures stop retrying. Network errors and retryable status codes use bounded exponential backoff.

## Cache routing

- Navigation: Network First; `/index.html` fallback. A reachable-but-5xx response is treated the same as a failed fetch and also falls back to the cached shell (see `CacheManager.networkFirst`'s `fallbackUrl` handling), so a maintenance/deploy-time error page never overwrites the cached app shell.
- Same-origin scripts, CSS, fonts, images, and manifest: Cache First.
- Missing content-hashed CSS: retry the stable /index.css entry with a build-version query; deployment rewrites stale index.<hash>.css URLs to that stable entry.
- `bible-api.com`, `bolls.life` and `bible.fhl.net` (1–2 character keyword search, #366): Network First with runtime cache fallback.
- Non-GET and sensitive API traffic: bypass Service Worker handling.

## Security headers (#553)

`vercel.json`'s first rule (`/(.*)`) sets the site-wide headers: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (device permissions the app never uses are off; sharing and clipboard stay on), HSTS, `X-Frame-Options: DENY`, and an **enforced** CSP that only carries `frame-ancestors 'none'`.

The full CSP runs as `Content-Security-Policy-Report-Only` while we observe it: scripts are allowed from `'self'`, the two CDNs, and the **sha256 hash of each inline `<script>`** in the HTML entry points; styles still allow inline (hundreds of `style=""` attributes). Violations only show up in the browser Console — there is no collection endpoint. After editing any inline `<script>`, run `node scripts/security-headers.mjs` and paste the hashes into `script-src`; `scripts/security-headers.test.mjs` fails until you do. Inline event handlers (`onclick=`, `onerror=` on `<link>`) are expected violations until they are converted to `addEventListener`, which is a prerequisite for switching the policy to enforced (separate issue).

## Versioning

Change the `VERSION` constant in `sw.js` whenever cache contents or routing behavior changes. Activation deletes only caches beginning with `newlife-bible-`; never delete unrelated origin caches.

## Updates and stale builds

Moved from `CLAUDE.md` (#381); the rules themselves stay summarized there.

Church members run this as an installed mobile PWA that can sit in the background for days, so "users stuck on an old build" is the failure mode everything here is designed against. **There are no hand-maintained version strings anymore** — don't add `?v=` to imports, `<script>`, or `<link>` tags (`scripts/no-manual-cache-bust.test.mjs` fails if you do; `?v=` on images under `assets/` is fine, those aren't hashed).

- JS/CSS reach production only through `scripts/bundle.mjs`: the entry (`app.<hash>.js`), stylesheet (`index.<hash>.css`), and exam/grade entries are content-hashed and served `immutable`.
- The lazy tab modules (`home.js`, `bible.js`, `plan.js`, `admin.js`, `profile.js`, `team-registration.js`, `campaign-rule-editor.js`, `onboarding-helper.js`, and the React `issue-report-ui.js` island) are listed as literal `import()`s in `LAZY_MODULE_LOADERS` in `js/app.js`, and `scripts/bundle.mjs` builds `app.js` with `esbuild --splitting` so each becomes a **content-hashed chunk** under `dist/chunks/` (served `immutable`). **Nothing to bump by hand**: a changed module gets a new filename, and a tab left open across a deploy keeps loading its own build's chunks instead of mixing new module code into old in-memory `db`/`state`. If an old chunk is already gone (404 after a deploy), `loadModule` hands off to `js/pwa/VersionWatcher.js`, which reloads into the new build. To add a lazy module, add a literal `import()` entry to `LAZY_MODULE_LOADERS` — a computed path (`import(path)`) can't be split and will break the production build. `js/app.js`'s `"__BUILD_VERSION__"` placeholder is replaced with the build timestamp, which is also written to `dist/version.json`; `VersionWatcher` compares the two on launch/foreground to detect and reload a stale build.
- **Detecting a stale build**: `js/pwa/VersionWatcher.js` compares the running build id with `/version.json` on launch, on return to foreground (≤ 1 probe / 5 min), when a new SW takes control, when a chunk fails to load, and from 個人設定 → 檢查更新. No polling while the app is closed/backgrounded. Newer build found → reload once at a safe moment; if the reload still lands on the old build → `/repair` once; sessionStorage guards make both one-shot so it can't loop.
- **Not a safe moment** (typing, TTS playing, unsynced offline queue) → `js/pwa/UpdateBanner.js` shows a non-blocking 「有新版本」 banner instead; the user's tap updates immediately.
- **Breaking backend change** (RPC renamed, column dropped — anything an old frontend would break on): set `forceUpdateBuiltBefore` in `release-policy.json` to the deploy time **with a timezone** (e.g. `2026-09-23T13:00:00+08:00`) and **commit it in the same release as the migration** — the build reads only the committed file (Vercel builds from git; there is no env override), so a value that isn't committed never takes effect. Every older build then reloads immediately regardless of safety. The build fails on a missing timezone or a cutoff later than the build itself, and `scripts/bundle.test.mjs` enforces the same rule on the committed file. Keep it `null` otherwise; an old past cutoff is harmless (every newer build is already past it), so resetting it to `null` in a later release is optional. Only use it when something an old build calls in normal use would break — admin-only breakage that a page refresh fixes doesn't need it, since `VersionWatcher` updates at the next safe moment anyway.
- `/repair` (`repair.html`) only unregisters the SW and clears app caches — never login tokens or reading progress. It's reached from VersionWatcher's last-resort escalation, the second tap of 檢查更新, the login gate's 「更新至最新版」, and the CSS-load-failure overlay. Login failures do **not** route through it (that old 「修復並重新登入」 detour fired on routine session expiry and was removed).
- `sw.js` is a thin, module-based Service Worker. It delegates cache behavior to `js/pwa/CacheManager.js`; never put business logic directly in lifecycle handlers.
- Cache only same-origin static assets and public Bible API responses. Authentication, Supabase/NLC, rankings, member data, and admin data must bypass Service Worker caching.
- Authenticated reading-log writes may be queued in IndexedDB by `PwaCoordinator`; credentials are never persisted in the queue. Background Sync asks an open authenticated client to flush the queue.
- `vercel.json` must keep `/`, `/index.html`, and `/sw.js` non-immutable. Hashed app bundles and versioned runtime modules may use immutable caching.
