import { describe, it, expect } from "vitest";
import { resolveSafeReturnPath } from "../js/modules/safe-return-path.mjs";

const ORIGIN = "https://app.example.com";

describe("resolveSafeReturnPath", () => {
  it("站內路徑通過並保留 search / hash", () => {
    expect(resolveSafeReturnPath("/read", ORIGIN)).toBe("/read");
    expect(resolveSafeReturnPath("/history?x=1#a", ORIGIN)).toBe("/history?x=1#a");
  });

  // 反斜線用 String.raw 寫，避免跳脫字元把 `/\evil.com` 悄悄變成 `/evil.com`。
  it.each([
    "//evil.com",
    String.raw`/\evil.com`,
    String.raw`/\/evil.com`,
    "https://evil.com",
    "javascript:alert(1)",
    String.raw`\\evil.com`,
    "",
    null,
    undefined,
    42,
  ])("拒絕 %j", (raw) => {
    expect(resolveSafeReturnPath(raw, ORIGIN)).toBeNull();
  });

  it("沒給 origin 時拒絕", () => {
    expect(resolveSafeReturnPath("/read", "")).toBeNull();
  });
});
