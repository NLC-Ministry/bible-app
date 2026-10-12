// 後台登入（#555）：後台自己的 Logto 應用程式（#554），授權碼＋PKCE。
//
// · access token 只放在這個模組的變數裡（記憶體），不寫 localStorage／sessionStorage／cookie，
//   也不要 refresh token（scope 不含 offline_access）。重新整理或過期就重新導向 SSO——
//   Logto 已登入時不用再輸入密碼，會直接帶著新的授權碼回來。
// · sessionStorage 只放 PKCE 這一趟的一次性資料（state、verifier、nonce、要回到的頁面）和
//   「剛登出」的旗標；拿到 token 前就刪掉 PKCE 資料。
// · Redirect URI 和登出後導向都是網站根目錄（#554 申請時填的就是 `https://<後台網址>/`），
//   所以登出原因不能放在網址上，改放 sessionStorage。

import type { AdminConfig } from "./config.ts";
import type { FetchLike } from "./api.ts";

export type SignOutReason = "idle" | "manual";

export type InitResult =
  | { status: "signed_in" }
  | { status: "redirecting" }
  | { status: "signed_out"; reason: SignOutReason }
  | { status: "error"; message: string };

type LocationLike = { origin: string; search: string; hash: string; assign(url: string): void };
type HistoryLike = { replaceState(data: unknown, unused: string, url?: string | null): void };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AdminAuthDeps = {
  config: Pick<AdminConfig, "issuer" | "clientId" | "resource" | "scopes">;
  location: LocationLike;
  history: HistoryLike;
  storage: StorageLike;
  fetchImpl?: FetchLike;
  crypto?: Crypto;
  now?: () => number;
};

export type AdminAuth = {
  init(): Promise<InitResult>;
  login(returnHash?: string): Promise<void>;
  logout(reason: SignOutReason): Promise<void>;
  getToken(): string | null;
};

export const FLOW_KEY = "admin_oidc_flow";
export const SIGNED_OUT_KEY = "admin_signed_out";
const FLOW_MAX_AGE_MS = 10 * 60 * 1000;
// 提早 30 秒當成過期，避免送出時剛好到期
const EXPIRY_MARGIN_MS = 30 * 1000;

type Endpoints = { authorization: string; token: string; endSession: string };
type Session = { accessToken: string; idToken: string | null; expiresAt: number };
type Flow = { state: string; verifier: string; nonce: string; returnHash: string; createdAt: number };

function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1] || "";
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_err) {
    return null;
  }
}

/** 只允許站內 hash（#/…），避免登入後被導去別的地方。 */
export function safeReturnHash(value: unknown): string {
  return typeof value === "string" && /^#\/[^\s]*$/.test(value) && value.length <= 500 ? value : "";
}

