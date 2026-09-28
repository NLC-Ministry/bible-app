// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gradeDailyQuizTrial, mountDailyQuizTrial } from "../js/modules/daily-quiz-trial.mjs";
import { normalizeQuestion } from "../js/modules/quiz-question-types.mjs";

// #307（小測驗 Q2，屬於 #305）：後台 7 天日曆、每天的設定、前端試作。
// jsdom 環境的 URL 不是 Node 的 URL，readFileSync 認不得，所以用相對於專案根目錄的路徑
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20260928085701_daily_quiz_calendar.sql");
const admin = read("js/modules/admin.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");
const trialSource = read("js/modules/daily-quiz-trial.mjs");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

const AI_QUESTIONS = [
  { id: "q1", question: "以色列人在曠野吃什麼？", options: ["嗎哪", "餅", "魚", "蜂蜜"], correctIndex: 0, explanation: "出16", verseRef: "出16:31" },
  { id: "q2", question: "誰帶領以色列人出埃及？", options: ["約瑟", "摩西", "大衛", "但以理"], correctIndex: 1, explanation: "出3", verseRef: "出3:10" }
];

describe("trial runs entirely in the browser (#307)", () => {
  it("grades like the server: correct count out of total", () => {
    const questions = AI_QUESTIONS.map(normalizeQuestion);
    const result = gradeDailyQuizTrial(questions, new Map([["q1", 0], ["q2", 0]]));
    expect(result.score).toBe(1);
    expect(result.total).toBe(2);
    expect(result.answers.map(answer => answer.correct)).toEqual([true, false]);
  });

  it("never calls any quiz RPC", () => {
    expect(trialSource).not.toMatch(/\bdb\./);
    expect(trialSource).not.toContain("submitDailyQuizAnswer");
    expect(trialSource).not.toContain("finalizeDailyQuizAttempt");
  });

  it("renders the questions, blocks incomplete submits, shows the result and 重新試作", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.showToast = vi.fn();
    mountDailyQuizTrial(host, AI_QUESTIONS);
    expect(host.querySelectorAll("fieldset[data-question-id]")).toHaveLength(2);
    expect(host.textContent).toContain("不會記錄，也不算進統計");

    const form = host.querySelector("[data-trial-form]");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(window.showToast).toHaveBeenCalledWith("請完成全部 2 題後再送出");

    host.querySelector('fieldset[data-question-id="q1"] input[value="0"]').checked = true;
    host.querySelector('fieldset[data-question-id="q2"] input[value="1"]').checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(host.textContent).toContain("這是試作，不列入成績");
    expect(host.querySelector(".daily-quiz-score").textContent).toBe("2／2");

    host.querySelector("[data-trial-again]").click();
    expect(host.querySelector("[data-trial-form]")).not.toBeNull();
    host.remove();
  });

  it("says so when a day has no questions yet", () => {
    const host = document.createElement("div");
    mountDailyQuizTrial(host, []);
    expect(host.textContent).toContain("還沒有題目可以試作");
  });
});

describe("migration: calendar and per-day settings (#307)", () => {
  it("everything is admin-only", () => {
    for (const name of ["get_daily_quiz_calendar", "set_daily_quiz_day_skip", "set_daily_quiz_day_custom", "swap_daily_quiz_version"]) {
      expect(fnBody(name), name).toContain("public._daily_quiz_require_admin(p_actor_id)");
    }
    expect(fnBody("_daily_quiz_require_admin")).toContain("RAISE EXCEPTION 'quiz_publish_admin_only';");
  });

  it("the calendar derives each day's status and flags missing quizzes", () => {
    const cal = fnBody("get_daily_quiz_calendar");
    for (const status of ["'open'", "'ended'", "'skipped'", "'not_published'", "'scheduled'", "'generating'", "'failed'", "'waiting'"]) {
      expect(cal).toContain(status);
    }
    expect(cal).toContain("(status IN ('waiting', 'generating') AND (d = today OR (d = today + 1 AND EXTRACT(HOUR FROM now_taipei) >= 12)))");
    expect(cal).toContain("a.status = 'submitted'");
  });

  it("published or past days can't be changed", () => {
    for (const name of ["set_daily_quiz_day_skip", "set_daily_quiz_day_custom", "swap_daily_quiz_version"]) {
      const body = fnBody(name);
      expect(body, name).toContain("RAISE EXCEPTION 'quiz_date_passed'");
      expect(body, name).toContain("IF public._daily_quiz_day_published(p_global_plan_id, p_quiz_date) THEN RAISE EXCEPTION 'quiz_already_published'");
    }
  });

  it("custom questions are validated, stored as version C, and the old unpublished custom row is removed", () => {
    const custom = fnBody("set_daily_quiz_day_custom");
    expect(custom).toContain("PERFORM public.validate_daily_quiz_questions(p_questions, 2, 10);");
    expect(custom).toContain("p_global_plan_id, p_quiz_date, 'C',");
    expect(custom).toContain("DELETE FROM public.daily_quizzes q WHERE q.id = old_custom");
  });

  it("換一版 checks it can reach the AI before deleting the unpublished A version", () => {
    const swap = fnBody("swap_daily_quiz_version");
    expect(swap.indexOf("quiz_generation_secret_missing")).toBeLessThan(swap.indexOf("DELETE FROM public.daily_quizzes"));
    expect(swap).toContain("AND NOT EXISTS (SELECT 1 FROM public.quiz_publications pub WHERE pub.quiz_id = q.id);");
    expect(swap).toContain("'variants', jsonb_build_array('A'),");
  });

  it("auto publish sends the custom questions on custom days", () => {
    const auto = fnBody("run_daily_quiz_auto_publish");
    expect(auto).toContain("p_variant := CASE WHEN custom_questions IS NULL THEN 'A' END,");
    expect(auto).toContain("p_custom_questions := custom_questions,");
  });
});

