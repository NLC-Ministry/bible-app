import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("issue report textarea readability tests", () => {
  it("verifies Textarea component has text-foreground and text-base for high contrast typing", () => {
    const code = readFileSync("components/ui/textarea.tsx", "utf8");
    expect(code).toContain("text-foreground");
    expect(code).toContain("text-base");
  });

  it("verifies AdminReportTable reply textarea has text-base and clear contrast", () => {
    const code = readFileSync("components/issue-report/AdminReportTable.tsx", "utf8");
    expect(code).toContain('id="reply-message-textarea"');
    expect(code).toContain("text-base");
    expect(code).toContain("text-slate-100");
  });

  it("verifies index.css includes textarea high contrast font-size and color safeguards", () => {
    const css = readFileSync("index.css", "utf8");
    expect(css).toContain("#reply-message-textarea,");
    expect(css).toContain("#description,");
    expect(css).toContain("color: var(--text-primary, #F8FAFC) !important;");
  });
});
