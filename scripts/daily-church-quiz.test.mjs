import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("supabase/migrations/0084_daily_church_quizzes.sql");
const cron = read("supabase/migrations/0085_schedule_daily_church_quizzes.sql");
const generator = read("supabase/functions/generate-daily-quizzes/index.ts");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const admin = read("js/modules/admin.js");
const html = read("index.html");

describe("daily church quiz", () => {
  it("hard-limits automatic AI requests to one per A/B/C variant", () => {
    expect(schema).toContain("automatic_generation_attempts BETWEEN 0 AND 1");
    expect(schema).toContain("UNIQUE (global_plan_id, quiz_date, variant)");
    expect(generator).toContain('for (const variant of ["A", "B", "C"])');
    expect(generator).toContain("if (!reservation?.reserved)");
    expect(generator).toContain('fetch("https://api.openai.com/v1/responses"');
    expect(generator).not.toMatch(/openai[\s\S]{0,120}retry/i);
  });

  it("uses Taipei church progress and a strict five-question schema", () => {
    expect(generator).toContain('timeZone: "Asia/Taipei"');
    expect(generator).toContain("resolveDailyChapters(plan.rules, quizDate)");
    expect(generator).toContain('type: "json_schema"');
    expect(generator).toContain("minItems: 5, maxItems: 5");
    expect(generator).toContain("minItems: 4, maxItems: 4");
    expect(generator).toContain("store: false");
  });

  it("requires pastoral review and makes published versions immutable", () => {
    expect(schema).toContain("actor_role NOT IN ('admin', 'pastor')");
    expect(schema).toContain("quiz_approval_required");
    expect(schema).toContain("quiz_already_published");
    expect(schema).toContain("review_status = 'approved'");
  });

  it("publishes through organization groups with one assignment per day", () => {
    expect(schema).toContain("UNIQUE (global_plan_id, quiz_date, small_group_id)");
    expect(schema).toContain("public.can_manage_quiz_group(actor_id, g.id)");
    expect(schema).toContain("ON CONFLICT (global_plan_id, quiz_date, small_group_id) DO NOTHING");
    expect(schema).toContain("quiz_notifications(publication_id, recipient_id, message)");
  });

  it("exposes only assigned quizzes and stores server-scored attempts", () => {
    expect(schema).toContain("public.profile_belongs_to_quiz_group(actor_id, publication_row.small_group_id)");
    expect(schema).toContain("quiz_questions_for_member(quiz_row.questions, attempt_row.id IS NOT NULL)");
    expect(schema).toContain("score_value := score_value + 1");
    expect(schema).toContain("UNIQUE (publication_id, user_id)");
  });

  it("connects all quiz RPCs through nlc-data and db.js", () => {
    for (const rpc of [
      "get_daily_quiz_dashboard", "review_daily_quiz", "update_daily_quiz_questions",
      "publish_daily_quiz", "submit_daily_quiz", "get_quiz_notifications",
      "mark_quiz_notifications_read"
    ]) {
      expect(edge).toContain(`"${rpc}"`);
      expect(schema).toContain(`public.${rpc}`);
    }
    expect(db).toContain("async getDailyQuizDashboard(plan, quizDate)");
    expect(db).toContain("async publishDailyQuiz(plan, quizDate, groupIds = [], publishAll = false)");
    expect(db).toContain("async submitDailyQuiz(publicationId, answers)");
  });

  it("places the member entrance below chapter progress only after assignment", () => {
    expect(html).toContain('id="daily-quiz-section"');
    expect(html.indexOf('id="daily-quiz-section"')).toBeGreaterThan(html.indexOf('id="plan-tasks-list"'));
    expect(plan).toContain("if (!context.myQuiz && !context.canPublish)");
    expect(plan).toContain("renderAssignedDailyQuiz");
    expect(plan).toContain("renderPublisherDailyQuiz");
  });

  it("adds review, publishing and scoped member results to plan management", () => {
    expect(html).toContain('data-plan-subtab="quizzes"');
    expect(admin).toContain("renderAdminQuizReviewCards");
    expect(admin).toContain('data-quiz-action="publish-group"');
    expect(admin).toContain('data-quiz-action="publish-all"');
    expect(admin).toContain("group.members");
    expect(admin).toContain("averageScore");
  });

  it("schedules one generator invocation at 00:05 Taipei time", () => {
    expect(cron).toContain("'5 16 * * *'");
    expect(cron).toContain("quiz_generation_cron_secret");
    expect(cron).toContain("generate-daily-quizzes");
  });
});
