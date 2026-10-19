import { describe, expect, it } from "vitest";
import { selectTextReferencingTests } from "./test-changed.mjs";

describe("test:changed picks tests that read changed files as text (#592)", () => {
  const sources = [
    ["scripts/db-rules.test.mjs", 'const db = readFileSync(join(root, "js/db.js"), "utf8");'],
    ["scripts/migration-naming.test.mjs", 'readdirSync(join(root, "supabase/migrations"))'],
    ["scripts/unrelated.test.mjs", 'readFileSync("js/app.js")'],
  ];

  it("selects a test whose source names the changed file", () => {
    expect(selectTextReferencingTests(sources, ["js/db.js"])).toEqual(["scripts/db-rules.test.mjs"]);
  });

  it("selects folder-wide tests when a migration changes", () => {
    expect(selectTextReferencingTests(sources, ["supabase/migrations/20261019000000_x.sql"])).toEqual(["scripts/migration-naming.test.mjs"]);
  });

  it("ignores changed test files themselves (vitest --changed already runs them)", () => {
    expect(selectTextReferencingTests(sources, ["scripts/unrelated.test.mjs"])).toEqual([]);
  });

  it("selects nothing for an unreferenced file", () => {
    expect(selectTextReferencingTests(sources, ["docs/staging.md"])).toEqual([]);
  });
});
