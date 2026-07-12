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