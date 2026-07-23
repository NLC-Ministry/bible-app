import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(projectRoot, "supabase/functions/nlc-data/index.ts"),
  "utf8"
);

describe("nlc-data query composition", () => {
  it("does not return a PromiseLike Supabase query directly from the async scope helper", () => {
    const helper = source.match(
      /async function applyForcedScope[\s\S]*?\n}\n\nDeno\.serve/
    )?.[0] || "";

    expect(helper).toContain("return { query");
    expect(helper).not.toMatch(/return query(?:[.;]|\s*$)/m);
    expect(source).toContain(
      "({ query } = await applyForcedScope(query, table, action, profile, supabaseAdmin));"
    );
  });

  it("applies ordering only after the scoped query builder is recovered", () => {
    const scopeIndex = source.indexOf(
      "({ query } = await applyForcedScope(query, table, action, profile, supabaseAdmin));"
    );
    const orderIndex = source.indexOf(
      "query = query.order(body.order.column"
    );

    expect(scopeIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(scopeIndex);
  });
});
