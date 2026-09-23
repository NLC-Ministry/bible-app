export class CacheManager {
  constructor({
    prefix = "newlife-bible",
    version = "v1",
    fetchImpl = globalThis.fetch?.bind(globalThis),
    cacheStorage = globalThis.caches
  } = {}) {
    this.prefix = prefix;
    this.version = version;
    this.fetchImpl = fetchImpl;
    this.cacheStorage = cacheStorage;

    if (typeof this.fetchImpl !== "function") throw new TypeError("CacheManager requires a fetch implementation.");
    if (!this.cacheStorage) throw new TypeError("CacheManager requires CacheStorage.");
  }

  get staticCacheName() { return `${this.prefix}-static-${this.version}`; }
  get runtimeCacheName() { return `${this.prefix}-runtime-${this.version}`; }
  get allowedCacheNames() { return new Set([this.staticCacheName, this.runtimeCacheName]); }

  // Only `required` entries can fail the SW install. Everything else is best
  // effort: an all-or-nothing precache meant one flaky asset fetch on mobile
  // aborted the new worker's install, leaving the OLD worker (and its old
  // cached shell) in control indefinitely. Skipped entries are filled lazily
  // by the runtime fetch strategies instead.
  async precache(urls, { required = [] } = {}) {
    const cache = await this.cacheStorage.open(this.staticCacheName);
    const requiredSet = new Set(required);
    const results = await Promise.allSettled(urls.map(url => cache.add(url)));
    const failedRequired = results.find((result, index) => result.status === "rejected" && requiredSet.has(urls[index]));
    if (failedRequired) {
      await this.cacheStorage.delete(this.staticCacheName);
      throw failedRequired.reason;
    }
    return urls.filter((_, index) => results[index].status === "rejected");
  }

  async cacheFirst(request, { cacheName = this.staticCacheName } = {}) {
    const cache = await this.cacheStorage.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await this.fetchImpl(request);
    if (this.isCacheable(response)) await cache.put(request, response.clone());
    return response;
  }

  async networkFirst(request, { cacheName = this.runtimeCacheName, timeoutMs = 5000, fallbackUrl = null } = {}) {
    const cache = await this.cacheStorage.open(cacheName);
    try {
      const response = await this.fetchWithTimeout(request, timeoutMs);
      // A reachable-but-erroring response (5xx: backend down, deploy in
      // progress, site under maintenance) on a navigate request leaves the
      // caller in the same spot as a dropped connection — fall back to the
      // cached app shell instead of showing/caching the error response.
      // Scoped to fallbackUrl callers (navigate only, see sw.js): a bible
      // chapter or static-asset fetch's non-ok response is handled by its
      // own caller and must not be silently swapped for an unrelated page.
      if (fallbackUrl && response.status >= 500 && response.status < 600) {
        throw new Error(`networkFirst: upstream responded ${response.status}`);
      }
      if (this.isCacheable(response)) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request) || await this.cacheStorage.match(request);
      if (cached) return cached;
      if (fallbackUrl) {
        const fallback = await this.cacheStorage.match(fallbackUrl);
        if (fallback) return fallback;
      }
      throw error;
    }
  }

  async staleWhileRevalidate(request, { cacheName = this.runtimeCacheName } = {}) {
    const cache = await this.cacheStorage.open(cacheName);
    const cached = await cache.match(request);
    const network = this.fetchImpl(request).then(async response => {
      if (this.isCacheable(response)) await cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    return cached || network;
  }

  async cleanup() {
    const names = await this.cacheStorage.keys();
    await Promise.all(names
      .filter(name => name.startsWith(`${this.prefix}-`) && !this.allowedCacheNames.has(name))
      .map(name => this.cacheStorage.delete(name)));
  }

  isCacheable(response) {
    return Boolean(response && response.ok && ["basic", "cors", "default"].includes(response.type));
  }

  async fetchWithTimeout(request, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(request, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}