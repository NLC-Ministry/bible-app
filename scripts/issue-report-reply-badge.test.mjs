import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countUnseenReplies } from "../components/issue-report/IssueReportBlocks.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");
const adminView = readFileSync(join(root, "components", "issue-report", "AdminReportView.tsx"), "utf8");

describe("countUnseenReplies (badge count logic)", () => {
  it("counts only reports with a reply that hasn't been marked seen", () => {
    const reports = [
      { id: "1", metadata: { reply: "已回覆", reply_seen_at: null } },
      { id: "2", metadata: { reply: "已回覆", reply_seen_at: "2026-08-10T00:00:00Z" } },
      { id: "3", metadata: {} },
      { id: "4" },
      { id: "5", metadata: { reply: "另一則回覆" } }
    ];
    expect(countUnseenReplies(reports)).toBe(2);
  });

  it("returns 0 for empty/invalid input instead of throwing", () => {
    expect(countUnseenReplies([])).toBe(0);
    expect(countUnseenReplies(null)).toBe(0);
    expect(countUnseenReplies(undefined)).toBe(0);
  });
});

// The edge function is Deno-only, so — matching the repo convention
// (scripts/issue-report-submission.test.mjs) — we assert on its source.
describe("mark_issue_report_reply_seen (nlc-data)", () => {
  it("is reachable without a table param, like the other narrow special actions", () => {
    expect(edge).toContain('"save_profile", "rpc", "send_care_reminder", "mark_issue_report_reply_seen"');
  });

  it("only lets the report's own owner clear their badge, never another user's report", () => {
    const start = edge.indexOf('if (action === "mark_issue_report_reply_seen")');
    const end = edge.indexOf('if (action === "save_profile")', start);
    const block = edge.slice(start, end);
    expect(block).toContain("report.user_id !== profile.id");
    expect(block).toContain('return jsonResponse({ error: "forbidden" }, 403)');
  });

  it("recomputes metadata server-side from the current row — never trusts client-supplied metadata", () => {
    const start = edge.indexOf('if (action === "mark_issue_report_reply_seen")');
    const end = edge.indexOf('if (action === "save_profile")', start);
    const block = edge.slice(start, end);
    // Reads the row itself...
    expect(block).toContain('.select("id, user_id, metadata")');
    // ...and only ever writes back existingMetadata plus reply_seen_at —
    // body.payload / body.metadata from the client is never referenced here.
    expect(block).toContain("{ ...existingMetadata, reply_seen_at: new Date().toISOString() }");
    expect(block).not.toContain("body.payload");
    expect(block).not.toContain("body.metadata");
  });

  it("is idempotent: a second call with no new reply is a harmless no-op, not an error", () => {
    const start = edge.indexOf('if (action === "mark_issue_report_reply_seen")');
    const end = edge.indexOf('if (action === "save_profile")', start);
    const block = edge.slice(start, end);
    expect(block).toContain("!existingMetadata.reply || existingMetadata.reply_seen_at");
  });
});

describe("admin reply resets reply_seen_at so a re-reply re-triggers the badge", () => {
  it("both the network payload and the optimistic local state set reply_seen_at: null on every reply submission", () => {
    const occurrences = adminView.match(/reply_seen_at: null/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
