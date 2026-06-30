// ============================================================
// auth.js - Logto OIDC & NLC Member Hub Integration Client
// ============================================================

const auth = {
  config: {
    issuer: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.issuer) || "https://sso.newlife.org.tw/oidc",
    clientId: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.clientId) || "",
    memberHubUrl: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.memberHubUrl) || "https://member.newlife.org.tw",
    scopes: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.scopes) || "openid"
  },

  keys: {
    accessToken: "nlc_access_token",
    idToken: "nlc_id_token",
    refreshToken: "nlc_refresh_token",
    expiresAt: "nlc_token_expires_at",
    state: "nlc_auth_state",
    verifier: "nlc_auth_verifier",
    memberContext: "nlc_member_context"
  },

  metadata: null,

  _joinUrl(base, path) {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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

  _dec2hex(dec) {
    return dec.toString(16).padStart(2, "0");
  },

  _generateCodeVerifier() {
    const array = new Uint32Array(28);
    window.crypto.getRandomValues(array);
    return Array.from(array, this._dec2hex).join("");
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

  async login() {
    try {
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
      await this.fetchAndSyncMemberContext();
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

  async fetchAndSyncMemberContext() {
    const token = localStorage.getItem(this.keys.accessToken);
    if (!token) return null;

    try {
      const response = await fetch(`${this.config.memberHubUrl}/api/me/context`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        if (response.status === 401 && await this.refreshTokens()) return this.fetchAndSyncMemberContext();
        throw new Error(`Member Hub context fetch failed: ${response.status}`);
      }

      const data = await response.json();
      if (data && data.ok && data.context) {
        const context = data.context;
        localStorage.setItem(this.keys.memberContext, JSON.stringify(context));

        const profile = context.profile || {};
        const identity = context.identity || {};
        const organization = context.organization || {};
        const nodeName = organization.homeNodeName || "";

        state.currentUser.name = profile.displayName || identity.username || state.currentUser.name || "NLC User";
        state.currentUser.role = context.primaryRole || state.currentUser.role || "member";
        state.realRole = state.currentUser.role;
        state.currentUser.small_group = nodeName;
        state.currentUser.pastoral_zone = nodeName;
        state.currentUser.great_region = organization.homeRegionName || "Ecosystem";
        return context;
      }
    } catch (err) {
      console.error("Error fetching Member Hub context:", err);
      this._applyTokenProfileFallback();
    }
    return null;
  },

  async refreshTokens() {
    const refreshToken = localStorage.getItem(this.keys.refreshToken);
    if (!refreshToken) return false;

    try {
      const endpoints = await this._getEndpoints();
      const response = await fetch(endpoints.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.config.clientId
        })
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
    const expiresAt = parseInt(localStorage.getItem(this.keys.expiresAt) || "0", 10);
    return !!token && Date.now() < expiresAt;
  },

  getLogtoSubject() {
    const payload = this._parseJwt(localStorage.getItem(this.keys.idToken) || "");
    return payload ? payload.sub : null;
  },

  async logout() {
    const idToken = localStorage.getItem(this.keys.idToken);
    this._clearStoredTokens();
    this._clearFlowState();
    this._resetAppAuthState();

    if (idToken) {
      try {
        const endpoints = await this._getEndpoints();
        const postLogoutRedirectUri = this._getRedirectUri();
        const logoutParams = new URLSearchParams({
          id_token_hint: idToken,
          post_logout_redirect_uri: postLogoutRedirectUri
        });
        window.location.href = `${endpoints.endSessionEndpoint}?${logoutParams.toString()}`;
        return;
      } catch (err) {
        console.error("OIDC logout endpoint discovery failed:", err);
      }
    }

    window.location.reload();
  }
};
