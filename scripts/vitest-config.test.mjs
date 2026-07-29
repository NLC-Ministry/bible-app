import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest workspace hygiene", () => {
  it("does not discover tests inside local git worktrees", () => {
    const config = readFileSync("vitest.config.ts", "utf8");

    expect(config).toContain('".worktrees/**"');
  });
});
