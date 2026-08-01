function toPlatform(lower) {
  return lower.includes("android")
    ? "android"
    : /iphone|ipad|ipod/.test(lower)
      ? "ios"
      : "unknown";
}

function detectBrowserFromUserAgent(lower) {
  if (/(edg|edge)\//i.test(lower)) return "edge";
  if (lower.includes("samsungbrowser")) return "samsung_internet";
  if (lower.includes("firefox/")) return "firefox";
  if (lower.includes("crios") || lower.includes("chrome/")) return "chrome";
  if (lower.includes("safari/") && lower.includes("version/")) return "safari";

  return "other";
}

function buildStandardEnvironment(platform, browser, overrides = {}) {
  return {
    kind: "standard_browser",
    container: null,
    browser: browser === "other" ? null : browser,
    decision: "allow",
    reasonCode: null,
    confidence: "medium",
    platform,
    ...overrides
  };
}

export function detectAuthenticationEnvironment(navigatorLike = (typeof navigator !== "undefined" ? navigator : null)) {
  const userAgent = String((navigatorLike && navigatorLike.userAgent) || "");
  const lower = userAgent.toLowerCase();
  const platform = toPlatform(lower);
  const browser = detectBrowserFromUserAgent(lower);

  const embedded = (container, reasonCode = "embedded_browser_unreliable", confidence = "high") => ({
    kind: "embedded_browser",
    container,
    browser: container === "android_webview" ? null : browser,
    decision: "bridge",
    reasonCode,
    confidence,
    platform
  });

  if (!lower.trim()) {
    return buildStandardEnvironment(platform, browser, { kind: "unknown", confidence: "low", decision: "allow" });
  }

  if (/\bline\//i.test(lower)) return embedded("line");
  if (lower.includes("instagram")) return embedded("instagram");
  if (lower.includes("micromessenger")) return embedded("wechat");
  if (lower.includes("fb_iab") || lower.includes("fb4a") || lower.includes("messenger")) return embedded("messenger", "embedded_browser_unreliable", "high");
  if (lower.includes("fban") || lower.includes("fbav")) return embedded("facebook");
  if (/\b; wv\)/i.test(lower) || lower.includes("version/4.0 chrome/")) return embedded("android_webview", "embedded_browser_unreliable", "medium");
  if (/version\/4\./i.test(lower) && lower.includes("android") && !lower.includes("chrome/") && !lower.includes("safari/")) {
    return embedded("android_webview", "embedded_browser_unreliable", "medium");
  }
  if (platform === "android" && /\bline\//i.test(userAgent) && /chrome\/\d+/.test(lower) && /version\//i.test(lower)) {
    return embedded("line", "embedded_browser_unreliable", "medium");
  }

  return buildStandardEnvironment(platform, browser);
}

export function shouldGateInteractiveAuth(authEnvironment, options = {}) {
  return Boolean(authEnvironment
    && authEnvironment.decision === "bridge"
    && options.authEnvironmentAcknowledged !== true);
}
