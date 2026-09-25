import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0211_lightning_quiz_publish_workflow.sql");

function functionBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("AS $$", start));
  return sql.slice(start, end);
}

describe("快問快答 每題各自發布（0211）", () => {
  it("每支新建立或覆寫的函式都在同一支 migration 裡 REVOKE ALL FROM PUBLIC", () => {
    const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(match => match[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(sql, name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC;`));
    }
  });

  it("拿掉全站測試模式與版本號，同一天最多一個已發布活動", () => {
    expect(sql).toContain("DELETE FROM public.app_feature_settings WHERE key = 'lightning_quiz_test_mode'");
    expect(sql).toContain("DROP COLUMN IF EXISTS question_version");
    expect(sql).toContain("DROP COLUMN IF EXISTS content_version");
    expect(sql).toContain("DROP COLUMN IF EXISTS is_active");
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS lightning_quiz_questions_published_rise_date_idx[\s\S]*WHERE status = 'published'/);
    expect(sql).toContain("UNIQUE (question_id, user_id)");
  });

  it("鎖定＝非測試中，且時段已開始或已有人作答", () => {
    const locked = functionBody("_lightning_quiz_is_locked");
    expect(locked).toContain("q.status <> 'draft'");
    expect(locked).toContain("_lightning_quiz_window_started(q.rise_date, q.rise_time_start)");
    expect(locked).toContain("EXISTS (SELECT 1 FROM public.lightning_quiz_attempts");
  });

  it("會友端只看得到已發布的活動，沒有測試模式的特例", () => {
    for (const name of ["get_todays_lightning_quiz", "start_lightning_quiz_attempt", "submit_lightning_quiz_attempt"]) {
      const body = functionBody(name);
      expect(body, name).toContain("status = 'published'");
      expect(body, name).not.toContain("test_mode");
    }
  });

  it("我的測驗只回已發布且時段已結束的活動（時段內不回正解），下架的不列", () => {
    const history = functionBody("get_my_lightning_quiz_history");
    expect(history).toContain("q.status = 'published'");
    expect(history).toContain("_lightning_quiz_window_ended(q.rise_date, q.rise_time_end)");
    expect(history).toContain("a.user_id = actor_id");
    expect(history).toContain("'not_participated'");
    expect(history).toContain("'incomplete'");
  });

  it("新增一律是草稿；已鎖定的活動儲存時另存成新草稿，原活動不動", () => {
    const upsert = functionBody("admin_upsert_lightning_quiz_question");
    expect(upsert).not.toContain("p_is_active");
    expect(upsert).toContain("'draft', actor_id");
    expect(upsert).toContain("IF public._lightning_quiz_is_locked(p_id) THEN");
    expect(upsert).toContain("'draft', p_id, actor_id");
    expect(upsert).toContain("'forked', TRUE");
    expect(upsert).toContain("'unchanged', TRUE");
  });

  it("發布時自動下架同一天原本已發布的活動；鎖定後不能取消發布", () => {
    const status = functionBody("admin_set_lightning_quiz_status");
    expect(status).toMatch(/SET status = 'archived'\s+WHERE rise_date = q\.rise_date AND status = 'published' AND id <> q\.id/);
    expect(status).toMatch(/p_status = 'draft' AND q\.status = 'published'[\s\S]*_lightning_quiz_is_locked\(q\.id\)[\s\S]*lightning_quiz_locked/);
    expect(status).toContain("lightning_quiz_invalid_status_transition");
  });

  it("清除作答不動活動狀態（不能拿清除來繞過鎖定）", () => {
    const clear = functionBody("admin_clear_lightning_quiz_attempts");
    expect(clear).toContain("DELETE FROM public.lightning_quiz_attempts WHERE question_id = p_question_id");
    expect(clear).not.toMatch(/UPDATE public\.lightning_quiz_questions/);
  });
});

describe("前端與 nlc-data 接線", () => {
  it("nlc-data 白名單包含新的 RPC", () => {
    const edge = read("supabase/functions/nlc-data/index.ts");
    expect(edge).toContain('"get_my_lightning_quiz_history"');
    expect(edge).toContain('"admin_set_lightning_quiz_status"');
  });

  it("測試模式開關已從前端完全拿掉", () => {
    for (const path of ["js/db.js", "js/modules/admin.js", "index.html"]) {
      expect(read(path), path).not.toContain("lightning_quiz_test_mode");
      expect(read(path), path).not.toContain("lightning-quiz-test-mode");
    }
  });

  it("我的測驗分成大測驗／小測驗／快問快答三個分頁，開啟與重新整理時都會載入", () => {
    const profile = read("js/modules/profile.js");
    const html = read("index.html");
    for (const tab of ["exam", "daily", "lightning"]) {
      expect(html).toContain(`data-profile-exams-tab="${tab}"`);
      expect(html).toContain(`data-profile-exams-panel="${tab}"`);
    }
    expect(html).toContain('id="profile-exams-detail"');
    expect(profile).toMatch(/function refreshMyQuizzes\(\) \{[\s\S]*renderMyExamPapers\(\);[\s\S]*renderMyDailyQuizResults\(\);[\s\S]*renderMyLightningQuizResults\(\);/);
    expect(profile.match(/refreshMyQuizzes\(\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(profile).toContain("db.getMyLightningQuizHistory(from, to)");
  });
});

describe("我的測驗檢討與首頁撤掉（0213）", () => {
  const sql0213 = read("supabase/migrations/0213_my_quiz_review.sql");
  const body = name => {
    const start = sql0213.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    return sql0213.slice(start, sql0213.indexOf("$;", start));
  };

  it("每支函式都 REVOKE ALL FROM PUBLIC", () => {
    const names = [...sql0213.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(match => match[1]);
    expect(names).toEqual(["get_todays_lightning_quiz", "daily_quiz_get_my_results"]);
    for (const name of names) {
      expect(sql0213, name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC`));
    }
  });

  it("活動一結束首頁就撤掉，並告訴前端還剩幾秒", () => {
    const todays = body("get_todays_lightning_quiz");
    expect(todays).toMatch(/IF now_time > q\.rise_time_end THEN\s+RETURN jsonb_build_object\('status', 'hidden'\);/);
    expect(todays).not.toContain("canSubmit");
    expect(todays.match(/'secondsUntilEnd', seconds_left/g)).toHaveLength(3);
  });

  it("小測驗逐題檢討只回自己已送出的作答", () => {
    const results = body("daily_quiz_get_my_results");
    expect(results).toContain("qa.user_id = actor_id");
    expect(results).toContain("qa.status = 'submitted'");
    expect(results).toContain("public.quiz_questions_for_member(qa.questions, TRUE)");
  });

  it("首頁卡片在活動結束時自己重新整理；大測驗與新的檢討畫面共用同一份連線程式", () => {
    const lightning = read("js/modules/lightning-quiz.mjs");
    expect(lightning).toContain("scheduleHomeEndRefresh(data.secondsUntilEnd)");
    expect(lightning).not.toContain("canSubmit");
    const exam = read("js/modules/exam.js");
    expect(exam).toContain('import { paintMatchReviewLines, drawMatchReviewLines } from "./quiz-review.mjs";');
    expect(exam).not.toContain("function _paintResultMatchLines");
    expect(read("js/modules/plan.js")).toContain("renderDailyQuizReviewHtml(attempt, questions)");
  });
});
