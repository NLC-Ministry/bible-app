// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #415：Logto 換 token／續期用軟逾時——呼叫端不再等，但請求不中斷，晚到的新 token 照樣存起來。
// （Logto 若開了 refresh token 換發，中斷一個已被接受的續期會讓手上只剩作廢的舊 token → 被登出。）

const TOKEN_ENDPOINT = "https://sso.example.test/oidc/token";

function jwt(payload) {
  const encode = value => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function deferredResponse() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function jsonResponse(body) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) };
}

let auth;

beforeAll(async () => {
  globalThis.state = { currentUser: {} };
  globalThis.loader = { show: vi.fn(), hide: vi.fn() };
  globalThis.showToast = vi.fn();
  globalThis.getRoleDefinition = () => null;
  await import("../js/auth.js");
  auth = window.auth;
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  auth.metadata = { authorization_endpoint: "https://sso.example.test/oidc/auth", token_endpoint: TOKEN_ENDPOINT };
  auth._refreshWork = null;
  Object.defineProperty(window.navigator, "locks", { configurable: true, value: undefined });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function seedExpiredSession() {
  localStorage.setItem(auth.keys.accessToken, "old-access");
  localStorage.setItem(auth.keys.refreshToken, "old-refresh");
  localStorage.setItem(auth.keys.expiresAt, String(Date.now() - 1000));
}

describe("token refresh soft timeout", () => {
  it("stops waiting after 15s but still saves the new tokens when the slow response arrives", async () => {
    seedExpiredSession();
    const slow = deferredResponse();
    const fetchMock = vi.fn(() => slow.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pending = auth.refreshTokens();
    await vi.advanceTimersByTimeAsync(15000);
    await expect(pending).resolves.toBeNull();
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("old-refresh");

    slow.resolve(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 900 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe("new-access");
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a second caller while the first refresh is still in flight waits on the same request", async () => {
    seedExpiredSession();
    const slow = deferredResponse();
    const fetchMock = vi.fn(() => slow.promise);
    vi.stubGlobal("fetch", fetchMock);

    const first = auth.refreshTokens();
    await vi.advanceTimersByTimeAsync(15000);
    await first;
    const second = auth.refreshTokens();
    await vi.advanceTimersByTimeAsync(15000);
    await expect(second).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    slow.resolve(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 900 }));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("getValidAccessToken gives up as 'offline' after one soft timeout instead of retrying the same stuck request", async () => {
    seedExpiredSession();
    const slow = deferredResponse();
    const fetchMock = vi.fn(() => slow.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pending = auth.getValidAccessToken(false);
    const assertion = expect(pending).rejects.toMatchObject({ code: "OFFLINE_AUTH_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("old-refresh");
    slow.resolve(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 900 }));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("does not refresh without the cross-tab lock when the lock is never granted", async () => {
    seedExpiredSession();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "locks", {
      configurable: true,
      value: {
        request: (_name, options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
      }
    });

    const pending = auth.refreshTokens();
    await vi.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("old-refresh");
  });
});

describe("login callback token exchange soft timeout", () => {
  it("shows the login card after 15s but still saves tokens when the slow exchange succeeds", async () => {
    window.history.replaceState({}, "", "/?code=one-time-code&state=state-1");
    sessionStorage.setItem(auth.keys.state, "state-1");
    sessionStorage.setItem(auth.keys.verifier, "verifier-1");
    sessionStorage.setItem(auth.keys.nonce, "nonce-1");
    const slow = deferredResponse();
    const fetchMock = vi.fn(() => slow.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pending = auth.handleCallback();
    await vi.advanceTimersByTimeAsync(15000);
    await expect(pending).resolves.toBe(true);
    // 已顯示失敗訊息、網址的一次性登入碼已清掉，請求只送過一次。
    expect(globalThis.showToast).toHaveBeenCalled();
    expect(window.location.search).not.toContain("code=");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    slow.resolve(jsonResponse({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      id_token: jwt({ nonce: "nonce-1", sub: "user-1" }),
      expires_in: 900
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe("fresh-access");
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("fresh-refresh");
  });

  it("still rejects a token response whose nonce does not match", async () => {
    window.history.replaceState({}, "", "/?code=one-time-code&state=state-2");
    sessionStorage.setItem(auth.keys.state, "state-2");
    sessionStorage.setItem(auth.keys.verifier, "verifier-2");
    sessionStorage.setItem(auth.keys.nonce, "nonce-2");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      access_token: "evil-access",
      id_token: jwt({ nonce: "other" }),
      expires_in: 900
    })));

    await expect(auth.handleCallback()).resolves.toBe(true);
    expect(localStorage.getItem(auth.keys.accessToken)).toBeNull();
  });
});
