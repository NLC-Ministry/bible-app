// 舊管理畫面（#550）用的 window.auth／window.authLaunch：取代會友 App 的 js/auth.js。
//
// 舊程式（db.js 的 nlc-data／nlc-session 呼叫、exam.js 的 exam-write）只用到 auth 的少數幾個方法。
// 這裡不做任何登入流程、不碰 storage：access token 一律向後台外殼要（外殼只放在記憶體），
// 外殼說沒有 token（過期）就請它重新導向 SSO。id token 也跟外殼要，放進記憶體版 localStorage 的
// nlc_id_token（db.js 從那裡讀）：nlc-session 拿不到 Logto UserInfo 時靠它確認身分，同會友 App。

// 和 js/auth.js 的 keys 同名：舊程式會用 localStorage.getItem(auth.keys.idToken)。
export const LEGACY_AUTH_KEYS = Object.freeze({
  accessToken: "nlc_access_token",
  idToken: "nlc_id_token",
  refreshToken: "nlc_refresh_token",
  expiresAt: "nlc_token_expires_at",
  state: "nlc_auth_state",
  verifier: "nlc_auth_verifier",
  nonce: "nlc_auth_nonce",
  flowId: "nlc_auth_flow_id",
  continuation: "nlc_auth_continuation",
  continuationVersion: "nlc_auth_continuation_version",
  memberContext: "nlc_member_context",
  supabaseAccessToken: "nlc_supabase_access_token"
});

// 提早一分鐘當成過期，再跟外殼要一次（外殼自己會判斷要不要重新登入）
const EXPIRY_MARGIN_SECONDS = 60;

export function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1] || "";
    if (!part) return null;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_err) {
    return null;
  }
}

export function createLegacyAuth({ memberHubUrl = "https://member.newlife.org.tw", openWindow = null, storage = null, now = () => Date.now() } = {}) {
  let bridge = null;
  const waiting = [];
  let ended = false;
  let cached = null;

  const getBridge = () => (bridge ? Promise.resolve(bridge) : new Promise((resolve) => waiting.push(resolve)));
  const storeIdToken = (value) => {
    try {
      if (typeof value === "string" && value) storage?.setItem(LEGACY_AUTH_KEYS.idToken, value);
      else storage?.removeItem(LEGACY_AUTH_KEYS.idToken);
    } catch (_err) {
      // 記憶體版 storage 不會失敗
    }
  };
  const requestLogin = () => {
    ended = true;
    cached = null;
    storeIdToken(null);
    getBridge().then((connected) => connected.post("login_required"));
  };
  const hubUrl = (path = "") => `${String(memberHubUrl).replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;

  const auth = {
    keys: LEGACY_AUTH_KEYS,
    /** legacy-entry.js 拿到通道後接上；之前的 token 請求會等到這時候。 */
    connect(nextBridge) {
      bridge = nextBridge;
      waiting.splice(0).forEach((resolve) => resolve(nextBridge));
    },
    isLoggedIn() {
      return !ended;
    },
    async getValidAccessToken(forceRefresh = false) {
      const nowSeconds = now() / 1000;
      if (!forceRefresh && cached && cached.exp - EXPIRY_MARGIN_SECONDS > nowSeconds) return cached.token;
      const reply = await (await getBridge()).request("token");
      if (!reply || reply.ok !== true || typeof reply.token !== "string" || !reply.token) {
        // 外殼的登入過期了：請它重新導向 SSO（舊程式自己不會登入）
        requestLogin();
        const error = new Error("後台登入已過期，正在重新登入…");
        error.code = "session_expired";
        throw error;
      }
      storeIdToken(reply.idToken);
      const claims = decodeJwtPayload(reply.token);
      cached = {
        token: reply.token,
        exp: Number(claims?.exp) || nowSeconds + 300,
        sub: typeof claims?.sub === "string" ? claims.sub : null
      };
      return reply.token;
    },
    async refreshTokens() {
      return auth.getValidAccessToken(true);
    },
    getLogtoSubject() {
      return cached ? cached.sub : null;
    },
    _parseJwt(token) {
      return decodeJwtPayload(token);
    },
    _addBrowserLaunchTransportParams(url) {
      return url;
    },
    scheduleProactiveRefresh() {},
    isMemberHubSession() {
      return false;
    },
    getMemberHubUrl(path = "") {
      return hubUrl(path);
    },
    openMemberHub(path = "") {
      if (typeof openWindow === "function") openWindow(hubUrl(path));
    },
    async handleCallback() {
      return false;
    },
    async startInteractiveLogin() {
      requestLogin();
    },
    async login() {
      requestLogin();
    },
    async logout() {
      requestLogin();
    },
    async resetLocalLogin() {
      requestLogin();
    }
  };

  const authLaunch = {
    startInteractiveAuth() {
      requestLogin();
    },
    async maybeResumeInteractiveAuthFromBridge() {
      return false;
    }
  };

  return { auth, authLaunch };
}