export function createAdminAuth(deps: AdminAuthDeps): AdminAuth {
  const fetchImpl: FetchLike = deps.fetchImpl || ((input, init) => fetch(input, init));
  const cryptoObj: Crypto = deps.crypto || globalThis.crypto;
  const now = deps.now || (() => Date.now());
  const issuer = deps.config.issuer.replace(/\/+$/, "");
  const redirectUri = `${deps.location.origin}/`;
  let session: Session | null = null;
  let endpoints: Endpoints | null = null;

  const random = (size: number) => {
    const bytes = new Uint8Array(size);
    cryptoObj.getRandomValues(bytes);
    return base64url(bytes);
  };

  async function discover(): Promise<Endpoints> {
    if (endpoints) return endpoints;
    const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`, { method: "GET", credentials: "omit" });
    if (!response.ok) throw new Error(`discovery_failed_${response.status}`);
    const meta = await response.json();
    if (typeof meta?.authorization_endpoint !== "string" || typeof meta?.token_endpoint !== "string") {
      throw new Error("discovery_invalid");
    }
    endpoints = {
      authorization: meta.authorization_endpoint,
      token: meta.token_endpoint,
      endSession: typeof meta.end_session_endpoint === "string" ? meta.end_session_endpoint : `${issuer}/session/end`
    };
    return endpoints;
  }

  function readFlow(): Flow | null {
    try {
      const parsed = JSON.parse(deps.storage.getItem(FLOW_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed as Flow : null;
    } catch (_err) {
      return null;
    }
  }

  async function login(returnHash = deps.location.hash): Promise<void> {
    if (!deps.config.clientId) throw new Error("admin_client_id_missing");
    const verifier = random(32);
    const flow: Flow = {
      state: random(16),
      verifier,
      nonce: random(16),
      returnHash: safeReturnHash(returnHash),
      createdAt: now()
    };
    const digest = await cryptoObj.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const ep = await discover();
    deps.storage.setItem(FLOW_KEY, JSON.stringify(flow));
    const params = new URLSearchParams({
      client_id: deps.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: deps.config.scopes,
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: base64url(new Uint8Array(digest)),
      code_challenge_method: "S256"
    });
    if (deps.config.resource) params.set("resource", deps.config.resource);
    deps.location.assign(`${ep.authorization}?${params}`);
  }

  async function handleCallback(search: URLSearchParams): Promise<InitResult> {
    const flow = readFlow();
    deps.storage.removeItem(FLOW_KEY);
    // 先把 code 從網址拿掉：重新整理不會拿用過的 code 再換一次，也不會留在瀏覽紀錄裡
    deps.history.replaceState(null, "", `/${flow ? safeReturnHash(flow.returnHash) : ""}`);

    const error = search.get("error");
    if (error) {
      return { status: "error", message: `登入沒有完成（${search.get("error_description") || error}）。` };
    }
    const code = search.get("code") || "";
    if (!flow || !code || search.get("state") !== flow.state || now() - Number(flow.createdAt) > FLOW_MAX_AGE_MS) {
      return { status: "error", message: "登入流程逾時或不一致，請重新登入。" };
    }

    let data: Record<string, unknown>;
    try {
      const ep = await discover();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: deps.config.clientId,
        code_verifier: flow.verifier
      });
      if (deps.config.resource) body.set("resource", deps.config.resource);
      const response = await fetchImpl(ep.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "omit"
      });
      if (!response.ok) return { status: "error", message: `登入換發憑證失敗（HTTP ${response.status}），請重新登入。` };
      data = await response.json();
    } catch (_err) {
      return { status: "error", message: "連不上登入服務，請檢查網路後重新登入。" };
    }

    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    const idToken = typeof data.id_token === "string" ? data.id_token : null;
    if (!accessToken || !idToken || decodeJwtPayload(idToken)?.nonce !== flow.nonce) {
      return { status: "error", message: "登入回應不完整，請重新登入。" };
    }
    const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    session = { accessToken, idToken, expiresAt: now() + expiresIn * 1000 };
    return { status: "signed_in" };
  }

  return {
    async init(): Promise<InitResult> {
      const search = new URLSearchParams(deps.location.search);
      if (search.has("code") || search.has("error")) return handleCallback(search);
      const signedOut = deps.storage.getItem(SIGNED_OUT_KEY);
      if (signedOut) {
        deps.storage.removeItem(SIGNED_OUT_KEY);
        return { status: "signed_out", reason: signedOut === "idle" ? "idle" : "manual" };
      }
      try {
        await login(deps.location.hash);
        return { status: "redirecting" };
      } catch (err) {
        const message = err instanceof Error && err.message === "admin_client_id_missing"
          ? "後台還沒設定 Logto 應用程式（ADMIN_LOGTO_CLIENT_ID），請聯絡開發者。"
          : "連不上登入服務，請檢查網路後重新整理。";
        return { status: "error", message };
      }
    },
    login,
    async logout(reason: SignOutReason): Promise<void> {
      const idToken = session?.idToken || null;
      session = null;
      deps.storage.setItem(SIGNED_OUT_KEY, reason);
      // 結束 Logto 的登入狀態：只清記憶體的話，重新整理又會無聲地登回來，閒置登出就沒意義了
      try {
        const ep = await discover();
        const params = new URLSearchParams({ client_id: deps.config.clientId, post_logout_redirect_uri: redirectUri });
        if (idToken) params.set("id_token_hint", idToken);
        deps.location.assign(`${ep.endSession}?${params}`);
      } catch (_err) {
        deps.location.assign(redirectUri);
      }
    },
    getToken(): string | null {
      if (!session || now() >= session.expiresAt - EXPIRY_MARGIN_MS) return null;
      return session.accessToken;
    }
  };
}