describe("days outside the plan (#307 補充)", () => {
  const outside = read("supabase/migrations/20260928094106_daily_quiz_calendar_outside_plan.sql");

  it("the calendar marks days outside the plan's dates instead of 等待出題", () => {
    expect(outside).toContain("WHEN plan_start IS NOT NULL AND (d < plan_start OR d > plan_end) THEN 'outside_plan'");
    expect(outside.indexOf("'outside_plan'")).toBeLessThan(outside.indexOf("WHEN d < today THEN 'not_published'"));
    expect(outside).toContain("GRANT EXECUTE ON FUNCTION public.get_daily_quiz_calendar(uuid, date, integer, uuid) TO authenticated, service_role;");
  });

  it("the admin UI labels them and offers no actions", () => {
    expect(admin).toContain("outside_plan: { label: '不在計畫期間', kind: 'neutral' }");
    expect(admin).toContain("!['open', 'ended', 'outside_plan'].includes(day.status)");
  });
});

describe("admin UI (#307)", () => {
  const uiWithComments = admin.slice(admin.indexOf("// ── 小測驗後台（#307）"), admin.indexOf("async function loadActiveAdminPlanSubtab("));
  // 說明註解本身會提到「版本 A／B」「審核」「發佈範圍」，檢查畫面時先拿掉註解
  const ui = uiWithComments.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");

  it("three tabs: 日曆／規則設定／統計; leaders only get 統計", () => {
    expect(ui).toContain("{ key: 'calendar', label: '日曆' }");
    expect(ui).toContain("{ key: 'rules', label: '規則設定' }");
    expect(ui).toContain("{ key: 'stats', label: '統計' }");
    expect(ui).toContain(": 'stats';");
  });

  it("no versions A/B, review or scope pickers on the new screen", () => {
    for (const gone of ["版本 A", "版本 B", "審核", "發佈範圍", "renderAdminQuizPublishPanel", "renderAdminQuizReviewCards"]) {
      expect(ui, gone).not.toContain(gone);
    }
  });

  it("each day offers 試作／換一版／自訂題目／這天不發", () => {
    for (const act of ['data-quiz-day-act="trial"', 'data-quiz-day-act="swap"', 'data-quiz-day-act="custom"', 'data-quiz-day-act="skip"', 'data-quiz-day-act="use-ai"', 'data-quiz-day-act="unskip"']) {
      expect(ui, act).toContain(act);
    }
    expect(ui).toContain("mountDailyQuizTrial(work, day.questions");
    expect(ui).toContain("parseQuizImportText(textarea.value)");
  });

  it("warns on the calendar when auto publish is off", () => {
    expect(ui).toContain("每天自動發佈還沒開啟");
  });

  it("db.js and nlc-data expose the calendar RPCs", () => {
    for (const rpc of ["get_daily_quiz_calendar", "set_daily_quiz_day_skip", "set_daily_quiz_day_custom", "swap_daily_quiz_version"]) {
      expect(db, rpc).toContain(`this._callQuizRpc("${rpc}"`);
      expect(nlcData, rpc).toContain(`"${rpc}"`);
    }
  });
});
