import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("index.css");
const designSystem = read("docs/design-system.md");

describe("close button design system", () => {
  it("defines a central square icon-button primitive", () => {
    expect(css).toContain(".icon-button {");
    expect(css).toContain("inline-size: 44px");
    expect(css).toContain("block-size: 44px");
    expect(css).toContain("min-inline-size: 44px");
    expect(css).toContain("min-block-size: 44px");
    expect(css).toContain("aspect-ratio: 1");
    expect(css).toContain(".dialog-close-button");
  });

  it("documents close-button primitives and anti-patterns", () => {
    expect(designSystem).toContain("Close / dismiss controls");
    expect(designSystem).toContain("Use `.dialog-close-button.icon-button`");
    expect(designSystem).toContain("Do not use `.circular-action-btn` for dialog close buttons");
    expect(designSystem).toContain("Do not inline width/height on close buttons");
  });
});
