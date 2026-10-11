// App → 後台的固定連結（#555）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ADMIN_CONSOLE_URL, adminConsoleBase, adminConsoleUserUrl } from "../js/admin-console-link.mjs";
import { DEFAULT_ADMIN_ORIGINS } from "../supabase/functions/admin-api/policy.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

describe("adminConsoleUserUrl", () => {
  it("production app links to the production console, everything else to staging", () => {
    expect(adminConsoleBase("bible.newlife.org.tw")).toBe("https://bible-speed-reading-admin.vercel.app");
    expect(adminConsoleBase("bible-speed-reading-staging.vercel.app")).toBe("https://bible-speed-reading-admin-staging.vercel.app");
    expect(adminConsoleBase("localhost")).toBe("https://bible-speed-reading-admin-staging.vercel.app");
  });

  it("opens the person directly with the view reason", () => {
    expect(adminConsoleUserUrl(ID.toUpperCase(), { reason: "因回報 abc", hostname: "bible.newlife.org.tw" }))
      .toBe(`https://bible-speed-reading-admin.vercel.app/#/support/user/${ID}?${new URLSearchParams({ reason: "因回報 abc" })}`);
    expect(adminConsoleUserUrl(ID, { hostname: "localhost" })).toBe(`https://bible-speed-reading-admin-staging.vercel.app/#/support/user/${ID}`);
  });

  it("returns null for anything that is not a user id", () => {
    expect(adminConsoleUserUrl(undefined)).toBeNull();
    expect(adminConsoleUserUrl("../evil")).toBeNull();
  });

  it("uses the same console URLs admin-api allows (CORS)", () => {
    expect(Object.values(ADMIN_CONSOLE_URL).sort()).toEqual([...DEFAULT_ADMIN_ORIGINS].sort());
  });
});

describe("legacy report management links each reporter to the console", () => {
  it("the admin report list returns the reporter id (migration) and the table renders the link", () => {
    const migration = readFileSync(join(root, "supabase", "migrations", "20261011113737_issue_admin_list_reporter_id.sql"), "utf8");
    expect(migration).toMatch(/'reporter', CASE WHEN p\.id IS NULL THEN NULL ELSE jsonb_build_object\(\s*'id', p\.id,/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.issue_admin_thread_list(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;");
    const view = readFileSync(join(root, "components", "issue-report", "AdminReportView.tsx"), "utf8");
    expect(view).toContain("id: row.reporter.id");
    const table = readFileSync(join(root, "components", "issue-report", "AdminReportTable.tsx"), "utf8");
    expect(table).toContain("adminConsoleUserUrl(report.profiles?.id");
    expect(table).toContain('rel="noopener noreferrer"');
    expect(table).toContain("在後台查看此使用者");
  });
});
