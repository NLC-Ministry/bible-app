import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const schema = read("supabase/migrations/0084_daily_church_quizzes.sql");
const cron = read("supabase/migrations/0085_schedule_daily_church_quizzes.sql");
const regeneration = read("supabase/migrations/0086_manual_daily_quiz_regeneration.sql");
const dashboardOptimization = read("supabase/migrations/0087_optimize_daily_quiz_dashboard.sql");
const featureFlag = read("supabase/migrations/0088_daily_quiz_feature_flag.sql");
const publishFlow = read("supabase/migrations/0090_quiz_publish_flow_redesign.sql");
const publishOptimization = read("supabase/migrations/0091_optimize_quiz_publication.sql");
const reservationFix = read("supabase/migrations/0092_fix_daily_quiz_generation_reservation.sql");
const scheduledPublish = read("supabase/migrations/0189_daily_quiz_scheduled_publish.sql");
const homeAnnouncement = read("supabase/migrations/0190_daily_quiz_home_announcement.sql");
const quizSql = `${schema}\n${regeneration}\n${dashboardOptimization}\n${featureFlag}\n${publishFlow}\n${publishOptimization}\n${reservationFix}\n${scheduledPublish}\n${homeAnnouncement}`;
const generator = read("supabase/functions/generate-daily-quizzes/index.ts");
const scheduleSweep = read("supabase/functions/daily-quiz-schedule-sweep/index.ts");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const admin = read("js/modules/admin.js");
const html = read("index.html");
const css = read("index.css");
const configToml = read("supabase/config.toml");

