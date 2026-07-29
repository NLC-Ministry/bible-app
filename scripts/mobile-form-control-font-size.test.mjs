import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("index.css", "utf8");

describe("mobile form control font-size safety", () => {
  it("defines a 16px minimum form-control text token", () => {
    expect(css).toContain("--form-control-text-size: 1rem");
  });

  it("protects textual native form controls from iOS focus zoom", () => {
    expect(css).toContain('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])');
    expect(css).toContain("textarea");
    expect(css).toContain("select");
    expect(css).toContain("font-size: var(--form-control-text-size)");
  });

  it("protects app-specific vanilla form-control classes", () => {
    [
      ".form-control",
      ".reader-search-input",
      "#plan-search-input",
      ".inline-select",
      ".reader-select-compact",
      ".announcement-form-panel__input",
      ".announcement-form-panel__textarea",
      ".devotional-textarea"
    ].forEach((selector) => {
      expect(css).toContain(selector);
    });
  });

  it("does not disable user scaling as an auto-zoom workaround", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/maximum-scale\s*=\s*1/i);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/i);
  });
});
