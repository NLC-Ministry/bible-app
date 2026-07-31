import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const audit = readFileSync(
  new URL("../supabase/queries/full_data_integrity_audit.sql", import.meta.url),
  "utf8"
);

describe("full Supabase data integrity audit", () => {
  it("is read-only after SQL comments are removed", () => {
    const executableSql = audit
      .split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executableSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });

  it("covers identity, role, organization, scope, plan, log, and team links", () => {
    [
      "PROFILE_ROLE_LINK_BROKEN",
      "IDENTITY_ROLE_PROJECTION_MISMATCH",
      "VERIFIED_SATELLITE_ADMIN_NOT_LOCAL_ADMIN",
      "ORG_ID_CHAIN_MISMATCH",
      "SCOPE_COLUMN_DOES_NOT_MATCH_ROLE",
      "FIXED_ENROLLMENT_DRIFT",
      "LOG_PLAN_OWNER_MISMATCH",
      "DUPLICATE_READING_LOG",
      "TEAM_CAPTAIN_MEMBERSHIP_INVALID",
      "TEAM_MEMBER_LINK_MISMATCH"
    ].forEach(checkCode => expect(audit).toContain(checkCode));
  });

  it("also checks secondary application records", () => {
    expect(audit).toContain("SMALL_HOME_TEAM_CAPACITY_INVALID");
    expect(audit).toContain("DEVOTIONAL_COMMENT_BLANK");
    expect(audit).toContain("CARE_REMINDER_STATE_INVALID");
    expect(audit).toContain("ANNOUNCEMENT_STATE_INVALID");
    expect(audit).toContain("VERSE_LIKE_INVALID");
    expect(audit).toContain("ISSUE_REPORT_SCALAR_INVALID");
  });

  it("returns an explicit PASS row only when no issues exist", () => {
    expect(audit).toContain("NO_DATA_INTEGRITY_ISSUES");
    expect(audit).toContain("WHERE NOT EXISTS (SELECT 1 FROM numbered_issues)");
    expect(audit).toContain("error_count");
    expect(audit).toContain("warning_count");
  });
});
