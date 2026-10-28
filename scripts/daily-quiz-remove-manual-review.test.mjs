import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = currentMigrationSql("0196_daily_quiz_simplify_review_announcement_stats.sql");
const admin = read("js/modules/admin.js");
const profile = read("js/modules/profile.js");
const db = read("js/db.js");
const edge = read("supabase/functions/nlc-data/index.ts");

describe("0196: AI generation auto-approves, no manual review", () => {
  it("complete_daily_quiz_generation sets review_status='approved' directly, no human reviewer recorded", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.complete_daily_quiz_generation"),
      sql.indexOf("-- ── (b)"));
    expect(fn).toContain("review_status = 'approved'");
    expect(fn).not.toContain("review_status = 'pending'");
    expect(fn).toContain("reviewed_by = NULL");
    expect(fn).toContain("reviewed_at = NULL");
  });

  it("drops the manual review RPC and its UI entirely", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.review_daily_quiz(UUID, BOOLEAN, UUID)");
    expect(admin).not.toContain('data-quiz-action="review"');
    expect(admin).not.toContain("db.reviewDailyQuiz");
    expect(db).not.toContain("async reviewDailyQuiz");
    expect(edge).not.toContain('"review_daily_quiz"');
  });

  it("#308: the per-question AI editor is gone; changing a day's questions goes through 換一版／自訂題目", () => {
    expect(admin).not.toContain("renderAdminQuizQuestionEditor");
    expect(admin).not.toContain("update_daily_quiz_questions");
    expect(edge).not.toContain('"update_daily_quiz_questions"');
    expect(edge).toContain('"swap_daily_quiz_version"');
    expect(edge).toContain('"set_daily_quiz_day_custom"');
  });
});

describe("0196: quiz_publication_schedules.post_announcement column and RPC params dropped", () => {
  it("drops the column and both function signatures that carried it", () => {
    expect(sql).toContain("DROP COLUMN IF EXISTS post_announcement");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.publish_daily_quiz(UUID, DATE, TEXT, TEXT, TEXT, JSONB, UUID, TIMESTAMPTZ, BOOLEAN)");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.schedule_daily_quiz_publish(UUID, DATE, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN)");
  });

  it("run_daily_quiz_schedule_sweep no longer forwards p_post_announcement", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.run_daily_quiz_schedule_sweep"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.run_daily_quiz_schedule_sweep"));
    expect(fn).not.toContain("post_announcement");
    // #308 起 sweep 只跑自動發佈，不再讀 quiz_publication_schedules
    expect(fn).toContain("auto_result := public.run_daily_quiz_auto_publish();");
  });

  it("drops the leaderboard reveal RPC and its private PR-population helpers", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.daily_quiz_reveal_leaderboard(UUID, DATE, UUID)");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public._daily_quiz_score_pop(UUID, DATE, UUID, UUID)");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public._daily_quiz_team_avg_pop(UUID, DATE, INTEGER)");
    expect(db).not.toContain("revealDailyQuizLeaderboard");
    expect(admin).not.toContain("data-quiz-stats-reveal");
    expect(edge).not.toContain('"daily_quiz_reveal_leaderboard"');
  });
});

describe("0196: daily_quiz_get_stats simplified to participation rate + full roster", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.daily_quiz_get_stats"),
    sql.indexOf("COMMENT ON FUNCTION public.daily_quiz_get_stats"));

  it("trend only keeps participationRate (no avgScore/avgTimeSeconds/leaderboardPublished)", () => {
    expect(fn).toContain("'participationRate'");
    expect(fn).not.toContain("'avgScore'");
    expect(fn).not.toContain("'avgTimeSeconds'");
    expect(fn).not.toContain("'leaderboardPublished'");
  });

  it("roster now includes every eligible member, not just the ones who submitted", () => {
    expect(fn).toContain("eligible_members AS");
    expect(fn).toContain("LEFT JOIN public.quiz_attempts qa");
    expect(fn).toContain("'completed', qa.id IS NOT NULL");
  });

  it("drops the byQuestion breakdown entirely", () => {
    expect(fn).not.toContain("byQuestion");
  });

  it("admin.js renders participation rate + a completed/not-completed roster, no averages or PR", () => {
    expect(admin).toContain("<th>參與率</th>");
    expect(admin).toContain("<th>狀態</th>");
    expect(admin).toContain("row.completed");
    expect(admin).not.toContain("<th>平均分</th>");
    expect(admin).not.toContain("<th>平均時間</th>");
    expect(admin).not.toContain("<th>PR 公布</th>");
  });
});

describe("0196: member's own results drop PR, gain their own answer time", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.daily_quiz_get_my_results"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.daily_quiz_get_my_results"));

  it("daily_quiz_get_my_results no longer computes any PR field", () => {
    expect(fn).not.toContain("prPublished");
    expect(fn).not.toContain("prChurch");
    expect(fn).not.toContain("prZone");
    expect(fn).not.toContain("prGroup");
    expect(fn).not.toContain("_exam_pr");
    expect(fn).toContain("'timeSeconds'");
  });

  it("profile.js shows the member's own time spent instead of PR lines", () => {
    expect(profile).not.toContain("item.prPublished");
    expect(profile).not.toContain("prLines");
    expect(profile).toContain("item.timeSeconds");
    expect(profile).toContain("作答時間");
  });

  it("get_daily_quiz_dashboard's myQuiz.attempt also carries timeSeconds for the just-completed quiz", () => {
    const dashboardFn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.get_daily_quiz_dashboard"),
      sql.indexOf("COMMENT ON FUNCTION public.get_daily_quiz_dashboard"));
    // #643：myQuiz 的內容搬進共用的 _daily_quiz_member_view
    expect(dashboardFn).toContain("public._daily_quiz_member_view(publication_row.id, actor_id)");
    expect(latestFunctionDefinition("_daily_quiz_member_view").text).toContain("'timeSeconds', CASE WHEN attempt_row.completed_at > attempt_row.started_at");
  });
});

describe("0196: publish permissions and admin/大測驗 coexistence unchanged", () => {
  // 0196 當時小組長以上都能發佈；#306 起只剩系統管理員（自動發佈帶開規則的管理員）
  it("publish is admin-only since #306", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.publish_daily_quiz"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.publish_daily_quiz"));
    expect(fn).toMatch(/IF actor_role IS DISTINCT FROM 'admin' THEN\s+RAISE EXCEPTION 'quiz_publish_admin_only';/);
  });

  it("exam_papers (大測驗) tables/functions are untouched by this migration", () => {
    // The migration's own header comment mentions exam_papers once, just to
    // note the two systems don't overlap — but it never touches (CREATE OR
    // REPLACE / ALTER / DROP) anything belonging to the exam system.
    expect(sql).not.toContain("FUNCTION public.exam_get_my_result");
    expect(sql).not.toContain("TABLE public.exam_papers");
    expect(sql).not.toContain("TABLE public.exam_attempts");
  });
});
