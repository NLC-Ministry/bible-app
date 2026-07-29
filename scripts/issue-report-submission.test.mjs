import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase", "migrations", "0030_create_issue_reports.sql"), "utf8");

// Contract tests for the issue-report submission authorization path in nlc-data.
// The edge function is Deno-only (top-level https imports), so — matching the
// repo convention (scripts/database-defense.test.mjs) — we assert on its source.
describe("issue_reports submission authorization (nlc-data)", () => {
  it("lets any authenticated member INSERT an issue report", () => {
    // A dedicated, insert-only allowance that does not require admin.
    expect(edge).toMatch(/canReportInsert\s*=\s*action === "insert" && table === "issue_reports"/);
    // ...and it feeds the member-write branch (canOwnWrite), not the admin one.
    expect(edge).toMatch(/const canOwnWrite = [^\n]*\|\| canReportInsert/);
  });

  it("forces user_id server-side so a member cannot spoof another user", () => {
    const writeProtectedLine = edge.match(/const writeProtected = \[[^\]]*\]/)?.[0] || "";
    expect(writeProtectedLine).toContain('"issue_reports"');
    // The forcing block assigns the caller's profileId on insert.
    expect(edge).toContain("copy.user_id = profileId;");
  });

  it("keeps reads of issue_reports admin-only (regression guard)", () => {
    expect(edge).toMatch(/canRead = action === "select" && \([^\n]*table === "issue_reports" && isAdmin\(profile\)/);
  });

  it("keeps issue_reports out of the generic member-write and admin-write Sets", () => {
    const ownWriteLine = edge.match(/const OWN_WRITE_TABLES = new Set\(\[[^\]]*\]/)?.[0] || "";
    const adminWriteLine = edge.match(/const ADMIN_WRITE_TABLES = new Set\(\[[^\]]*\]/)?.[0] || "";
    // Member delete/update must NOT be granted via the generic Set.
    expect(ownWriteLine).not.toContain("issue_reports");
    // Admin delete/update is granted inline (table === "issue_reports"), not via the Set.
    expect(adminWriteLine).not.toContain("issue_reports");
  });

  it("has a matching DB table + category constraint for what the client submits", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.issue_reports");
    expect(migration).toContain("category IN ('bug', 'ui', 'data', 'other')");
  });
});
