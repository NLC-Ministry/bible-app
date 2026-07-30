import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  detectAuthenticationEnvironment,
  shouldGateInteractiveAuth
} from "../js/auth-environment.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const authSource = read("js/auth.js");
const cssSource = read("index.css");

describe("Bible app authentication browser environment gate", () => {
  it("classifies LINE and Instagram as embedded browsers for interactive auth", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Mobile/15E148 Line/14.12.0"
    })).toMatchObject({
      kind: "embedded_browser",
      app: "line",
      canUseInteractiveAuth: false,
      reasonCode: "embedded_browser_unreliable"
    });

    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 338.0.0.30.95"
    })).toMatchObject({
      kind: "embedded_browser",
      app: "instagram",
      platform: "ios",
      canUseInteractiveAuth: false,
      canAttemptExternalBrowser: false
    });
  });

  it("allows Android embedded browsers to attempt a Chrome handoff", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 338.0.0.30.95"
    })).toMatchObject({
      kind: "embedded_browser",
      app: "instagram",
      platform: "android",
      canAttemptExternalBrowser: true
    });
  });

  it("allows standard Safari and Chrome browsers", () => {
    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
    })).toMatchObject({
      kind: "standard_browser",
      app: "safari",
      canUseInteractiveAuth: true
    });

    expect(detectAuthenticationEnvironment({
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"
    })).toMatchObject({
      kind: "standard_browser",
      app: "chrome",
      canUseInteractiveAuth: true
    });
  });

  it("does not re-gate after the user acknowledges the browser guidance", () => {
    const env = detectAuthenticationEnvironment({ userAgent: "Line/14.12.0" });

    expect(shouldGateInteractiveAuth(env)).toBe(true);
    expect(shouldGateInteractiveAuth(env, { authEnvironmentAcknowledged: true })).toBe(false);
  });

  it("routes auth.login through the embedded-browser guidance before OIDC", () => {
    expect(authSource).toContain("detectAuthenticationEnvironment");
    expect(authSource).toContain("shouldGateInteractiveAuth(authEnvironment, options)");
    expect(authSource).toContain("showEmbeddedBrowserAuthDialog(authEnvironment)");
    expect(authSource).not.toContain("authEnvironmentAcknowledged: true");
    expect(authSource).toContain("請使用 Safari / Chrome 繼續");
    expect(authSource).toContain("複製連結");
    expect(authSource).toContain("intent://");
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
