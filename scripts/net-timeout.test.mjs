import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  requestLockWithTimeout,
  withSoftTimeout
} from "../js/net-timeout.mjs";

// #415：開機路徑上的網路等待上限。
function hangingFetch() {
  return vi.fn((_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
}

describe("fetchWithTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts after the timeout and throws a TypeError (treated as 'network unreachable')", async () => {
    const fetchImpl = hangingFetch();
    const pending = fetchWithTimeout("https://example.test", {}, 15000, fetchImpl);
    const assertion = expect(pending).rejects.toMatchObject({ code: "NETWORK_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    await pending.catch(error => expect(error).toBeInstanceOf(TypeError));
  });

  it("returns the response when it arrives in time", async () => {
    const response = { ok: true };
    const fetchImpl = vi.fn(async () => response);
    await expect(fetchWithTimeout("https://example.test", {}, 15000, fetchImpl)).resolves.toBe(response);
  });

  it("keeps a caller's own abort as an AbortError, not a timeout", async () => {
    const fetchImpl = hangingFetch();
    const outer = new AbortController();
    const pending = fetchWithTimeout("https://example.test", { signal: outer.signal }, 15000, fetchImpl);
    outer.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("withSoftTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the fallback after the timeout while the original promise keeps running", async () => {
    let resolveWork;
    const work = new Promise(resolve => { resolveWork = resolve; });
    const lateResult = vi.fn();
    work.then(lateResult);

    const pending = withSoftTimeout(work, 15000, null);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(pending).resolves.toBeNull();

    resolveWork("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(lateResult).toHaveBeenCalledWith("late");
  });

  it("returns the real result when it is fast enough", async () => {
    await expect(withSoftTimeout(Promise.resolve(true), 15000, null)).resolves.toBe(true);
  });
});

describe("requestLockWithTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up waiting for a lock that is never granted, without running the callback", async () => {
    const callback = vi.fn();
    const locks = {
      request: vi.fn((_name, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }))
    };
    const pending = requestLockWithTimeout(locks, "nlc-token-refresh", 10000, callback);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toEqual({ acquired: false, value: undefined });
    expect(callback).not.toHaveBeenCalled();
  });

  it("runs the callback when the lock is granted", async () => {
    const locks = { request: vi.fn(async (_name, _options, fn) => fn()) };
    await expect(requestLockWithTimeout(locks, "nlc-token-refresh", 10000, () => "done"))
      .resolves.toEqual({ acquired: true, value: "done" });
  });

  it("rethrows other lock errors so the caller can fall back", async () => {
    const locks = { request: vi.fn(async () => { throw new Error("SecurityError"); }) };
    await expect(requestLockWithTimeout(locks, "nlc-token-refresh", 10000, () => "done"))
      .rejects.toThrow("SecurityError");
  });
});