describe("daily church quiz", () => {
  it("runs the automatic A/B/C set once and supports deduplicated manual retries", () => {
    expect(schema).toContain("UNIQUE (global_plan_id, quiz_date, variant)");
    expect(generator).toContain("for (const variant of requestedVariants)");
    expect(generator).toContain("if (!reservation?.reserved)");
    expect(generator).toContain('body?.retryExisting === true');
    expect(generator).toContain('reserve_daily_quiz_regeneration');
    expect(regeneration).toContain("DROP CONSTRAINT IF EXISTS daily_quizzes_automatic_generation_attempts_check");
    expect(regeneration).toContain("CHECK (automatic_generation_attempts >= 0)");
    expect(regeneration).toContain("generation_status IN ('failed', 'ready')");
    expect(generator).toContain("https://generativelanguage.googleapis.com/v1beta/models/");
    expect(generator).toContain('"x-goog-api-key": apiKey');
    expect(generator).toContain('Deno.env.get("GEMINI_API_KEY")');
    expect(generator).toContain('Deno.env.get("GEMINI_QUIZ_MODEL")');
    expect(generator).toContain('|| "gemini-3.1-flash-lite"');
    expect(generator).toContain('function normalizeGeminiModel');
    expect(generator).toContain('replace(/^models\\//i, "")');
    expect(generator).toContain('replace(/^GEMINI_QUIZ_MODEL\\s*=\\s*/i, "")');
    expect(generator).not.toContain('|| "gemini-2.5-flash');
  });

  it("reserves A/B generation through the partial uniqueness index", () => {
    expect(publishFlow).toContain("CREATE UNIQUE INDEX IF NOT EXISTS daily_quizzes_ai_variant_unique");
    expect(publishFlow).toContain("WHERE variant IN ('A', 'B')");
    expect(reservationFix).toContain("CREATE OR REPLACE FUNCTION public.reserve_daily_quiz_generation");
    expect(reservationFix).toMatch(/ON CONFLICT \(global_plan_id, quiz_date, variant\)\s+WHERE variant IN \('A', 'B'\)\s+DO NOTHING/);
    expect(reservationFix).toContain("IF p_variant NOT IN ('A', 'B')");
    expect(reservationFix).toContain("TO service_role");
  });

  it("uses Taipei church progress and a strict five-question schema", () => {
    expect(generator).toContain('timeZone: "Asia/Taipei"');
    expect(generator).toContain("resolveDailyChapters(plan.rules, quizDate)");
    expect(generator).toContain('responseMimeType: "application/json"');
    expect(generator).toContain("responseJsonSchema");
    expect(generator).not.toContain("responseFormat: { text:");
    expect(generator).toContain("minItems: 5, maxItems: 5");
    expect(generator).toContain("minItems: 4, maxItems: 4");
    expect(generator).toContain("validateQuestions(JSON.parse(extractGeminiText(payload)))");
  });

  it("requires pastoral review and makes published versions immutable", () => {
    expect(schema).toContain("actor_role NOT IN ('admin', 'pastor')");
    expect(schema).toContain("quiz_approval_required");
    expect(schema).toContain("quiz_already_published");
    expect(schema).toContain("review_status = 'approved'");
    expect(regeneration).toContain("quiz_approval_locked");
    expect(regeneration).toContain("OLD.review_status = 'approved'");
    expect(regeneration).toContain("quiz_already_approved");
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
    // review_daily_quiz was dropped in migration 0196 — AI generation now
    // auto-approves, there's no manual review RPC left to allowlist.
    for (const rpc of [
      "get_daily_quiz_dashboard", "submit_daily_quiz", "get_quiz_notifications",
      "mark_quiz_notifications_read"
    ]) {
      expect(edge).toContain(`"${rpc}"`);
      expect(quizSql).toContain(`public.${rpc}`);
    }
    expect(edge).not.toContain('"review_daily_quiz"');
    // #308：審核、換版、手動發佈的 RPC 都拿掉了，發佈只剩每天 00:00 的自動發佈。
    for (const rpc of ["request_daily_quiz_regeneration", "update_daily_quiz_questions", "publish_daily_quiz"]) {
      expect(edge).not.toContain(`"${rpc}"`);
    }
    expect(db).toContain("async getDailyQuizDashboard(plan, quizDate)");
    expect(db).toContain("async submitDailyQuiz(publicationId, answers)");
    expect(db).not.toContain("async publishDailyQuiz(");
    expect(db).not.toContain("async regenerateDailyQuiz(");
    expect(db).not.toContain("async updateDailyQuizQuestions(");
  });

  it("places the member entrance below chapter progress only after assignment", () => {
    expect(html).toContain('id="daily-quiz-section"');
    expect(html.indexOf('id="daily-quiz-section"')).toBeGreaterThan(html.indexOf('id="plan-tasks-list"'));
    // 發佈／編輯／匯入題目已搬去系統管理後台（admin.js），打卡清單只保留
    // 會友「進入小測驗/作答」的入口，所以 gate 只看 context.myQuiz，且
    // renderPublisherDailyQuiz 這個函式本身已經整個搬走、不在 plan.js 裡了。
    expect(plan).toContain("if (!context.myQuiz) {");
    expect(plan).not.toContain("context.canPublish");
    expect(plan).not.toContain("renderPublisherDailyQuiz");
    expect(plan).toContain("renderDailyQuizEntry");
    expect(plan).toContain('id="daily-quiz-entry-button"');
    expect(plan).toContain("getDailyQuizReadingProgress");
    expect(plan).toContain("if (!progress.isComplete)");
    expect(plan).toContain("請先閱讀完今天的速讀進度，再進入小測驗");
    expect(plan).toContain("quizDate !== getDailyQuizTaiwanToday()");
    expect(plan).toContain("if (options.open === true)");
    expect(plan).toContain("renderAssignedDailyQuiz");
    expect(css).toContain(".daily-quiz-entry-button {");
    expect(css).toContain("font-size: 14px;");
  });

  it("#308: no A/B version choice or review wording is left anywhere", () => {
    expect(admin).not.toContain("approvedVariants");
    expect(admin).not.toContain("data-quiz-version-choice");
    expect(admin).not.toContain("今日 AI 題目尚未完成審核");
    expect(plan).not.toContain("data-quiz-version-choice");
    expect(admin).not.toContain("每日生成、審核、發佈與作答");
  });

  it("moves the five-question-type custom editor and text importer into the admin backend", () => {
    // 上一輪「五種題型＋文字匯入」擴充當初加錯地方（打卡清單），這裡鎖住
    // 它們現在只存在於後台，不會又悄悄跑回 plan.js 的打卡清單流程。
    expect(admin).toContain("import { parseQuizImportText } from \"./quiz-import.mjs\"");
    expect(admin).toContain("parseQuizImportText(textarea.value)");
    expect(admin).toContain("ADMIN_QUIZ_CUSTOM_TYPE_LABELS");
    expect(admin).toContain("truefalse: '是非'");
    expect(plan).not.toContain("quiz-import.mjs");
    expect(plan).not.toContain("QUIZ_CUSTOM_TYPE_LABELS");
  });

  it("#308: the old 自訂題目／審核／發佈 tabs are gone; plan management is calendar／rules／stats", () => {
    // Admin nav moved from data-plan-subtab tabs to unified #admin-section-* panels.
    expect(html).toContain('id="admin-section-quizzes"');
    expect(admin).toContain("{ key: 'calendar', label: '日曆' }");
    expect(admin).toContain("renderAdminQuizCalendar(root)");
    for (const gone of [
      "{ key: 'custom', label: '自訂題目' }", "{ key: 'review'", "renderAdminQuizReviewCards",
      "renderAdminQuizPublishPanel", 'id="admin-quiz-publish-btn"', 'data-quiz-action="regenerate"',
      "renderAdminQuizScopeSelectorHtml", "data-quiz-custom-confirm"
    ]) {
      expect(admin, gone).not.toContain(gone);
    }
  });

  it("schedules one generator invocation at 00:05 Taipei time", () => {
    expect(cron).toContain("'5 16 * * *'");
    expect(cron).toContain("quiz_generation_cron_secret");
    expect(cron).toContain("generate-daily-quizzes");
  });

  it("can disable all quiz entry points without deleting existing data", () => {
    expect(featureFlag).toMatch(/'daily_quiz',\s*FALSE/);
    expect(featureFlag).toContain("IF NOT public.is_feature_enabled('daily_quiz')");
    expect(featureFlag).not.toMatch(/DELETE FROM public\.(daily_quizzes|quiz_)/i);
    expect(generator).toContain('eq("key", "daily_quiz")');
    expect(generator).toContain('status: "feature_disabled", requests: 0');
    expect(edge).toContain('error: "daily_quiz_feature_disabled"');
    // allowedKeys may carry additional feature keys (e.g. speed_reading_exam);
    // only assert daily_quiz stays gated alongside pastoral_sharing_wall.
    expect(db).toMatch(/\["pastoral_sharing_wall", "daily_quiz"[\],]/);
    expect(html).toContain('id="admin-daily-quiz-feature-toggle"');
    expect(admin).toContain('updateFeatureSetting("daily_quiz", nextEnabled)');
    expect(plan).toContain('isDailyQuizFeatureEnabled()');
    // 重新開啟後清掉計畫 key，下次進小測驗分頁才會重新載入日曆（#308 修正）
    expect(admin).toContain("delete quizRoot.dataset.quizPlanKey");
    expect(admin).not.toContain("adminDailyQuizDashboardCache");
    expect(admin).toContain("切換至小測驗分頁後會載入原有資料");
    expect(plan).toContain('window.addEventListener("daily-quiz-feature-changed"');
    expect(plan).toContain("void renderDailyQuizSection(state.activePlan, selectedDay, lastTrackerRequestId)");
    expect(plan).toContain("dailyQuizRenderRequestId += 1");
  });

  it("uses 發佈 wording consistently in the quiz UI（#307 起後台是 7 天日曆，不再有兩版題目）", () => {
    expect(admin).not.toContain("每日三版題目");
    expect(admin).not.toContain("發布小測驗");
    // 「發佈小測驗」的文案／流程已經整個搬去後台，打卡清單不該再出現它。
    expect(plan).not.toContain("發佈小測驗");
    expect(plan).not.toContain("發布小測驗");
  });

  it("loads the organization dashboard without per-group member subqueries", () => {
    expect(dashboardOptimization).toContain("CREATE OR REPLACE FUNCTION public.get_daily_quiz_dashboard");
    expect(dashboardOptimization).toContain("member_matches AS MATERIALIZED");
    expect(dashboardOptimization).toContain("published_members AS");
    expect(dashboardOptimization).toContain("idx_quiz_publications_plan_date_group");
    expect(dashboardOptimization).not.toContain("SELECT COUNT(*) FROM public.profiles member WHERE public.profile_belongs_to_quiz_group");
  });

  it("logs each invocation and Gemini variant without exposing secrets", () => {
    expect(generator).toContain("daily_quiz_invocation_received");
    expect(generator).toContain("daily_quiz_gemini_request_started");
    expect(generator).toContain("daily_quiz_variant_failed");
    expect(generator).toContain("daily_quiz_generation_finished");
    expect(generator).not.toContain('apiKey }));');
    expect(generator).not.toContain('cronSecret }));');
  });

  it("shows a safe retryable error state instead of raw database errors", () => {
    expect(db).toContain('normalized.includes("canceling statement")');
    expect(db).toContain('return "小測驗載入逾時，請稍後再試。"');
    expect(db).toContain('normalized.includes("pgrst202")');
    expect(db).toContain('return "小測驗資料庫版本尚未更新，請通知管理員完成系統更新。"');
    // #307：日曆載入失敗時顯示 db.js 整理過的中文訊息，不露出資料庫原文；
    // 回到同一個計畫的小測驗分頁時保留畫面，不重新載入。
    expect(admin).toContain("panel.innerHTML = `<div class=\"admin-user-directory__empty\">${adminQuizEscape(result.message || '無法載入小測驗日曆')}</div>`;");
    expect(admin).not.toContain('data-quiz-action="refresh-status"');
    expect(admin).not.toContain('重新載入狀態');
    expect(admin).toContain("if (!forceRefresh && root.dataset.quizPlanKey === planKey && root.childElementCount) return;");
    expect(css).not.toContain('.admin-daily-quiz-version--status-loading {');
    // 人工審核（data-quiz-action="review" / 審核通過按鈕）在 0196 拿掉了；
    // 逐題編輯 AI 題目的彈窗與輪播在 #308 跟著舊畫面一起移除。
    expect(admin).not.toContain('data-quiz-action="review"');
    expect(admin).not.toContain('data-quiz-action="toggle-edit"');
    expect(admin).not.toContain("admin-daily-quiz-editor-shell");
    expect(css).not.toContain("admin-daily-quiz-editor-shell");
    expect(css).not.toContain(".admin-daily-quiz-version--load-failed");
  });

  it("deploys the redesigned publish RPC under a unique, safely repeatable migration", () => {
    expect(publishFlow).toContain("DROP FUNCTION IF EXISTS public.publish_daily_quiz(UUID, DATE, UUID[], BOOLEAN, UUID)");
    expect(publishFlow).toContain("CREATE OR REPLACE FUNCTION public.publish_daily_quiz(");
    expect(publishFlow).toContain("p_scope_type TEXT");
    expect(publishFlow).toContain("p_variant TEXT DEFAULT NULL");
    expect(publishFlow).toContain("p_custom_questions JSONB DEFAULT NULL");
  });

  it("publishes groups and notifications with set-based statements", () => {
    expect(publishOptimization).toContain("FROM UNNEST(target_group_ids)");
    expect(publishOptimization).toContain("GET DIAGNOSTICS published_count = ROW_COUNT");
    expect(publishOptimization).toContain("INSERT INTO public.quiz_notifications");
    expect(publishOptimization).toContain("profile.small_group_id = publication.small_group_id");
    expect(publishOptimization).not.toContain("FOREACH target_group_id");
    expect(publishOptimization).toContain("NOTIFY pgrst, 'reload schema'");
    expect(db).toContain("JSON.stringify(errorDetails)");
  });

  it("supports scheduled auto-publish gated on already-ready questions, plus an optional answer deadline", () => {
    // 排程本身：新表 + 就緒檢查（跟 publish_daily_quiz 前半段同一套規則，
    // 這就是「先審核/確認過才能排程」的實際檢查點）+ 取消 + 每 5 分鐘掃描。
    expect(scheduledPublish).toContain("CREATE TABLE IF NOT EXISTS public.quiz_publication_schedules");
    expect(scheduledPublish).toContain("WHERE status = 'pending'");
    expect(scheduledPublish).toContain("CREATE OR REPLACE FUNCTION public.schedule_daily_quiz_publish(");
    expect(scheduledPublish).toContain("PERFORM public.validate_daily_quiz_questions(p_custom_questions, 2, 10);");
    expect(scheduledPublish).toContain("RAISE EXCEPTION 'quiz_not_ready'");
    expect(scheduledPublish).toContain("RAISE EXCEPTION 'quiz_schedule_publish_time_required'");
    expect(scheduledPublish).toContain("CREATE OR REPLACE FUNCTION public.cancel_daily_quiz_schedule(");
    expect(scheduledPublish).toContain("CREATE OR REPLACE FUNCTION public.run_daily_quiz_schedule_sweep()");
    expect(scheduledPublish).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(scheduledPublish).toContain("cron.schedule(\n    'daily-quiz-schedule-sweep',\n    '*/5 * * * *',");
    // 每支新函式都要在同一支 migration 裡 REVOKE ALL FROM PUBLIC（CLAUDE.md 規則）。
    for (const fn of ["schedule_daily_quiz_publish", "cancel_daily_quiz_schedule", "run_daily_quiz_schedule_sweep", "invoke_daily_quiz_schedule_sweep"]) {
      expect(scheduledPublish).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
    }
    // run_daily_quiz_schedule_sweep 刻意不進 nlc-data 的 allowlist——只有排程
    // Edge Function 用 service-role client 直接呼叫，前端拿不到。
    expect(edge).not.toContain('"run_daily_quiz_schedule_sweep"');
    // #308：排程發佈整個拿掉，allowlist 也移除。
    expect(edge).not.toContain('"schedule_daily_quiz_publish"');
    expect(edge).not.toContain('"cancel_daily_quiz_schedule"');

    // 作答截止：quiz_publications 新欄位 + 三支送出答案的 RPC 都要擋。
    expect(scheduledPublish).toContain("ADD COLUMN IF NOT EXISTS answer_close_at TIMESTAMPTZ");
    expect(scheduledPublish).toContain("p_answer_close_at TIMESTAMPTZ DEFAULT NULL");
    const answerWindowChecks = scheduledPublish.split("RAISE EXCEPTION 'quiz_answer_window_closed';").length - 1;
    expect(answerWindowChecks).toBe(3); // daily_quiz_submit_answer / daily_quiz_finalize_attempt / submit_daily_quiz
    expect(scheduledPublish).toContain("'answerCloseAt', publication_row.answer_close_at");
    expect(scheduledPublish).toContain("'pendingSchedule', pending_schedule");

    // Edge Function + config.toml：跟其他 cron job 同一套 verify_jwt=false + 共用密鑰模式。
    expect(scheduleSweep).toContain('Deno.env.get("DAILY_QUIZ_SCHEDULE_SWEEP_SECRET")');
    expect(scheduleSweep).toContain('req.headers.get("x-cron-secret")');
    expect(scheduleSweep).toContain('supabase.rpc("run_daily_quiz_schedule_sweep")');
    expect(configToml).toMatch(/\[functions\.daily-quiz-schedule-sweep\]\s*\nverify_jwt = false/);

    // 前端：排程發佈的 UI 與 db.js 方法在 #308 移除；會友端截止顯示保留。
    expect(db).not.toContain("scheduleDailyQuizPublish");
    expect(db).not.toContain("cancelDailyQuizSchedule");
    expect(admin).not.toContain("data-quiz-schedule-toggle");
    expect(plan).toContain("assignedQuiz.answerCloseAt");
    expect(plan).toContain('"作答已截止"');
  });

  it("no longer posts a home announcement when publishing (feature removed in 0196)", () => {
    // 0190 加的「同時發佈到首頁公告」、0195 的範圍綁定，整個在 0196 拿掉了——
    // 小測驗本身給每個收件人的站內提醒（quiz_notifications）完全不受影響，
    // 照常發送；被拿掉的只有 church_announcements 首頁公告這條路。
    expect(homeAnnouncement).toContain("post_announcement BOOLEAN NOT NULL DEFAULT FALSE");
    expect(db).not.toContain("postAnnouncement");
    expect(db).not.toContain("p_post_announcement");
    expect(admin).not.toContain("data-quiz-announcement-toggle");
    expect(admin).not.toContain("同時發佈到首頁公告");
    expect(admin).not.toContain("announcementToggle");
  });
});
