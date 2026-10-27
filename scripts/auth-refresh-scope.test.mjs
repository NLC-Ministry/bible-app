// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #627：第一方 Logto 應用沒有同意畫面，登入時 offline_access 不會被授予（refresh token 靠
// 「Always issue」發出）。續期若照 config 帶整串 scope，Logto 回 400 invalid_scope
// 「refresh token missing requested scope」→ 清 token → 每小時被登出。
// 續期不帶 scope＝沿用登入時授予的範圍（OIDC 規範）；登入請求仍要 offline_access。

const TOKEN_ENDPOINT = "https://sso.example.test/oidc/token";

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
  localStorage.clear();
  sessionStorage.clear();
  auth.metadata = { authorization_endpoint: "https://sso.example.test/oidc/auth", token_endpoint: TOKEN_ENDPOINT };
  auth.config.clientId = "test-client";
  auth._refreshWork = null;
  Object.defineProperty(window.navigator, "locks", { configurable: true, value: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("token refresh request (#627)", () => {
  it("does not send scope, so Logto refreshes with what was granted at sign-in", async () => {
    localStorage.setItem(auth.keys.accessToken, "old-access");
    localStorage.setItem(auth.keys.refreshToken, "old-refresh");
    localStorage.setItem(auth.keys.expiresAt, String(Date.now() - 1000));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-access", expires_in: 3600 }),
      text: async () => ""
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(auth.refreshTokens()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(init.body);
    expect(body.has("scope")).toBe(false);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("client_id")).toBe("test-client");
    expect(body.get("resource")).toBe(auth.config.platformResource);
    expect(localStorage.getItem(auth.keys.accessToken)).toBe("new-access");
    // 回應沒有新的 refresh token 時保留原本那張。
    expect(localStorage.getItem(auth.keys.refreshToken)).toBe("old-refresh");
  });

  it("still asks for offline_access when signing in", async () => {
    const navigate = vi.spyOn(auth, "_navigateToAuthorization").mockImplementation(() => {});
    await auth.startInteractiveLogin({ intent: "login", returnTo: "/" });
    expect(navigate).toHaveBeenCalledTimes(1);
    const scope = new URL(navigate.mock.calls[0][0]).searchParams.get("scope");
    expect(scope.split(" ")).toContain("offline_access");
  });
});
