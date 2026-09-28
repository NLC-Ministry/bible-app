import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 2026-09-29：①小測驗發佈不發通知 ②讀完一遍後每次小測驗都能作答，不看當天進度。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20260928175636_daily_quiz_publish_no_notification.sql");
const plan = read("js/modules/plan.js");

describe("daily quiz publish sends no notification", () => {
  it("publish_daily_quiz no longer inserts into quiz_notifications", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.publish_daily_quiz(");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = migration.slice(start, migration.indexOf("$function$;", start));
    expect(body).toContain("INSERT INTO public.quiz_publications(");
    expect(body).not.toContain("quiz_notifications");
  });

  it("keeps the same signature and grants", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC, anon;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) TO authenticated, service_role;");
    expect(migration).toContain("RAISE EXCEPTION 'quiz_publish_admin_only';");
  });

  it("marks the existing unread quiz notifications as read without deleting them", () => {
    expect(migration).toContain("UPDATE public.quiz_notifications
SET status = 'read', read_at = NOW()
WHERE status = 'unread';");
    expect(migration).not.toContain("DELETE FROM public.quiz_notifications");
  });
});

describe("daily quiz reading gate after the first round", () => {
  const loadHelpers = () => {
    const start = plan.indexOf("function hasCompletedDailyQuizFirstRound(");
    const end = plan.indexOf("function openDailyQuizContent(");
    expect(start).toBeGreaterThanOrEqual(0);
    // eslint-disable-next-line no-new-func
    return new Function(`${plan.slice(start, end)}; return { hasCompletedDailyQuizFirstRound, getDailyQuizReadingProgress };`)();
  };
  const today = "2026-09-29";
  const unreadDay = { isoDate: today, chapters: [{ round: 1, isReadR1: false }, { round: 1, isReadR1: false }] };

  it("still requires today's reading before the first round is finished", () => {
    const { getDailyQuizReadingProgress } = loadHelpers();
    const progress = getDailyQuizReadingProgress({ currentRound: 1, isPlanCompleted: false, days: [unreadDay] }, today);
    expect(progress.isComplete).toBe(false);
    expect(progress.remaining).toBe(2);
  });

  it("lets a member who finished round 1 answer without checking today's reading", () => {
    const { getDailyQuizReadingProgress } = loadHelpers();
    expect(getDailyQuizReadingProgress({ currentRound: 1, isPlanCompleted: true, days: [unreadDay] }, today).isComplete).toBe(true);
  });

  it("treats being in round 2+ as having finished once, even with no chapters scheduled today", () => {
    const { getDailyQuizReadingProgress } = loadHelpers();
    expect(getDailyQuizReadingProgress({ currentRound: 2, isPlanCompleted: false, days: [] }, today).isComplete).toBe(true);
  });

  it("tells finished readers they can answer directly", () => {
    expect(plan).toContain("你已讀完一遍，可以直接作答");
  });
});
