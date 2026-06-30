// ============================================================
// auth.js — Logto OIDC & NLC Member Hub Integration Client
// ============================================================

const auth = {
  // Configuration settings (can be overridden by config.js / env)
  config: {
    issuer: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.issuer) || "https://sso.newlife.org.tw/oidc",
    clientId: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.clientId) || "",
    memberHubUrl: (typeof NLC_CONFIG !== "undefined" && NLC_CONFIG.memberHubUrl) || "https://member.newlife.org.tw",
    scopes: "openid profile email phone"
  },

  // Token storage keys
  keys: {
    accessToken: "nlc_access_token",
    idToken: "nlc_id_token",
    refreshToken: "nlc_refresh_token",
    expiresAt: "nlc_token_expires_at",
    state: "nlc_auth_state",
    verifier: "nlc_auth_verifier",
    memberContext: "nlc_member_context"
  },

  // ── PKCE Cryptography Helpers ──────────────────────────────
  _dec2hex(dec) {
    return dec.toString(16).padStart(2, "0");
  },

  _generateCodeVerifier() {
    const array = new Uint32Array(28); // 56 characters hex
    window.crypto.getRandomValues(array);
    return Array.from(array, this._dec2hex).join("");
  },

  _sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest("SHA-256", data);
  },

  _base64urlencode(a) {
    let str = "";
    const bytes = new Uint8Array(a);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },

  async _generateCodeChallenge(v) {
    const hashed = await this._sha256(v);
    return this._base64urlencode(hashed);
  },

  // Decode JWT payload without signature verification (client-side only)
  _parseJwt(token) {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error("Failed to parse JWT:", e);
      return null;
    }
  },

  // ── Core OIDC Methods ──────────────────────────────────────
  
  /**
   * Start the Logto OIDC authorization flow redirect.
   */
  async login() {
    try {
      if (!this.config.clientId) {
        console.error("NLC OIDC clientId is missing. Set NLC_CLIENT_ID and rebuild config.js.");
        alert("教會系統登入設定缺少 Client ID，請確認 NLC_CLIENT_ID 是否已設定並重新部署。");
        return;
      }
      const stateVal = this._generateCodeVerifier();
      const verifierVal = this._generateCodeVerifier();
      const challenge = await this._generateCodeChallenge(verifierVal);

      // Save PKCE verifiers to storage
      localStorage.setItem(this.keys.state, stateVal);
      localStorage.setItem(this.keys.verifier, verifierVal);

      // Resolve redirect URI (current page URL)
      const redirectUri = window.location.origin + window.location.pathname;

      // Construct Logto authorize URL
      const authUrl = `${this.config.issuer}/auth?` + 
        `client_id=${encodeURIComponent(this.config.clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(this.config.scopes)}&` +
        `state=${encodeURIComponent(stateVal)}&` +
        `code_challenge=${encodeURIComponent(challenge)}&` +
        `code_challenge_method=S256`;

      console.log("Redirecting to Logto OIDC:", authUrl);
      window.location.href = authUrl;
    } catch (err) {
      console.error("Logto login redirect failed:", err);
      showToast("無法開啟登入頁面，請重試！");
    }
  },

  /**
   * Handle redirect callback from Logto.
   * Checks query parameters for authorization code.
   * @returns {Promise<boolean>} True if OIDC flow was handled and authenticated
   */
  async handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const stateVal = urlParams.get("state");

    if (!code || !stateVal) return false;

    // Verify state to prevent CSRF
    const savedState = localStorage.getItem(this.keys.state);
    if (!savedState || savedState !== stateVal) {
      console.error("OIDC state mismatch! CSRF suspected.");
      this.logout();
      return false;
    }

    const verifier = localStorage.getItem(this.keys.verifier);
    if (!verifier) {
      console.error("OIDC code verifier missing.");
      return false;
    }

    loader.show("整合登入授權中...");
    try {
      const redirectUri = window.location.origin + window.location.pathname;

      // Exchange authorization code for tokens
      const response = await fetch(`${this.config.issuer}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri,
          client_id: this.config.clientId,
          code_verifier: verifier
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error("OIDC token exchange failed response:", response.status, response.statusText, errorText);
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}${errorText ? " - " + errorText : ""}`);
      }

      const data = await response.json();
      this._saveTokens(data);

      // Clean query params from URL bar
      urlParams.delete("code");
      urlParams.delete("state");
      const cleanUrl = window.location.origin + window.location.pathname + 
        (urlParams.toString() ? "?" + urlParams.toString() : "") + 
        window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      // Fetch church context to align profile
      await this.fetchAndSyncMemberContext();
      
      showToast("登入成功！歡迎使用 NLC 讀經系統");
      return true;
    } catch (err) {
      console.error("OIDC callback token exchange error:", err);
      showToast("登入授權失敗，請重試。");
      this.logout();
      return false;
    } finally {
      // Clear PKCE flow items
      localStorage.removeItem(this.keys.state);
      localStorage.removeItem(this.keys.verifier);
      loader.hide();
    }
  },

  _saveTokens(tokenResponse) {
    if (tokenResponse.access_token) {
      localStorage.setItem(this.keys.accessToken, tokenResponse.access_token);
    }
    if (tokenResponse.id_token) {
      localStorage.setItem(this.keys.idToken, tokenResponse.id_token);
    }
    if (tokenResponse.refresh_token) {
      localStorage.setItem(this.keys.refreshToken, tokenResponse.refresh_token);
    }
    if (tokenResponse.expires_in) {
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
      localStorage.setItem(this.keys.expiresAt, expiresAt.toString());
    }
  },

  /**
   * Fetch Member Hub Context API and sync with state.currentUser
   */
  async fetchAndSyncMemberContext() {
    const token = localStorage.getItem(this.keys.accessToken);
    if (!token) return null;

    try {
      const response = await fetch(`${this.config.memberHubUrl}/api/me/context`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        // If expired or unauthorized, try refreshing tokens
        if (response.status === 401 && await this.refreshTokens()) {
          return this.fetchAndSyncMemberContext();
        }
        throw new Error(`Member Hub context fetch failed: ${response.status}`);
      }

      const data = await response.json();
      if (data && data.ok && data.context) {
        const context = data.context;
        localStorage.setItem(this.keys.memberContext, JSON.stringify(context));
        
        // Align state.currentUser with church ecosystem context
        state.currentUser.name = context.profile.displayName || context.identity.username || "未具名會友";
        state.currentUser.role = context.primaryRole || "member";
        state.realRole = state.currentUser.role;

        // Map HomeNodeName to Group/Zone
        const nodeName = context.organization.homeNodeName || "新會友";
        state.currentUser.small_group = nodeName;
        state.currentUser.pastoral_zone = nodeName;
        state.currentUser.great_region = "Ecosystem";

        console.log("Aligned current user with Member Hub profile:", state.currentUser);
        return context;
      }
      return null;
    } catch (err) {
      console.error("Error fetching Member Hub context:", err);
      return null;
    }
  },

  /**
   * Attempt token refresh using the Refresh Token.
   * @returns {Promise<boolean>} True if refresh succeeded
   */
  async refreshTokens() {
    const refreshToken = localStorage.getItem(this.keys.refreshToken);
    if (!refreshToken) return false;

    console.log("Refreshing Logto OIDC tokens...");
    try {
      const response = await fetch(`${this.config.issuer}/token`, {
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
        console.error("OIDC refresh failed response:", response.status, errorText);
        throw new Error(`OIDC Refresh failed: ${response.status}${errorText ? " - " + errorText : ""}`);
      }

      const data = await response.json();
      this._saveTokens(data);
      console.log("Tokens refreshed successfully.");
      return true;
    } catch (err) {
      console.error("Logto token refresh error:", err);
      this.logout();
      return false;
    }
  },

  /**
   * Check if user is logged in via OIDC.
   */
  isLoggedIn() {
    const token = localStorage.getItem(this.keys.accessToken);
    const expiresAt = parseInt(localStorage.getItem(this.keys.expiresAt) || "0");
    
    if (!token) return false;
    return Date.now() < expiresAt;
  },

  /**
   * Get Logto User ID (sub)
   */
  getLogtoSubject() {
    const idToken = localStorage.getItem(this.keys.idToken);
    if (!idToken) return null;
    const payload = this._parseJwt(idToken);
    return payload ? payload.sub : null;
  },

  /**
   * Log out from application and trigger Logto end-session endpoint redirect.
   */
  async logout() {
    const idToken = localStorage.getItem(this.keys.idToken);
    
    // Clear local storage tokens
    localStorage.removeItem(this.keys.accessToken);
    localStorage.removeItem(this.keys.idToken);
    localStorage.removeItem(this.keys.refreshToken);
    localStorage.removeItem(this.keys.expiresAt);
    localStorage.removeItem(this.keys.memberContext);

    // Reset local state
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

    if (idToken) {
      // Redirect to Logto End Session Endpoint
      const postLogoutRedirectUri = window.location.origin + window.location.pathname;
      const logoutUrl = `${this.config.issuer}/auth/logout?` + 
        `id_token_hint=${encodeURIComponent(idToken)}&` +
        `post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`;
      
      console.log("Redirecting to Logto logout endpoint:", logoutUrl);
      window.location.href = logoutUrl;
    } else {
      window.location.reload();
    }
  }
};
