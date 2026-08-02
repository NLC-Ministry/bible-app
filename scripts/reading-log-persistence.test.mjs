import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "js", "db.js"), "utf8");
const start = source.indexOf("async logChapterRead");
const end = source.indexOf("async syncProfileStatsToSupabase", start);
const logChapterReadSource = source.slice(start, end);

describe("reading log persistence contract", () => {
  it("upserts checked plan progress even when optimistic local state already exists", () => {
    expect(logChapterReadSource).toContain('from("reading_logs").upsert(row');
    expect(logChapterReadSource).toContain('onConflict: "user_id,plan_id,book,chapter,round"');
    expect(logChapterReadSource).not.toContain('from("reading_logs").update({ read_at: todayISO })');
  });

  it("persists against the plan that opened the reader even if active context changes", () => {
    expect(logChapterReadSource).toContain("planOverride = null");
    expect(logChapterReadSource).toContain("const targetPlan = planOverride || state.activePlan");
    expect(logChapterReadSource).toContain("const planId = targetPlan ? targetPlan.id : null");
  });

  it("fails visibly when an authenticated profile is unavailable", () => {
    expect(logChapterReadSource).toContain('authError.status = 401');
  });
});