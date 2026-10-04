import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest workspace hygiene", () => {
  it("does not discover tests inside local git worktrees", () => {
    const config = readFileSync("vitest.config.ts", "utf8");

    expect(config).toContain('".worktrees/**"');
    // Desktop-app session worktrees live in .claude/worktrees/ (#432).
    expect(config).toContain('".claude/**"');
  });

  it("icon audit skips nested worktrees", () => {
    const audit = readFileSync("scripts/icon-audit.test.mjs", "utf8");

    expect(audit).toMatch(/name === "\.claude"/);
  });
});
