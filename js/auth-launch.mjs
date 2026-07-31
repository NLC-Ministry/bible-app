import {
  detectAuthenticationEnvironment,
  shouldGateInteractiveAuth
} from "./auth-environment.js";
import {
  createAuthContinuation,
  parseContinuationFromSearchParams,
  serializeAuthContinuation,
  cleanReturnTo,
  validateContinuation
} from "./auth-continuation.mjs";

const defaultSafeReturnTo = "/";

function normalizeIntent(intent = "login") {
  const safe = String(intent || "");
  const allowed = new Set(["login", "register", "account_center", "step_up", "reconnect_identity", "satellite_sso"]);
  return allowed.has(safe) ? safe : "login";
}

function normalizeStartInput(input = {}) {
  if (input === null || input === undefined) return {};
  if (typeof input === "string") {
    return { intent: "login", returnTo: cleanReturnTo(input) };
  }
  return {
    intent: normalizeIntent(input.intent || "login"),
    returnTo: cleanReturnTo(input.returnTo || defaultSafeReturnTo),
    target: input.target
  };
}

const authLaunch = {
  startInteractiveAuth(input = {}) {
    if (typeof window === "undefined" || !window.auth) {
      return false;
    }

    const normalized = normalizeStartInput(input);
    const continuation = createAuthContinuation(normalized);
    const authEnvironment = detectAuthenticationEnvironment();

    if (shouldGateInteractiveAuth(authEnvironment, { authEnvironmentAcknowledged: false })) {
      this.renderBridge(continuation, authEnvironment);
      return true;
    }

    return window.auth.startInteractiveLogin(continuation);
  },

  continueInteractiveAuth(continuation) {
    if (typeof window === "undefined" || !window.auth) {
      return false;
    }

    if (validateContinuation(continuation)) {
      return window.auth.startInteractiveLogin(continuation);
    }

    return false;
  },

  renderBridge(continuation, authEnvironment) {
    if (typeof window === "undefined" || !window.auth || typeof window.auth.showEmbeddedBrowserAuthDialog !== "function") {
      return false;
    }

    const validContinuation = validateContinuation(continuation)
      ? continuation
      : parseContinuationFromSearchParams(window.location.search) || null;

    if (!validContinuation) return false;

    window.auth.showEmbeddedBrowserAuthDialog(authEnvironment || detectAuthenticationEnvironment(), serializeAuthContinuation(validContinuation));
    return true;
  },

  parseContinuationFromSearchParams(search = "") {
    return parseContinuationFromSearchParams(search);
  },

  async maybeResumeInteractiveAuthFromBridge() {
    if (typeof window === "undefined" || !window.auth) return false;

    const continuation = parseContinuationFromSearchParams(window.location.search);
    if (!continuation) return false;

    const authEnvironment = detectAuthenticationEnvironment();
    if (shouldGateInteractiveAuth(authEnvironment, { authEnvironmentAcknowledged: false })) {
      return this.renderBridge(continuation, authEnvironment);
    }

    return this.continueInteractiveAuth(continuation);
  }
};

if (typeof window !== "undefined") {
  window.authLaunch = authLaunch;
}

export { authLaunch };
