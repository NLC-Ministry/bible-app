export class CacheManager {
  constructor({ prefix = "newlife-bible", version = "v1", fetchImpl = fetch, cacheStorage = caches } = {}) {
    this.prefix = prefix;
    this.version = version;
    this.fetchImpl = fetchImpl;
    this.cacheStorage = cacheStorage;
  }

  get staticCacheName() { return `${this.prefix}-static-${this.version}`; }
  get runtimeCacheName() { return `${this.prefix}-runtime-${this.version}`; }
  get allowedCacheNames() { return new Set([this.staticCacheName, this.runtimeCacheName]); }

  async precache(urls) {
    const cache = await this.cacheStorage.open(this.staticCacheName);
    const results = await Promise.allSettled(urls.map(url => cache.add(url)));
    const failed = results.filter(result => result.status === "rejected");
    if (failed.length) console.warn(`[PWA] ${failed.length} precache request(s) failed.`);
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