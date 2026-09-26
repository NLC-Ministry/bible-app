import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// supabase/queries/diagnostics/ 只放只讀查詢（#255）。會改資料的一次性 SQL
// 放在 repo 裡很容易在錯的環境執行，要改資料就寫成 migration。
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const diagnosticsDir = join(repoRoot, "supabase/queries/diagnostics");

const WRITE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|CALL|COPY)\b/i;

function stripCommentsAndStrings(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

describe("supabase/queries/diagnostics", () => {
  const files = readdirSync(diagnosticsDir).filter(f => f.endsWith(".sql"));

  it("has diagnostic queries", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is read-only", file => {
    const sql = stripCommentsAndStrings(readFileSync(join(diagnosticsDir, file), "utf8"));
    expect(sql.match(WRITE)?.[0] ?? null).toBeNull();
  });
});

describe("scratch/", () => {
  it("is not tracked anymore; it's in .gitignore", () => {
    expect(readFileSync(join(repoRoot, ".gitignore"), "utf8")).toMatch(/^scratch\/$/m);
  });

  it("admin UI points at seeds that exist", () => {
    const admin = readFileSync(join(repoRoot, "js/modules/admin.js"), "utf8");
    const referenced = [...admin.matchAll(/supabase\/seeds\/([a-z0-9_]+\.sql)/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const seed of referenced) expect(existsSync(join(repoRoot, "supabase/seeds", seed)), seed).toBe(true);
    expect(admin).not.toMatch(/scratch\//);
  });
});
