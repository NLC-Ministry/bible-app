import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = readFileSync(join(root, "supabase", "migrations", "0010_database_defense.sql"), "utf8");
const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
const db = readFileSync(join(root, "js", "db.js"), "utf8");
const home = readFileSync(join(root, "js", "modules", "home.js"), "utf8");

describe("database defense migration", () => {
  it("adds numeric, date, ownership, and state-transition defenses", () => {
    for (const contract of [
      "verse_likes_count_nonnegative",
      "global_plans_date_order",
      "reading_plans_date_order",
      "idx_reading_logs_unique_personal",
      "enforce_reading_log_plan_owner",
      "enforce_reading_plan_progress_transition",
      "protect_profile_privileged_fields",
      "enforce_care_reminder_transition"
    ]) expect(migration).toContain(contract);
  });

  it("removes direct browser writes to counters and hardens SECURITY DEFINER search paths", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.verse_likes FROM anon, authenticated");
    expect(migration).toContain("DROP POLICY IF EXISTS \"Allow public write access\"");
    expect(migration.match(/SET search_path = pg_catalog, public/g)?.length).toBeGreaterThanOrEqual(4);
    expect((migration.match(/\$\$/g) || []).length % 2).toBe(0);
  });

  it("routes NLC likes through an RPC allowlist and blocks generic privileged writes", () => {
    const ownWriteLine = edge.match(/const OWN_WRITE_TABLES = new Set\(\[[^\n]+/)?.[0] || "";
    expect(ownWriteLine).not.toContain("profiles");
    expect(ownWriteLine).not.toContain("verse_likes");
    expect(edge).toContain('const RPC_FUNCTIONS = new Set(["increment_likes", "decrement_likes"])');
    expect(edge).toContain('if (action === "rpc")');
    expect(db).toContain('callEdge({ action: "rpc", function: functionName, args })');
  });

  it("contains no client-side read-modify-write fallback for verse counters", () => {
    expect(home).not.toContain('.update({ like_count:');
    expect(home).not.toContain('.insert({ source: verseSource, like_count:');
    expect(home).toContain('Atomic verse-like RPC is unavailable');
    expect(home).toContain("optimistic state rolled back");
    expect(home).toContain("liked = previousLiked");
  });
});