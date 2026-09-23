import { describe, expect, it, vi } from "vitest";
import { CacheManager } from "./CacheManager.js";
import { OfflineQueueRepository } from "./OfflineQueueRepository.js";
import { OfflineSyncManager } from "./OfflineSyncManager.js";

class MemoryCache {
  constructor(fetchImpl) { this.fetchImpl = fetchImpl; this.entries = new Map(); }
  key(request) { return typeof request === "string" ? request : request.url; }
  async match(request) { return this.entries.get(this.key(request)); }
  async put(request, response) { this.entries.set(this.key(request), response); }
  async add(url) { await this.put(url, await this.fetchImpl(url)); }
}

class MemoryCacheStorage {
  constructor(fetchImpl) { this.fetchImpl = fetchImpl; this.caches = new Map(); }
  async open(name) { if (!this.caches.has(name)) this.caches.set(name, new MemoryCache(this.fetchImpl)); return this.caches.get(name); }
  async match(request) { for (const cache of this.caches.values()) { const hit = await cache.match(request); if (hit) return hit; } }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
}

class MemoryDb {
  constructor() { this.records = new Map(); }
  async getAll() { return [...this.records.values()]; }
  async put(_store, value) { this.records.set(value.id, structuredClone(value)); return value.id; }
  async delete(_store, id) { this.records.delete(id); }
}

describe("CacheManager", () => {
  it("binds the platform fetch function to globalThis", async () => {
    const originalFetch = globalThis.fetch;
    const receiverAwareFetch = vi.fn(function () {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("module", { status: 200 }));
    });
    globalThis.fetch = receiverAwareFetch;

    try {
      const storage = new MemoryCacheStorage(receiverAwareFetch.bind(globalThis));
      const manager = new CacheManager({ cacheStorage: storage });
      const response = await manager.cacheFirst(new Request("https://example.test/modules/home.js"));
      expect(await response.text()).toBe("module");
      expect(receiverAwareFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects when a required app-shell entry fails and removes its partial cache", async () => {
    const fetchImpl = vi.fn(async url => {
      if (String(url).includes("index.css")) throw new TypeError("offline");
      return new Response("asset", { status: 200 });
    });
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ version: "broken", fetchImpl, cacheStorage: storage });

    await expect(manager.precache(["/", "/index.css", "/app.js"], { required: ["/index.css"] })).rejects.toThrow("offline");
    expect(await storage.keys()).not.toContain("newlife-bible-static-broken");
  });
  it("skips optional app-shell failures instead of aborting the install", async () => {
    const fetchImpl = vi.fn(async url => {
      if (String(url).includes("index.css")) throw new TypeError("offline");
      return new Response("asset", { status: 200 });
    });
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ version: "flaky", fetchImpl, cacheStorage: storage });

    const skipped = await manager.precache(["/", "/index.css", "/app.js"], { required: ["/"] });
    expect(skipped).toEqual(["/index.css"]);
    expect(await storage.keys()).toContain("newlife-bible-static-flaky");
  });
  it("uses cache-first after the first successful response", async () => {
    const fetchImpl = vi.fn(async () => new Response("network", { status: 200 }));
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ fetchImpl, cacheStorage: storage });
    const request = new Request("https://example.test/app.js");

    expect(await (await manager.cacheFirst(request)).text()).toBe("network");
    expect(await (await manager.cacheFirst(request)).text()).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to a cached response when network-first fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("fresh", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ fetchImpl, cacheStorage: storage });
    const request = new Request("https://example.test/chapter");

    await manager.networkFirst(request);
    expect(await (await manager.networkFirst(request)).text()).toBe("fresh");
  });

  it("falls back to the cached app shell when a navigate request hits a 5xx (site under maintenance)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("<html>shell</html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ fetchImpl, cacheStorage: storage });
    const shellRequest = new Request("https://example.test/");

    // First visit: caches the good shell response.
    await manager.networkFirst(shellRequest, { fallbackUrl: "/" });
    // Second visit: backend is erroring (503) — must serve the cached shell,
    // not the error response, and must not overwrite the good cache entry.
    const response = await manager.networkFirst(shellRequest, { fallbackUrl: "/" });
    expect(response.status).toBe(200);
    expect(await response.clone().text()).toBe("<html>shell</html>");
  });

  it("does not swap a non-navigate 5xx response for a cached page (no fallbackUrl)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("chapter unavailable", { status: 503 }));
    const storage = new MemoryCacheStorage(fetchImpl);
    const manager = new CacheManager({ fetchImpl, cacheStorage: storage });
    const request = new Request("https://bolls.life/get-text/RCUV/1/1/");

    const response = await manager.networkFirst(request);
    expect(response.status).toBe(503);
  });

  it("deletes only obsolete caches owned by the app", async () => {
    const fetchImpl = vi.fn();
    const storage = new MemoryCacheStorage(fetchImpl);
    await storage.open("newlife-bible-static-old");
    await storage.open("other-app-cache");
    const manager = new CacheManager({ version: "new", fetchImpl, cacheStorage: storage });
    await manager.cleanup();
    expect(await storage.keys()).toContain("other-app-cache");
    expect(await storage.keys()).not.toContain("newlife-bible-static-old");
  });
});

describe("Offline queue", () => {
  it("keeps only the latest desired state for the same idempotency key", async () => {
    const repository = new OfflineQueueRepository(new MemoryDb());
    await repository.enqueue({ type: "SET", payload: { checked: true }, idempotencyKey: "chapter-1" });
    await repository.enqueue({ type: "SET", payload: { checked: false }, idempotencyKey: "chapter-1" });
    const pending = await repository.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.checked).toBe(false);
  });

  it("removes successfully synchronized operations", async () => {
    const repository = new OfflineQueueRepository(new MemoryDb());
    const handler = vi.fn(async () => {});
    const manager = new OfflineSyncManager({ queueRepository: repository, handlers: { SET: handler } });
    await repository.enqueue({ type: "SET", payload: { checked: true }, idempotencyKey: "chapter-1" });
    await manager.syncPending();
    expect(handler).toHaveBeenCalledOnce();
    expect(await repository.countPending()).toBe(0);
  });

  it("does not retry permanent authorization failures", async () => {
    const database = new MemoryDb();
    const repository = new OfflineQueueRepository(database);
    const error = Object.assign(new Error("forbidden"), { status: 403 });
    const manager = new OfflineSyncManager({ queueRepository: repository, handlers: { SET: async () => { throw error; } } });
    await repository.enqueue({ type: "SET", payload: {}, idempotencyKey: "chapter-1" });
    await manager.syncPending();
    const records = await database.getAll();
    expect(records[0].status).toBe("failed");
  });
});