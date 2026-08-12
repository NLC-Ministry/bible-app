import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("index.css", "utf8");

describe("home announcements", () => {
  it("uses the main page scrollbar instead of a nested announcement scrollbar", () => {
    const listRule = css.match(/\.announcements-list \{([\s\S]*?)\}/)?.[1] || "";

    expect(listRule).toContain("max-height: none;");
    expect(listRule).toContain("overflow: visible;");
    expect(listRule).not.toContain("overflow-y: auto;");
    expect(css).not.toContain(".announcements-list::-webkit-scrollbar");
  });
});
