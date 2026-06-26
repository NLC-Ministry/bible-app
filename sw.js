const CACHE_NAME = 'church-bible-reading-v5';
const DYNAMIC_CACHE_NAME = 'church-bible-dynamic-v5';

// Static resources to precache
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './index.css',
  './bible_data.js',
  './config.js',
  './mock_stats.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './js/state.js',
  './js/db.js',
  './js/gamification.js',
  './js/main.js',
  './js/views/dashboard.js',
  './js/views/reader.js',
  './js/views/plan.js',
  './js/views/stats.js',
  './js/views/profile.js'
];

// Install Event: cache static shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching app shell...');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: intercept requests and apply cache strategies
self.addEventListener('fetch', (e) => {
  const requestUrl = new URL(e.request.url);

  // 1. Bypass caching for Supabase API requests (authentication, database reads/writes)
  if (requestUrl.hostname.includes('supabase.co')) {
    return; // Let the browser handle normally (network only)
  }

  // 2. Cache-First Strategy for Bible Text API (bible-api.com) to allow offline reading
  if (requestUrl.hostname.includes('bible-api.com')) {
    e.respondWith(
      caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[Service Worker] Serving Bible text from cache:', requestUrl.pathname);
            return cachedResponse;
          }
          
          return fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch((err) => {
            console.warn('[Service Worker] Bible API fetch failed, no cache matches:', err);
            // Will fallback to local offline text in bible_data.js
            throw err;
          });
        });
      })
    );
    return;
  }

  // 3. Stale-While-Revalidate for CDN assets (fonts, supabase client, chart.js)
  if (
    requestUrl.hostname.includes('jsdelivr.net') ||
    requestUrl.hostname.includes('googleapis.com') ||
    requestUrl.hostname.includes('gstatic.com')
  ) {
    e.respondWith(
      caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((cachedResponse) => {
          const fetchPromise = fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Offline fallback for CDNs if cached
            if (cachedResponse) return cachedResponse;
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. Stale-While-Revalidate for Local App Shell assets
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        // Only cache valid standard GET responses
        if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, cacheCopy);
          });
        }
        return networkResponse;
      }).catch((err) => {
        console.warn('[Service Worker] Fetch failed, returning cache if available:', err);
      });
      
      return cachedResponse || fetchPromise;
    })
  );
});
