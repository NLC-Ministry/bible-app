export const AUTH_POLICY_VERSION = 1;

export const AUTH_POLICY_V1_ENVIRONMENT_FIXTURES = [
  {
    name: "LINE iOS",
    policyVersion: AUTH_POLICY_VERSION,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.12.0",
    expected: {
      kind: "embedded_browser",
      container: "line",
      browser: "other",
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "high"
    }
  },
  {
    name: "LINE Android",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TP1A.220624.021) AppleWebKit/537.36 (KHTML, like Gecko) Line/12.0.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    expected: {
      kind: "embedded_browser",
      container: "line",
      browser: "chrome",
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "high"
    }
  },
  {
    name: "Instagram iOS",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 358.0.0.38.102",
    expected: {
      kind: "embedded_browser",
      container: "instagram",
      browser: "other",
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "high"
    }
  },
  {
    name: "Instagram Android (legacy)",
    userAgent: "Mozilla/5.0 (Linux; Android 7.0; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/55.0.0.0 Mobile Safari/537.36 Instagram 250.1.0.21.121",
    expected: {
      kind: "embedded_browser",
      container: "instagram",
      browser: "chrome",
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "high"
    }
  },
  {
    name: "Facebook Android",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 FB_IAB/FB4A;FBAV/430.0.0.0.0",
    expected: {
      kind: "embedded_browser",
      container: "messenger",
      browser: "chrome",
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "high"
    }
  },
  {
    name: "Android legacy WebView 4.0 Chrome",
    userAgent: "Dalvik/2.1.0 (Linux; U; Android 6.0; Nexus 5 Build/MRA58K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/42.0.2311.152 Mobile Safari/537.36",
    expected: {
      kind: "embedded_browser",
      container: "android_webview",
      browser: null,
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "medium"
    }
  },
  {
    name: "Chrome Android",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
    expected: {
      kind: "standard_browser",
      container: null,
      browser: "chrome",
      decision: "allow",
      reasonCode: null,
      confidence: "medium"
    }
  },
  {
    name: "Old Samsung Browser",
    userAgent: "Mozilla/5.0 (Linux; Android 5.0; SAMSUNG SM-G900A) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/6.2 Chrome/51.0.2704.90 Mobile Safari/537.36",
    expected: {
      kind: "standard_browser",
      container: null,
      browser: "samsung_internet",
      decision: "allow",
      reasonCode: null,
      confidence: "medium"
    }
  },
  {
    name: "Safari iOS",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    expected: {
      kind: "standard_browser",
      container: null,
      browser: "safari",
      decision: "allow",
      reasonCode: null,
      confidence: "medium"
    }
  },
  {
    name: "Chrome Desktop",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    expected: {
      kind: "standard_browser",
      container: null,
      browser: "chrome",
      decision: "allow",
      reasonCode: null,
      confidence: "medium"
    }
  },
  {
    name: "Unknown with strong embedded signal",
    userAgent: "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0",
    expected: {
      kind: "embedded_browser",
      container: "android_webview",
      browser: null,
      decision: "bridge",
      reasonCode: "embedded_browser_unreliable",
      confidence: "medium"
    }
  }
];
