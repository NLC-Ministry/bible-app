import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edge = readFileSync(join(root, "supabase", "functions", "issue-report-sheet-sync", "index.ts"), "utf8");
const readme = readFileSync(join(root, "supabase", "functions", "README.md"), "utf8");
const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
const migration = readFileSync(join(root, "supabase", "migrations", "0077_issue_report_sheet_sync_trigger.sql"), "utf8");

// The edge function is Deno-only (top-level Deno.serve / Deno.env), so —
// matching the repo convention (scripts/issue-report-submission.test.mjs,
// scripts/database-defense.test.mjs) — we assert on its source rather than
// executing it.
describe("issue-report-sheet-sync (new report -> Google Sheet)", () => {
  it("only forwards the 4 non-personal fields, never user_id/url/user_agent/metadata/id", () => {
    const rowBlock = edge.slice(edge.indexOf("const row = {"), edge.indexOf("try {", edge.indexOf("const row = {")));
    expect(rowBlock).toContain("created_at: createdAt");
    expect(rowBlock).toContain("category:");
    expect(rowBlock).toContain("status:");
    expect(rowBlock).toContain("description");
    expect(rowBlock).not.toContain("user_id");
    expect(rowBlock).not.toContain("record.url");
    expect(rowBlock).not.toContain("user_agent");
    expect(rowBlock).not.toContain("metadata");
    expect(rowBlock).not.toContain("record.id");
  });

  it("translates category and status to the same Chinese labels the admin UI uses", () => {
    expect(edge).toContain('bug: "Bug 錯誤"');
    expect(edge).toContain('ui: "UI 建議"');
    expect(edge).toContain('data: "資料問題"');
    expect(edge).toContain('other: "其他"');
    expect(edge).toContain('pending: "待處理"');
    expect(edge).toContain('processing: "處理中"');
    expect(edge).toContain('resolved: "已解決"');
    expect(edge).toContain('ignored: "已忽略"');
  });

  it("only acts on INSERT into issue_reports, and requires the shared secret header", () => {
    expect(edge).toContain('payload?.table !== "issue_reports" || payload?.type !== "INSERT"');
    expect(edge).toContain('req.headers.get("x-webhook-secret") !== webhookSecret');
    expect(edge).toContain('Deno.env.get("ISSUE_REPORT_WEBHOOK_SECRET")');
  });

  it("authenticates to the Apps Script sheet endpoint with its own separate secret", () => {
    expect(edge).toContain('Deno.env.get("ISSUE_REPORT_SHEET_WEBHOOK_URL")');
    expect(edge).toContain('Deno.env.get("ISSUE_REPORT_SHEET_WEBHOOK_SECRET")');
    expect(edge).toContain("secret: sheetSecret");
  });

  it("is registered with verify_jwt = false, matching nlc-session/nlc-data (its caller carries no Supabase/Logto token)", () => {
    const fnBlock = config.slice(config.indexOf("[functions.issue-report-sheet-sync]"));
    expect(fnBlock).toContain("verify_jwt = false");
  });

  it("documents the required secrets and the manual Google/Supabase setup steps", () => {
    expect(readme).toContain("issue-report-sheet-sync");
    expect(readme).toContain("ISSUE_REPORT_WEBHOOK_SECRET");
    expect(readme).toContain("ISSUE_REPORT_SHEET_WEBHOOK_URL");
    expect(readme).toContain("ISSUE_REPORT_SHEET_WEBHOOK_SECRET");
    expect(readme).toContain("vault.create_secret");
    expect(readme).toContain("0077_issue_report_sheet_sync_trigger.sql");
  });
});

// The Dashboard's Database Webhooks UI wasn't reachable on this project
// (Triggers only offers Postgres functions, /database/hooks 404s), so the
// AFTER INSERT -> HTTP call is done directly in Postgres via pg_net instead.
describe("issue-report-sheet-sync trigger (pg_net, migration 0077)", () => {
  it("never embeds the real secret in the migration — reads it from Vault at runtime", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_net");
    expect(migration).toContain("FROM vault.decrypted_secrets");
    expect(migration).toContain("WHERE name = 'issue_report_webhook_secret'");
    expect(migration).not.toMatch(/x-webhook-secret',\s*'[^']+'\)/);
  });

  it("skips the sync instead of blocking the insert when the secret isn't configured yet", () => {
    expect(migration).toContain("IF webhook_secret IS NULL THEN");
    expect(migration).toContain("RETURN NEW;");
  });

  it("posts the same payload shape (type/table/record) the Edge Function already parses", () => {
    expect(migration).toContain("'type', 'INSERT'");
    expect(migration).toContain("'table', 'issue_reports'");
    expect(migration).toContain("'record', row_to_json(NEW)");
    expect(edge).toContain('payload?.table !== "issue_reports" || payload?.type !== "INSERT"');
  });

  it("fires AFTER INSERT only, once per row", () => {
    expect(migration).toContain("AFTER INSERT ON public.issue_reports");
    expect(migration).toContain("FOR EACH ROW");
    expect(migration).not.toContain("BEFORE INSERT");
    expect(migration).not.toContain("ON UPDATE");
  });
});
