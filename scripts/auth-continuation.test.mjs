import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AUTH_POLICY_VERSION,
  createAuthContinuation,
  parseAuthContinuation,
  parseContinuationFromSearchParams,
  serializeAuthContinuation,
  stripAuthTransportParams,
  cleanReturnTo,
  validateContinuation
} from "../js/auth-continuation.mjs";

describe("auth continuation policy", () => {
  it("creates canonical login continuation values", () => {
    const continuation = createAuthContinuation({ intent: "login", returnTo: "/member/plan" });

    expect(continuation).toMatchObject({
      version: AUTH_POLICY_VERSION,
      intent: "login",
      returnTo: "/member/plan"
    });
    expect(continuation.flowId).toMatch(/^[0-9A-Z]{26}$/);
    expect(validateContinuation(continuation)).toBe(true);
  });

  it("preserves allowed account-center targets and rejects unknown values", () => {
    const continuation = createAuthContinuation({ intent: "account_center", returnTo: "/", target: "email" });
    expect(continuation.target).toBe("email");

    expect(() => {
      createAuthContinuation({ intent: "account_center", returnTo: "/", target: "bad-value" });
    }).toThrowError();
  });

  it("serializes and parses continuations through URL parameters", () => {
    const continuation = createAuthContinuation({ intent: "register", returnTo: "/onboarding" });
    const serialized = serializeAuthContinuation(continuation);
    expect(serialized).toContain("%22intent%22");

    const parsed = parseContinuationFromSearchParams(`?auth_continuation=${serialized}`);
    expect(parsed).toMatchObject({
      version: AUTH_POLICY_VERSION,
      intent: "register",
      returnTo: "/onboarding"
    });
  });

  it("rejects malformed returnTo and transport-only values", () => {
    expect(cleanReturnTo("//evil.example")).toBe("/");
    expect(cleanReturnTo("/member/../../bad")).toBe("/");
    expect(cleanReturnTo("/member/..//bad"))
      .toBe("/");
    expect(parseAuthContinuation("%7B%22version%3A1%22%7D")).toBeNull();
  });

  it("strips transport-only query params", () => {
    const result = stripAuthTransportParams("https://bible.newlife.org.tw/?a=1&openExternalBrowser=1&auth_bridge_attempted=1&auth_continuation=abc&b=2");
    expect(result).toContain("a=1");
    expect(result).toContain("b=2");
    expect(result).not.toContain("openExternalBrowser");
    expect(result).not.toContain("auth_bridge_attempted");
    expect(result).not.toContain("auth_continuation=abc");
  });
});


describe("auth-environment fixture helper contract", () => {
  it("exposes policy version and fixture shape", () => {
    const fixturesSource = readFileSync("js/auth-policy-fixtures.mjs", "utf8");
    expect(fixturesSource).toContain("AUTH_POLICY_VERSION");
    expect(fixturesSource).toContain("AUTH_POLICY_V1_ENVIRONMENT_FIXTURES");
  });
});
