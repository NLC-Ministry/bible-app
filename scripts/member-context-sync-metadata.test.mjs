import { describe, expect, it } from "vitest";
import fs from "node:fs";

const migrationPath = "supabase/migrations/0027_member_context_sync_metadata.sql";

describe("member context sync metadata migration", () => {
  it("adds a nullable sync timestamp to profiles without rewriting existing rows", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.profiles/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_context_synced_at\s+TIMESTAMP\s+WITH\s+TIME\s+ZONE/i);
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/DEFAULT\s+NOW\(\)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.profiles/i);
  });

  it("documents the column ownership", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("Member Hub context was last successfully projected");
  });
});

describe("member context sync observability migration", () => {
  const statusMigrationPath = "supabase/migrations/0029_member_context_sync_observability.sql";

  it("records every sync attempt, current status, and safe error detail", () => {
    const sql = fs.readFileSync(statusMigrationPath, "utf8");

    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_context_sync_attempted_at\s+TIMESTAMP\s+WITH\s+TIME\s+ZONE/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_context_sync_status\s+TEXT/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_context_sync_error\s+TEXT/i);
  });

  it("constrains sync status to operational states", () => {
    const sql = fs.readFileSync(statusMigrationPath, "utf8");

    expect(sql).toContain("member_context_sync_status_check");
    expect(sql).toContain("'success'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'degraded'");
  });
});
