import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "js", "db.js"), "utf8");
const pwaCoordinatorSource = readFileSync(join(root, "js", "pwa", "PwaCoordinator.js"), "utf8");
const start = source.indexOf("async logChapterRead");
const end = source.indexOf("async syncProfileStatsToSupabase", start);
const logChapterReadSource = source.slice(start, end);

describe("reading log persistence contract", () => {
  it("falls back to update-or-insert when plan upsert is unavailable", () => {
    expect(logChapterReadSource).toContain('from("reading_logs").upsert(row');
    expect(logChapterReadSource).toContain('onConflict: "user_id,plan_id,book,chapter,round"');
    expect(logChapterReadSource).toContain("compatiblePlanWrite");
    expect(logChapterReadSource).toContain('update({ read_at: todayISO })');
    expect(logChapterReadSource).toContain("insertReadingLog()");
  });

  it("persists against the plan that opened the reader even if active context changes", () => {
    expect(logChapterReadSource).toContain("planOverride = null");
    expect(logChapterReadSource).toContain("const targetPlan = planOverride || state.activePlan");
    expect(logChapterReadSource).toContain("const planId = targetPlan ? targetPlan.id : null");
  });

  it("preserves the explicit plan through the PWA offline wrapper", () => {
    expect(pwaCoordinatorSource).toContain("roundOverride = null, planOverride = null");
    expect(pwaCoordinatorSource).toContain("createReadingPayload(book, chapter, isChecked, roundOverride, planOverride)");
    expect(pwaCoordinatorSource).toContain("originalLogChapterRead(book, chapter, isChecked, roundOverride, planOverride)");
    expect(pwaCoordinatorSource).toContain("const plan = planOverride || window.state?.activePlan || null");
    expect(pwaCoordinatorSource).toContain("persistCheckedReadingLog");
    expect(pwaCoordinatorSource).toContain("Queued upsert failed; retrying compatible update/insert");
  });
  it("fails visibly when an authenticated profile is unavailable", () => {
    expect(logChapterReadSource).toContain('authError.status = 401');
  });
});