import { describe, expect, it } from "vitest";
import { installPullToRefresh } from "./pull-to-refresh.mjs";

describe("installPullToRefresh", () => {
  it("returns a safe cleanup function without throwing error", () => {
    const cleanup = installPullToRefresh();
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
