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

The steps above now apply only to free reading (no plan). Plan check-ins go through the check-in outbox below.

## Check-in outbox (#356)

- `js/pwa/CheckInOutbox.js` (pure logic) + `js/pwa/CheckInSync.js` (app glue, created in `app.js` right after the `IndexedDbClient`).
- Every plan-bound check/uncheck from `db.logChapterRead()` is written to the outbox first, online or offline, and the UI stays optimistic. Records live in the existing `offline_operations` store with `type: "CHECK_IN_CHAPTER"`, `status: "outbox"` (no schema bump; the old sync manager only picks `status: "pending"`). Key `planId|book|chapter|round`, so check → uncheck collapses to the latest intent. Each record carries user id, desired state, pressed-at time and a `client_id` — never credentials. If IndexedDB fails the item stays in memory and is still sent; `isSafeToReloadForUpdate` then refuses to reload.
- Flush (FIFO, single-flight): app start, after each enqueue, `online`, `onAppForeground`, SW `SYNC_REQUEST` (Background Sync tag `newlife-reading-sync`), and every successful `nlc-session` sync (re-login / reconnect). No polling timer. The sender is `db.logChapterRead(..., { direct: true, readAt, clientId })` → `record_chapter_read` / `unrecord_chapter_read`.
- Thrown error (network, 401, 5xx) → item stays, flush stops, exponential backoff (2 s … 5 min) gates non-forced flushes. `{ ok: true }` (incl. `already_read`) → removed. `{ ok: false, reason }` → removed, the chapter is reverted in `state.readingLogs`, progress recalculated, tracker re-rendered, toast with the zh-Hant reason.
- Reloaded reading logs get pending intents overlaid (`db._overlayPendingCheckIns`). Only the signed-in user's items are sent; another user's are dropped when a session is verified. Explicit logout asks for confirmation when items are pending and then clears them. 「進入下一遍」 flushes first and refuses while that plan still has pending items.
- A 「N 章等待同步」 chip (`.checkin-pending-chip`) shows while the current user has pending items; tapping it forces a flush.

## Cache routing

- Navigation: Network First; `/index.html` fallback. A reachable-but-5xx response is treated the same as a failed fetch and also falls back to the cached shell (see `CacheManager.networkFirst`'s `fallbackUrl` handling), so a maintenance/deploy-time error page never overwrites the cached app shell.
- Same-origin scripts, CSS, fonts, images, and manifest: Cache First.
- Missing content-hashed CSS: retry the stable /index.css entry with a build-version query; deployment rewrites stale index.<hash>.css URLs to that stable entry.
- `bible-api.com` and `bolls.life`: Network First with runtime cache fallback.
- Non-GET and sensitive API traffic: bypass Service Worker handling.

## Versioning

Change the `VERSION` constant in `sw.js` whenever cache contents or routing behavior changes. Activation deletes only caches beginning with `newlife-bible-`; never delete unrelated origin caches.
