import { describe, expect, it, vi } from "vitest";
import { VersionWatcher, VERSION_RELOAD_KEY, VERSION_REPAIR_KEY } from "./VersionWatcher.js";

const CURRENT = "20260923010101";
const NEWER = "20260923020202";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map
  };
}

function setup({ remote = NEWER, safe = true, storage = memoryStorage(), fetchImpl } = {}) {
  const location = { reload: vi.fn(), replace: vi.fn() };
  const update = vi.fn(async () => {});
  const watcher = new VersionWatcher({
    currentVersion: CURRENT,
    fetchImpl: fetchImpl || vi.fn(async () => new Response(JSON.stringify({ version: remote }), { status: 200 })),
    storage,
    location,
    getRegistration: async () => ({ update }),
    isSafeToReload: () => safe,
    minIntervalMs: 0
  });
  return { watcher, location, update, storage };
}

describe("VersionWatcher", () => {
  it("is disabled for dev builds without a baked build id", async () => {
    const watcher = new VersionWatcher({ currentVersion: null, fetchImpl: vi.fn() });
    expect(await watcher.check()).toBe("disabled");
  });

  it("does nothing and clears guards when running the live build", async () => {
    const storage = memoryStorage();
    storage.setItem(VERSION_RELOAD_KEY, CURRENT);
    const { watcher, location } = setup({ remote: CURRENT, storage });
    expect(await watcher.check()).toBe("current");
    expect(location.reload).not.toHaveBeenCalled();
    expect(storage.getItem(VERSION_RELOAD_KEY)).toBeNull();
  });

  it("updates the service worker and reloads once when a newer build is live", async () => {
    const { watcher, location, update, storage } = setup();
    expect(await watcher.check()).toBe("reload");
    expect(update).toHaveBeenCalledOnce();
    expect(location.reload).toHaveBeenCalledOnce();
    expect(storage.getItem(VERSION_RELOAD_KEY)).toBe(NEWER);
  });

  it("escalates to /repair if the reload still lands on the old build, then stops", async () => {
    const storage = memoryStorage();
    storage.setItem(VERSION_RELOAD_KEY, NEWER);
    const { watcher, location } = setup({ storage });

    expect(await watcher.check()).toBe("repair");
    expect(location.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/repair\?source=version/));
    expect(storage.getItem(VERSION_REPAIR_KEY)).toBe(NEWER);

    expect(await watcher.check()).toBe("gave-up");
    expect(location.replace).toHaveBeenCalledOnce();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("defers while unsafe and reports the pending build to the UI", async () => {
    const onUpdateAvailable = vi.fn();
    const { watcher, location } = setup({ safe: false });
    watcher.onUpdateAvailable = onUpdateAvailable;
    expect(await watcher.check()).toBe("deferred");
    expect(location.reload).not.toHaveBeenCalled();
    expect(onUpdateAvailable).toHaveBeenCalledWith(NEWER);
  });

  it("reloads on a user tap even while unsafe", async () => {
    const { watcher, location } = setup({ safe: false });
    expect(await watcher.check({ force: true, ignoreSafety: true })).toBe("reload");
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it("force-reloads a build older than minVersion regardless of safety", async () => {
    const onUpdateAvailable = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: NEWER, minVersion: NEWER }), { status: 200 }));
    const { watcher, location } = setup({ safe: false, fetchImpl });
    watcher.onUpdateAvailable = onUpdateAvailable;
    expect(await watcher.check()).toBe("reload");
    expect(location.reload).toHaveBeenCalledOnce();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not force a build that already meets minVersion", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: NEWER, minVersion: CURRENT }), { status: 200 }));
    const { watcher, location } = setup({ safe: false, fetchImpl });
    expect(await watcher.check()).toBe("deferred");
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("forced updates still go through the one-shot reload/repair guards", async () => {
    const storage = memoryStorage();
    storage.setItem(VERSION_RELOAD_KEY, NEWER);
    storage.setItem(VERSION_REPAIR_KEY, NEWER);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: NEWER, minVersion: NEWER }), { status: 200 }));
    const { watcher, location } = setup({ storage, fetchImpl });
    expect(await watcher.check()).toBe("gave-up");
    expect(location.reload).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it("treats an unreachable or malformed probe as unknown", async () => {
    const offline = setup({ fetchImpl: vi.fn(async () => { throw new TypeError("offline"); }) });
    expect(await offline.watcher.check()).toBe("unknown");
    const garbage = setup({ fetchImpl: vi.fn(async () => new Response("<html>", { status: 200 })) });
    expect(await garbage.watcher.check()).toBe("unknown");
    expect(offline.location.reload).not.toHaveBeenCalled();
  });

  it("throttles non-forced checks", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: CURRENT }), { status: 200 }));
    const watcher = new VersionWatcher({
      currentVersion: CURRENT, fetchImpl, storage: memoryStorage(), minIntervalMs: 60000, now: () => 1000000
    });
    await watcher.check();
    expect(await watcher.check()).toBe("throttled");
    await watcher.check({ force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
