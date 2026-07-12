import { CacheManager } from "./js/pwa/CacheManager.js";

const VERSION = "20260712-1";
const cacheManager = new CacheManager({ prefix: "newlife-bible", version: VERSION });
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/assets/icon-192.png", "/assets/icon-512.png"];

function isSensitiveRequest(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  return hostname.includes("supabase") || hostname.includes("logto") || hostname.includes("sso.newlife.org.tw") ||
    url.pathname.includes("/auth/") || url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/functions/v1/nlc-");
}

function isBibleRequest(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "bible-api.com" || hostname === "bolls.life";
}

function isStaticRequest(request) {
  if (new URL(request.url).origin !== self.location.origin) return false;
  return ["style", "script", "font", "image"].includes(request.destination) ||
    new URL(request.url).pathname === "/manifest.json";
}

self.addEventListener("install", event => {
  event.waitUntil(cacheManager.precache(APP_SHELL));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([cacheManager.cleanup(), self.clients.claim()]));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (isSensitiveRequest(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(cacheManager.networkFirst(request, { timeoutMs: 5000, fallbackUrl: "/index.html" }));
    return;
  }

  if (isBibleRequest(request)) {
    event.respondWith(cacheManager.networkFirst(request, { timeoutMs: 4500 }));
    return;
  }

  if (isStaticRequest(request)) {
    event.respondWith(cacheManager.cacheFirst(request));
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