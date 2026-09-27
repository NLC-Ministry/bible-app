import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { copyLightningQuizQuestion, lightningQuizStage } from "../js/modules/lightning-quiz-schedule.mjs";

// #309：快問快答狀態只剩 準備中 → 已排程 → 作答中 → 已結束
const read = path => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260927121803_lightning_quiz_schedule_states.sql");
const fnBlock = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("GRANT EXECUTE", start));
};

describe("lightningQuizStage", () => {
  const now = { date: "2026-09-28", time: "08:00:00" };
  const q = (riseDate, status = "published", start = "07:00:00", end = "10:00:00") => ({ riseDate, status, riseTimeStart: start, riseTimeEnd: end });

  it("drafts are 準備中 whatever the date", () => {
    expect(lightningQuizStage(q("2026-09-20", "draft"), now)).toBe("draft");
  });

  it("scheduled questions become live at the start time and end after the end time", () => {
    expect(lightningQuizStage(q("2026-09-29"), now)).toBe("scheduled");
    expect(lightningQuizStage(q("2026-09-28", "published", "08:00:00"), now)).toBe("live");
    expect(lightningQuizStage(q("2026-09-28", "published", "08:01:00"), now)).toBe("scheduled");
    expect(lightningQuizStage(q("2026-09-28", "published", "06:00:00", "08:00:00"), now)).toBe("live");
    expect(lightningQuizStage(q("2026-09-28", "published", "06:00:00", "07:59:59"), now)).toBe("ended");
    expect(lightningQuizStage(q("2026-09-27"), now)).toBe("ended");
  });

  it("copying keeps the content and times but clears the id and date", () => {
    const copy = copyLightningQuizQuestion({ id: "x", riseDate: "2026-09-28", riseTimeStart: "07:00:00", riseTimeEnd: "10:00:00", questionType: "single", payload: { stem: "s" }, answerKey: 1 });
    expect(copy).toEqual({ id: null, riseDate: "", riseTimeStart: "07:00:00", riseTimeEnd: "10:00:00", questionType: "single", payload: { stem: "s" }, answerKey: 1 });
  });
});

describe("migration 20260927121803", () => {
  it("only draft/published remain, and it refuses to run if archived rows exist", () => {
    expect(migration).toContain("CHECK (status IN ('draft', 'published'))");
    expect(migration.indexOf("status = 'archived'")).toBeLessThan(migration.indexOf("DROP CONSTRAINT IF EXISTS lightning_quiz_questions_status_check"));
  });

  it("editing a locked question is refused instead of forking a copy", () => {
    const upsert = fnBlock("admin_upsert_lightning_quiz_question");
    expect(upsert).toContain("RAISE EXCEPTION 'lightning_quiz_locked'");
    expect(upsert).not.toContain("forked");
    expect(upsert).not.toContain("source_question_id");
    expect(upsert).toContain("lightning_quiz_date_taken");
  });

  it("scheduling checks the window and the one-per-day rule; there is no archive", () => {
    const status = fnBlock("admin_set_lightning_quiz_status");
    expect(status).toContain("lightning_quiz_window_passed");
    expect(status).toContain("lightning_quiz_date_taken");
    expect(status).not.toContain("'archived'");
    expect(status).toContain("IF public._lightning_quiz_is_locked(q.id) THEN");
  });

  it("drops the attempt-clearing functions and keeps grants explicit", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.admin_clear_lightning_quiz_attempts(uuid, uuid);");
    for (const sig of ["admin_upsert_lightning_quiz_question(uuid, date, time, time, text, jsonb, jsonb, uuid)", "admin_set_lightning_quiz_status(uuid, text, uuid)"]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("the frontend and nlc-data no longer know about clearing attempts or archiving", () => {
    expect(read("supabase/functions/nlc-data/index.ts")).not.toContain("admin_clear_lightning_quiz_attempts");
    expect(read("js/db.js")).not.toContain("adminClearLightningQuizAttempts");
    const admin = read("js/modules/admin.js");
    expect(admin).not.toContain("data-lightning-quiz-clear");
    expect(admin).not.toContain('data-lightning-quiz-status="archived"');
    expect(read("index.html")).not.toContain("admin-lightning-quiz-fork-note");
  });
});

describe("#316 / #317 wiring", () => {
  it("the per-question leaderboard is gone everywhere; the answer detail carries the rank instead", () => {
    const drop = read("supabase/migrations/20260927143318_drop_lightning_quiz_leaderboard.sql");
    expect(drop).toContain("DROP FUNCTION IF EXISTS public.admin_get_lightning_quiz_leaderboard(uuid, integer, uuid);");
    expect(read("supabase/functions/nlc-data/index.ts")).not.toContain("admin_get_lightning_quiz_leaderboard");
    expect(read("js/db.js")).not.toContain("adminGetLightningQuizLeaderboard");
    const admin = read("js/modules/admin.js");
    expect(admin).not.toContain("查看排行榜");
    expect(admin).toContain("rankAttempts(Array.isArray(data.attempts)");
  });

  it("the app's back-button handler asks the lightning admin to close its sheet or page first", () => {
    const app = read("js/app.js");
    const hook = app.indexOf("window.closeAdminLightningQuizLayer()");
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(app.indexOf("// Admin section drill-in (mobile)"));
  });

  it("long screens are full pages, short ones stay sheets", () => {
    const html = read("index.html");
    for (const id of ["admin-lightning-quiz-editor", "admin-lightning-quiz-import", "admin-lightning-quiz-results"]) {
      expect(html).toMatch(new RegExp(`<section class="glass-card admin-lq-subpage hidden" id="${id}"`));
    }
    for (const id of ["admin-lightning-quiz-question-sheet", "admin-lightning-quiz-preview", "admin-lightning-quiz-rule"]) {
      expect(html).toMatch(new RegExp(`class="bottom-sheet-backdrop admin-lq-sheet-backdrop hidden" id="${id}"`));
    }
  });
});
