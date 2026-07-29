import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const index = readFileSync("index.html", "utf8");

describe("runtime error user-facing safety", () => {
  it("does not render technical JavaScript diagnostics to members", () => {
    expect(index).toContain("window.onerror");
    expect(index).not.toContain("【JS 執行錯誤】");
    expect(index).not.toContain("【跨域或快取引起的腳本錯誤】");
    expect(index).not.toContain("強制重新整理 (Ctrl+F5)");
    expect(index).not.toContain("可能是外部 CDN 或快取檔案");
    expect(index).not.toMatch(/document\.createElement\("div"\)[\s\S]{0,800}onerror/);
  });

  it("keeps runtime errors in console/support diagnostics instead of alerts or banners", () => {
    const handlerStart = index.indexOf("installRuntimeErrorDiagnostics");
    const handlerEnd = index.indexOf("window.MOCK_USERS_DATA", handlerStart);
    const handler = index.slice(handlerStart, handlerEnd);

    expect(handler).toContain("recordRuntimeError");
    expect(handler).toContain("window.__bibleRuntimeErrors");
    expect(handler).toContain("console.error");
    expect(handler).toContain('window.addEventListener("unhandledrejection"');
    expect(handler).not.toContain("alert(");
    expect(handler).not.toContain("appendChild");
    expect(handler).not.toContain("textContent");
    expect(handler).not.toContain("innerHTML");
  });
});
