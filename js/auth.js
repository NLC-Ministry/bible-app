// ============================================================
// auth.js - Logto OIDC & NLC Member Hub Integration Client
// ============================================================

const auth = {
  config: {
    issuer: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.issuer) || "https://sso.newlife.org.tw/oidc",
    clientId: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.clientId) || "",
    memberHubUrl: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.memberHubUrl) || "https://member.newlife.org.tw",
    scopes: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.scopes) || "openid profile email member:read.basic",
    platformResource: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.platformResource) || "https://platform.newlife.org.tw"
  },

  keys: {
    accessToken: "nlc_access_token",
    idToken: "nlc_id_token",
    refreshToken: "nlc_refresh_token",
    expiresAt: "nlc_token_expires_at",
    state: "nlc_auth_state",
    verifier: "nlc_auth_verifier",
    memberContext: "nlc_member_context",
    supabaseAccessToken: "nlc_supabase_access_token",
    supabaseExpiresAt: "nlc_supabase_expires_at",
    supabaseProfile: "nlc_supabase_profile"
  },

  metadata: null,

  _joinUrl(base, path) {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  },

  getMemberHubUrl(path = "") {
    const base = (this.config.memberHubUrl || "https://member.newlife.org.tw").replace(/\/+$/, "");
    if (!path) return base;
    return this._joinUrl(base, path);
  },

  openMemberHub(path = "") {
    const url = this.getMemberHubUrl(path);
    window.open(url, "_blank", "noopener,noreferrer");
  },

  isMemberHubSession() {
    return this.isLoggedIn();
  },

  async _fetchMetadata() {
    if (this.metadata) return this.metadata;

    const issuer = this.config.issuer.replace(/\/+$/, "");
    const candidates = [this._joinUrl(issuer, ".well-known/openid-configuration")];

    if (issuer.endsWith("/oidc")) {
      candidates.push(this._joinUrl(issuer.slice(0, -5), ".well-known/openid-configuration"));
    } else {
      candidates.push(this._joinUrl(issuer, "oidc/.well-known/openid-configuration"));
    }

    let lastError = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          lastError = new Error(`OIDC discovery failed: ${response.status} ${url}`);
          continue;
        }

        const metadata = await response.json();
        if (metadata.authorization_endpoint && metadata.token_endpoint) {
          this.metadata = metadata;
          return metadata;
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("OIDC discovery failed");
  },

  async _getEndpoints() {
    const metadata = await this._fetchMetadata();
    return {
      authorizationEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      endSessionEndpoint: metadata.end_session_endpoint || metadata.logout_endpoint || this._joinUrl(this.config.issuer, "auth/logout")
    };
  },

  _generateCodeVerifier() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return this._base64urlencode(bytes);
  },

  _sha256(plain) {
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  },

  _base64urlencode(buffer) {
    let str = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i += 1) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  async _generateCodeChallenge(verifier) {
    return this._base64urlencode(await this._sha256(verifier));
  },

  _parseJwt(token) {
    try {
      const base64Url = token.split(".")[1];
      if (!base64Url) return null;
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map(char => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch (err) {
      console.error("Failed to parse JWT:", err);
      return null;
    }
  },

  _getRedirectUri() {
    return window.location.origin + "/";
  },

  _cleanCallbackUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    ["code", "state", "error", "error_description", "scope", "iss"].forEach(key => urlParams.delete(key));
    const cleanUrl = window.location.origin + window.location.pathname +
      (urlParams.toString() ? "?" + urlParams.toString() : "") +
      window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  },

  _clearStoredTokens() {
    localStorage.removeItem(this.keys.accessToken);
    localStorage.removeItem(this.keys.idToken);
    localStorage.removeItem(this.keys.refreshToken);
    localStorage.removeItem(this.keys.expiresAt);
    localStorage.removeItem(this.keys.memberContext);
    localStorage.removeItem(this.keys.supabaseAccessToken);
    localStorage.removeItem(this.keys.supabaseExpiresAt);
    localStorage.removeItem(this.keys.supabaseProfile);
    localStorage.removeItem("nlc_edge_session_expires_at");
    localStorage.removeItem("nlc_profile_locked_fields");
  },

  _getFlowItem(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  },

  _setFlowItem(key, value) {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  },

  _clearFlowState() {
    sessionStorage.removeItem(this.keys.state);
    sessionStorage.removeItem(this.keys.verifier);
    localStorage.removeItem(this.keys.state);
    localStorage.removeItem(this.keys.verifier);
  },

  _resetAppAuthState() {
    state.currentUser = {
      name: "",
      great_region: "",
      pastoral_zone: "",
      small_group: "",
      role: "member",
      chapters_read: 0,
      plan_progress: 0,
      streak: 0,
      last_read: null
    };
    state.readingLogs = [];
    state.activePlans = [];
    state.activePlan = null;
    state.currentProfileId = null;
    state.profileLockedFields = [];
  },

  _showMessage(message) {
    if (typeof showToast === "function") showToast(message);
    else alert(message);
  },

  _failCallback(message, detail) {
    if (detail) console.error(message, detail);
    this._clearFlowState();
    this._clearStoredTokens();
    this._resetAppAuthState();
    this._cleanCallbackUrl();
    if (typeof db !== "undefined" && db.updateAuthUI) db.updateAuthUI(null);
    this._showMessage(message || "\u6559\u6703\u7cfb\u7d71\u767b\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002");
    return true;
  },

  _applyTokenProfileFallback() {
    const payload = this._parseJwt(localStorage.getItem(this.keys.idToken) || "");
    if (!payload) return;
    state.currentUser.name = payload.name || payload.nickname || payload.preferred_username || payload.email || payload.sub || "NLC User";
    state.currentUser.role = state.currentUser.role || "member";
    state.realRole = state.currentUser.role;
  },

  async resetLocalLogin() {
    this._clearFlowState();
    this._clearStoredTokens();
    this._resetAppAuthState();
    localStorage.removeItem("nlc_supabase_access_token");
    localStorage.removeItem("nlc_supabase_expires_at");
    localStorage.removeItem("nlc_supabase_profile");
    localStorage.removeItem("nlc_edge_session_expires_at");
    if (typeof state !== "undefined") {
      state.currentProfileId = null;
      if (state.supabaseConfig && typeof db !== "undefined" && db.createSupabaseClient) {
        state.supabase = db.createSupabaseClient();
      }
    }
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith("church-bible-")).map(key => caches.delete(key)));
      }
    } catch (err) {
      console.warn("Could not clear app caches", err);
    }
  },

  async login() {
    try {
      await this.resetLocalLogin();
      if (!this.config.clientId) {
        console.error("NLC OIDC clientId is missing. Set NLC_CLIENT_ID and rebuild config.js.");
        alert("\u6559\u6703\u7cfb\u7d71\u767b\u5165\u5c1a\u672a\u5b8c\u6210\u8a2d\u5b9a\uff0c\u8acb\u806f\u7d61\u7ba1\u7406\u54e1\u3002");
        return;
      }

      const stateVal = this._generateCodeVerifier();
      const verifierVal = this._generateCodeVerifier();
      const challenge = await this._generateCodeChallenge(verifierVal);

      this._clearFlowState();
      this._setFlowItem(this.keys.state, stateVal);
      this._setFlowItem(this.keys.verifier, verifierVal);

      const redirectUri = this._getRedirectUri();
      const endpoints = await this._getEndpoints();
      const authParams = new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: this.config.scopes,
        state: stateVal,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });
      if (this.config.platformResource) {
        authParams.set("resource", this.config.platformResource);
      }

      window.location.href = `${endpoints.authorizationEndpoint}?${authParams.toString()}`;
    } catch (err) {
      console.error("Logto login redirect failed:", err);
      this._showMessage("\u7121\u6cd5\u958b\u555f\u6559\u6703\u7cfb\u7d71\u767b\u5165\uff0c\u8acb\u91cd\u8a66\u3002");
    }
  },

  async handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const stateVal = urlParams.get("state");
    const authError = urlParams.get("error");
    const authErrorDescription = urlParams.get("error_description");

    if (authError) {
      return this._failCallback("\u6559\u6703\u7cfb\u7d71\u767b\u5165\u5931\u6557\uff1a" + (authErrorDescription || authError), { authError, authErrorDescription });
    }

    if (!code && !stateVal) return false;
    if (!code || !stateVal) return this._failCallback("\u6559\u6703\u7cfb\u7d71\u767b\u5165\u8cc7\u6599\u4e0d\u5b8c\u6574\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002", { code: !!code, state: !!stateVal });

    const savedState = this._getFlowItem(this.keys.state);
    if (!savedState || savedState !== stateVal) {
      return this._failCallback("\u767b\u5165\u9a57\u8b49\u5df2\u904e\u671f\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002", { savedState: !!savedState, callbackState: !!stateVal });
    }

    const verifier = this._getFlowItem(this.keys.verifier);
    if (!verifier) return this._failCallback("\u767b\u5165\u9a57\u8b49\u8cc7\u6599\u907a\u5931\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002");

    loader.show("\u6b63\u5728\u5b8c\u6210\u6559\u6703\u7cfb\u7d71\u767b\u5165...");
    try {
      const redirectUri = this._getRedirectUri();
      const endpoints = await this._getEndpoints();
      const response = await fetch(endpoints.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: this.config.clientId,
          code_verifier: verifier
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}${errorText ? " - " + errorText : ""}`);
      }

      const data = await response.json();
      this._saveTokens(data);
      this._cleanCallbackUrl();
      this._applyTokenProfileFallback();
      this._showMessage("\u6559\u6703\u7cfb\u7d71\u767b\u5165\u6210\u529f\u3002");
      return true;
    } catch (err) {
      return this._failCallback("\u6559\u6703\u7cfb\u7d71\u767b\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002", err);
    } finally {
      this._clearFlowState();
      loader.hide();
    }
  },

  _saveTokens(tokenResponse) {
    if (tokenResponse.access_token) localStorage.setItem(this.keys.accessToken, tokenResponse.access_token);
    if (tokenResponse.id_token) localStorage.setItem(this.keys.idToken, tokenResponse.id_token);
    if (tokenResponse.refresh_token) localStorage.setItem(this.keys.refreshToken, tokenResponse.refresh_token);
    if (tokenResponse.expires_in) {
      localStorage.setItem(this.keys.expiresAt, String(Date.now() + tokenResponse.expires_in * 1000));
    }
  },

  async refreshTokens() {
    const refreshToken = localStorage.getItem(this.keys.refreshToken);
    if (!refreshToken) return false;

    try {
      const endpoints = await this._getEndpoints();
      const refreshParams = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId
      });
      if (this.config.platformResource) {
        refreshParams.set("resource", this.config.platformResource);
      }
      if (this.config.scopes) {
        refreshParams.set("scope", this.config.scopes);
      }

      const response = await fetch(endpoints.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: refreshParams
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`OIDC refresh failed: ${response.status}${errorText ? " - " + errorText : ""}`);
      }

      this._saveTokens(await response.json());
      return true;
    } catch (err) {
      console.error("Logto token refresh error:", err);
      this._clearStoredTokens();
      return false;
    }
  },

  isLoggedIn() {
    const token = localStorage.getItem(this.keys.accessToken);
    const refreshToken = localStorage.getItem(this.keys.refreshToken);
    const expiresAt = parseInt(localStorage.getItem(this.keys.expiresAt) || "0", 10);
    return (!!token && Date.now() < expiresAt) || !!refreshToken;
  },

  async getValidAccessToken(forceRefresh = false) {
    const token = localStorage.getItem(this.keys.accessToken);
    const expiresAt = parseInt(localStorage.getItem(this.keys.expiresAt) || "0", 10);
    const shouldRefresh = forceRefresh || !token || Date.now() > expiresAt - 60000;

    if (shouldRefresh) {
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        this._clearStoredTokens();
        this._resetAppAuthState();
        throw new Error("\u767b\u5165\u72c0\u614b\u5df2\u5931\u6548\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002");
      }
    }

    const nextToken = localStorage.getItem(this.keys.accessToken);
    if (!nextToken) throw new Error("\u767b\u5165\u72c0\u614b\u5df2\u5931\u6548\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002");
    if (this.config.platformResource && nextToken.split(".").length !== 3) {
      console.warn(
        "Logto access token is not a JWT. Platform API requires resource=",
        this.config.platformResource,
        "at login/refresh."
      );
    }
    return nextToken;
  },

  getLogtoSubject() {
    const payload = this._parseJwt(localStorage.getItem(this.keys.idToken) || "");
    return payload ? payload.sub : null;
  },

  _getTokenClientId(token) {
    const payload = this._parseJwt(token || "");
    if (!payload) return "";
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return payload.azp || payload.client_id || aud || "";
  },

  _finishLocalLogout() {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.location.replace(cleanUrl);
  },

  async logout() {
    this._clearStoredTokens();
    this._clearFlowState();
    this._resetAppAuthState();

    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith("church-bible-")).map(key => caches.delete(key)));
      }
    } catch (err) {
      console.warn("Could not clear app caches during logout", err);
    }

    this._finishLocalLogout();
  }
};
