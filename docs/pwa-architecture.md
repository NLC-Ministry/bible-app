# PWA architecture

## Scope

The app uses a deliberately limited offline model:

- Cache same-origin static assets and successful public Bible API chapter responses.
- Use network-first navigation with the last successful app shell as an offline fallback.
- Never cache authentication, Supabase/NLC, rankings, member status, reminders, or admin responses.
- Queue reading-log mutations only when the browser is explicitly offline or a request fails at the network layer.
- Keep NLC and Supabase credentials outside IndexedDB and Cache Storage.

## Modules

- `sw.js`: lifecycle and request-routing entry point only.
- `js/pwa/CacheManager.js`: cache strategies and version cleanup.
- `js/pwa/IndexedDbClient.js`: IndexedDB schema and transaction adapter.
- `js/pwa/OfflineQueueRepository.js`: persistent operation queue.
- `js/pwa/OfflineSyncManager.js`: retry, backoff, and status events.
- `js/pwa/ServiceWorkerRegistrar.js`: browser registration and SW messaging.
- `js/pwa/PwaCoordinator.js`: application integration for authenticated reading logs.

## Data flow

1. Online reading updates continue through `db.logChapterRead()`.
2. Offline updates are applied to local state and written to `offline_operations`.
3. Repeated toggles for the same user/plan/chapter/round replace the queued payload, preserving only the final desired state.
4. `online`, Background Sync, or a SW `SYNC_REQUEST` triggers a flush in an open client.
5. The client uses its current authenticated data client; the Service Worker never stores tokens.
6. Permanent 4xx failures stop retrying. Network errors and retryable status codes use bounded exponential backoff.

## Cache routing

- Navigation: Network First; `/index.html` fallback.
- Same-origin scripts, CSS, fonts, images, and manifest: Cache First.
- `bible-api.com` and `bolls.life`: Network First with runtime cache fallback.
- Non-GET and sensitive API traffic: bypass Service Worker handling.

## Versioning

Change the `VERSION` constant in `sw.js` whenever cache contents or routing behavior changes. Activation deletes only caches beginning with `newlife-bible-`; never delete unrelated origin caches.