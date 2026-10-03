import { CacheManager } from "./js/pwa/CacheManager.js";

const VERSION = "__BUILD_VERSION__";
const cacheManager = new CacheManager({
  prefix: "newlife-bible",
  version: VERSION,
  fetchImpl: (...args) => globalThis.fetch(...args)
});
const BUILD_JS_PATH = "__BUILD_JS_PATH__";
const BUILD_CSS_PATH = "__BUILD_CSS_PATH__";
// 快速啟動聖經的獨立讀經頁（#416）：預先快取，離線、登入失效時也打得開。
const READ_PAGE_PATH = "/read";
const BUILD_READ_JS_PATH = "__BUILD_READ_JS_PATH__";
const APP_SHELL = [
  "/",
  ...(BUILD_JS_PATH.startsWith("/") ? [BUILD_JS_PATH] : []),
  "/index.css",
  ...(BUILD_CSS_PATH.startsWith("/") ? [BUILD_CSS_PATH] : []),
  READ_PAGE_PATH,
  ...(BUILD_READ_JS_PATH.startsWith("/") ? [BUILD_READ_JS_PATH] : []),
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png"
];

function isSupabaseApiRequest(request) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const isSupabaseHost = hostname === "supabase.co" || hostname.endsWith(".supabase.co");
  const isSupabaseApiPath = ["/rest/v1/", "/auth/v1/", "/functions/v1/", "/storage/v1/", "/realtime/v1/"].some(path =>
    url.pathname.includes(path)
  );
  return isSupabaseHost || isSupabaseApiPath;
}

function shouldBypassCache(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();

  const hasAuthBridgeSignal = url.searchParams.has("auth_continuation")
    || url.searchParams.has("auth_bridge_attempted")
    || url.searchParams.has("openExternalBrowser")
    || url.searchParams.has("version");
  const hasOauthCallbackSignal = (url.pathname === "/" || url.pathname === "/index.html")
    && (url.searchParams.has("code") || url.searchParams.has("state") || url.searchParams.has("error"));

  const isRepairPage = url.pathname === "/repair" || url.pathname === "/repair.html";
  // The stale-build probe (VersionWatcher) must always see the live deploy.
  const isVersionProbe = url.origin === self.location.origin && url.pathname === "/version.json";

  // 速讀「大測驗」是完全獨立的一頁：永遠走網路、絕不讓 Service Worker 用
  // networkFirst 的 "/" fallback 把它換成 SPA 外殼 (index.html)。
  const isExamPage = url.origin === self.location.origin
    && (url.pathname === "/exam" || url.pathname === "/exam.html" || url.pathname === "/exam/");

  // 線上簡答批改頁（grade.html）同理：獨立一頁，永遠走網路。
  const isGradePage = url.origin === self.location.origin
    && (url.pathname === "/grade" || url.pathname === "/grade.html" || url.pathname === "/grade/");

  return isRepairPage || isVersionProbe || isExamPage || isGradePage || isSupabaseApiRequest(request) || hostname.includes("logto") || hostname.includes("sso.newlife.org.tw") ||
    hasAuthBridgeSignal || hasOauthCallbackSignal || url.pathname.includes("/auth/") || url.pathname.includes("/functions/v1/nlc-");
}

function isReadPagePath(pathname) {
  return pathname === READ_PAGE_PATH || pathname === "/read.html" || pathname === "/read/";
}

function isBibleRequest(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "bible-api.com" || hostname === "bolls.life" || hostname === "bible.fhl.net";
}

function isStaticRequest(request) {
  if (new URL(request.url).origin !== self.location.origin) return false;
  return ["style", "script", "font", "image"].includes(request.destination) ||
    new URL(request.url).pathname === "/manifest.json";
}

function isVersionedStylesheetRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && /^\/index\.[0-9a-f]+\.css$/i.test(url.pathname);
}

async function cacheStaticWithStyleRecovery(request) {
  const response = await cacheManager.cacheFirst(request);
  if (response.ok || !isVersionedStylesheetRequest(request)) return response;

  try {
    const fallback = await fetch(`/index.css?version=${VERSION}`, { cache: "no-store" });
    return fallback.ok ? fallback : response;
  } catch (error) {
    return response;
  }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const skipped = await cacheManager.precache(APP_SHELL, { required: ["/"] });
    if (skipped.length) console.warn("[SW] Precache skipped (will cache on demand):", skipped);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([cacheManager.cleanup(), self.clients.claim()]));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (shouldBypassCache(request)) return;

  if (request.mode === "navigate") {
    // 讀經頁離線時退回快取的讀經頁自己，不要換成 SPA 外殼（#416）。
    const isReadPage = isReadPagePath(new URL(request.url).pathname);
    event.respondWith(cacheManager.networkFirst(request, {
      timeoutMs: 8000,
      fallbackUrl: isReadPage ? READ_PAGE_PATH : "/"
    }));
    return;
  }

  if (isBibleRequest(request)) {
    event.respondWith(cacheManager.networkFirst(request, { timeoutMs: 4500 }));
    return;
  }

  if (isStaticRequest(request)) {
    const url = new URL(request.url);
    // Unhashed /app.js alias: network first so a deploy is picked up. Lazy view
    // modules are content-hashed chunks under /chunks/ (scripts/bundle.mjs), so
    // they fall through to cacheFirst below — a given filename never changes.
    if (url.pathname === "/app.js") {
      event.respondWith(cacheManager.networkFirst(request, { timeoutMs: 3000 }));
      return;
    }
    event.respondWith(cacheStaticWithStyleRecovery(request));
  }
});

async function requestClientSync() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: "SYNC_REQUEST" }));
}

self.addEventListener("sync", event => {
  if (event.tag === "newlife-reading-sync") event.waitUntil(requestClientSync());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SYNC_NOW") event.waitUntil(requestClientSync());
});

self.addEventListener("push", event => {
  let pushData = {};
  try {
    pushData = event.data ? event.data.json() : {};
  } catch (e) {
    pushData = { title: event.data ? event.data.text() : "新訊息" };
  }

  const unreadCount = typeof pushData.unreadCount === "number" ? pushData.unreadCount : 0;
  
  const options = {
    body: pushData.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    data: pushData
  };

  const notificationPromise = self.registration.showNotification(
    pushData.title || "新生命速讀計畫",
    options
  );

  let badgePromise = Promise.resolve();
  if ("setAppBadge" in navigator) {
    badgePromise = navigator.setAppBadge(unreadCount).catch(err => {
      console.error("Service Worker 角標設定失敗:", err);
    });
  }

  event.waitUntil(Promise.all([notificationPromise, badgePromise]));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  // 帶參數開完整 App：開了快速啟動的人，無參數的 "/" 會被轉到讀經頁 /read，看不到通知內容（#416）。
  const notificationUrl = "/?from=notification";
  const clickPromise = self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(windowClients => {
      for (const client of windowClients) {
        if ("focus" in client && typeof client.focus === "function") {
          let onReadPage = false;
          try { onReadPage = isReadPagePath(new URL(client.url).pathname); } catch (_) {}
          if (onReadPage && typeof client.navigate === "function") {
            return client.navigate(notificationUrl).then(target => (target || client).focus());
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(notificationUrl);
      }
    })
    .then(() => {
      if ("clearAppBadge" in navigator) {
        return navigator.clearAppBadge().catch(err => {
          console.error("Service Worker 點擊通知清除角標失敗:", err);
        });
      }
    });

  event.waitUntil(clickPromise);
});
