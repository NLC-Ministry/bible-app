import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  detectAuthenticationEnvironment,
  shouldGateInteractiveAuth
} from "../js/auth-environment.js";
import { AUTH_POLICY_V1_ENVIRONMENT_FIXTURES, AUTH_POLICY_VERSION } from "../js/auth-policy-fixtures.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const authSource = read("js/auth.js");
const cssSource = read("index.css");

describe("Bible app authentication browser environment gate", () => {
  it(`matches environment policy fixtures (v${AUTH_POLICY_VERSION})`, () => {
    for (const fixture of AUTH_POLICY_V1_ENVIRONMENT_FIXTURES) {
      expect(detectAuthenticationEnvironment({ userAgent: fixture.userAgent })).toMatchObject({
        kind: fixture.expected.kind,
        container: fixture.expected.container,
        browser: fixture.expected.browser,
        decision: fixture.expected.decision,
        reasonCode: fixture.expected.reasonCode,
        confidence: fixture.expected.confidence
      });
    }
  });

  it("classifies LINE and Instagram as embedded browsers for interactive auth", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Mobile/15E148 Line/14.12.0"
    })).toMatchObject({
      kind: "embedded_browser",
      container: "line",
      decision: "bridge"
    });

    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 338.0.0.30.95"
    })).toMatchObject({
      kind: "embedded_browser",
      container: "instagram",
      platform: "ios",
      decision: "bridge"
    });
  });

  it("allows Android embedded browsers to attempt a Chrome handoff", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 338.0.0.30.95"
    })).toMatchObject({
      kind: "embedded_browser",
      container: "instagram",
      platform: "android",
      decision: "bridge"
    });
  });

  it("allows standard Safari and Chrome browsers", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
    })).toMatchObject({
      kind: "standard_browser",
      container: null,
      browser: "safari",
      decision: "allow"
    });

    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"
    })).toMatchObject({
      kind: "standard_browser",
      container: null,
      browser: "chrome",
      decision: "allow"
    });
  });

  it("does not re-gate after the user acknowledges the browser guidance", () => {
    const env = detectAuthenticationEnvironment({ userAgent: "Line/14.12.0" });

    expect(shouldGateInteractiveAuth(env)).toBe(true);
    expect(shouldGateInteractiveAuth(env, { authEnvironmentAcknowledged: true })).toBe(false);
  });

  it("routes auth.login through the embedded-browser guidance before OIDC", () => {
    expect(authSource).toContain("detectAuthenticationEnvironment");
    expect(authSource).toContain("startInteractiveLogin(");
    expect(authSource).toContain("showEmbeddedBrowserAuthDialog");
    expect(authSource).toContain("_startSystemBrowserTransition");
  });

  it("ships plain design-system styles for the auth environment dialog", () => {
    expect(cssSource).toContain(".auth-environment-dialog");
    expect(cssSource).toContain(".auth-environment-dialog__panel");
    expect(cssSource).toContain(".auth-environment-dialog__primary");
  });

  it("places the embedded-browser dialog above the full-screen login gate", () => {
    expect(cssSource).toContain(".login-gate");
    expect(cssSource).toContain("z-index: var(--z-modal)");
    expect(cssSource).toContain(".auth-environment-dialog");
    expect(cssSource).toContain("z-index: var(--z-critical)");
    expect(cssSource).not.toContain("z-index: 9999");
  });
});
