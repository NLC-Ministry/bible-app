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
  // #359：計畫內打卡只走 record/unrecord_chapter_read，直接寫表只剩自由閱讀（plan_id NULL）。
  it("plan check-ins have no direct-table fallback; free reading writes plan_id NULL rows", () => {
    expect(logChapterReadSource).not.toContain("compatiblePlanWrite");
    expect(logChapterReadSource).not.toContain('from("reading_logs").upsert(');
    expect(logChapterReadSource).not.toContain("repository.upsert(");
    expect(logChapterReadSource).not.toContain("plan_id.eq.");
    expect(logChapterReadSource).not.toContain("rpcHandled");
    expect(logChapterReadSource).toContain("plan_id: null,");
    expect(logChapterReadSource).toContain("insertReadingLog()");
    expect(logChapterReadSource).toContain('.is("plan_id", null)');
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