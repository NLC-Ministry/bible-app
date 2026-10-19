import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest workspace hygiene", () => {
  it("does not discover tests inside local git worktrees", () => {
    // 排除清單在 vitest.shared.mjs（#592），vitest.config.ts 與 vitest.build.config.ts 都用它
    const shared = readFileSync("vitest.shared.mjs", "utf8");

    expect(shared).toContain('".worktrees/**"');
    // Desktop-app session worktrees live in .claude/worktrees/ (#432).
    expect(shared).toContain('".claude/**"');
    for (const file of ["vitest.config.ts", "vitest.build.config.ts"]) {
      expect(readFileSync(file, "utf8")).toMatch(/\.\.\.BASE_EXCLUDE|exclude: BASE_EXCLUDE/);
    }
  });

  it("icon audit skips nested worktrees", () => {
    const audit = readFileSync("scripts/icon-audit.test.mjs", "utf8");

    expect(audit).toMatch(/name === "\.claude"/);
  });
});
