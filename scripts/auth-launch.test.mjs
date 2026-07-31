/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authLaunch } from "../js/auth-launch.mjs";
import { createAuthContinuation, serializeAuthContinuation } from "../js/auth-continuation.mjs";

describe("auth-launch boundary", () => {
  const originalNavigator = globalThis.navigator;
  const originalLocation = window.location.href;

  function setUserAgent(userAgent) {
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        ...originalNavigator,
        userAgent
      }
    });
  }

  beforeEach(() => {
    window.auth = {
      showEmbeddedBrowserAuthDialog: vi.fn(),
      startInteractiveLogin: vi.fn().mockResolvedValue(true)
    };
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalLocation);
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: originalNavigator
    });
    delete window.auth;
    vi.clearAllMocks();
  });

  it("routes embedded browsers to bridge dialog", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.12.0");

    const continuation = createAuthContinuation({ intent: "login", returnTo: "/member" });

    const started = await authLaunch.startInteractiveAuth(continuation);

    expect(started).toBe(true);
    expect(window.auth.showEmbeddedBrowserAuthDialog).toHaveBeenCalledTimes(1);
    expect(window.auth.startInteractiveLogin).not.toHaveBeenCalled();
  });

  it("routes standard browsers directly to interactive login", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1");
    const continuation = createAuthContinuation({ intent: "login", returnTo: "/member" });

    const started = await authLaunch.startInteractiveAuth(continuation);

    expect(started).toBe(true);
    expect(window.auth.startInteractiveLogin).toHaveBeenCalledTimes(1);
    expect(window.auth.showEmbeddedBrowserAuthDialog).not.toHaveBeenCalled();
  });

  it("resumes bridge continuation when environment allows", async () => {
    const continuation = createAuthContinuation({ intent: "login", returnTo: "/member" });
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1");

    window.history.replaceState({}, "", `/?auth_continuation=${serializeAuthContinuation(continuation)}`);

    const resumed = await authLaunch.maybeResumeInteractiveAuthFromBridge();

    expect(resumed).toBe(true);
    expect(window.auth.startInteractiveLogin).toHaveBeenCalledTimes(1);
    const inputArg = window.auth.startInteractiveLogin.mock.calls[0][0];
    expect(inputArg.intent).toBe("login");
    expect(inputArg.returnTo).toBe("/member");
  });

  it("does not retry OAuth in embedded context and auto-resumes after manual browser open", async () => {
    const continuation = createAuthContinuation({ intent: "login", returnTo: "/member" });
    window.history.replaceState({}, "", `/?auth_continuation=${serializeAuthContinuation(continuation)}`);

    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.12.0");
    const blocked = await authLaunch.maybeResumeInteractiveAuthFromBridge();
    expect(blocked).toBe(true);

    expect(window.auth.showEmbeddedBrowserAuthDialog).toHaveBeenCalledTimes(1);
    expect(window.auth.startInteractiveLogin).not.toHaveBeenCalled();

    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1");
    const resumed = await authLaunch.maybeResumeInteractiveAuthFromBridge();

    expect(resumed).toBe(true);
    expect(window.auth.startInteractiveLogin).toHaveBeenCalledTimes(1);
  });
});
