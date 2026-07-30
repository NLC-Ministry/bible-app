export function detectAuthenticationEnvironment(navigatorLike = (typeof navigator !== "undefined" ? navigator : null)) {
  const userAgent = String(navigatorLike && navigatorLike.userAgent || "");
  const lower = userAgent.toLowerCase();
  const platform = lower.includes("android")
    ? "android"
    : /iphone|ipad|ipod/.test(lower)
      ? "ios"
      : "unknown";

  const standard = {
    kind: "standard_browser",
    app: null,
    platform,
    canUseInteractiveAuth: true,
    canAttemptExternalBrowser: false,
    reasonCode: null,
    confidence: "medium"
  };

  const embedded = (app, confidence = "high") => ({
    kind: "embedded_browser",
    app,
    platform,
    canUseInteractiveAuth: false,
    canAttemptExternalBrowser: platform === "android",
    reasonCode: "embedded_browser_unreliable",
    confidence
  });

  if (!lower.trim()) return { ...standard, kind: "unknown", confidence: "low" };
  if (/\bline\//i.test(userAgent)) return embedded("line");
  if (lower.includes("instagram")) return embedded("instagram");
  if (lower.includes("micromessenger")) return embedded("wechat");
  if (lower.includes("fb_iab") || lower.includes("fb4a") || lower.includes("messenger")) return embedded("messenger");
  if (lower.includes("fban") || lower.includes("fbav")) return embedded("facebook");
  if (/\b; wv\)/i.test(userAgent) || lower.includes(" version/4.0 chrome/")) return embedded("android_webview", "medium");
  if (lower.includes("crios") || lower.includes("chrome/")) return { ...standard, app: "chrome", confidence: "high" };
  if (lower.includes("safari/") && lower.includes("version/")) return { ...standard, app: "safari", confidence: "high" };

  return { ...standard, kind: "unknown", confidence: "low" };
}

export function shouldGateInteractiveAuth(authEnvironment, options = {}) {
  return Boolean(
    authEnvironment
    && authEnvironment.canUseInteractiveAuth === false
    && options.authEnvironmentAcknowledged !== true
  );
}
