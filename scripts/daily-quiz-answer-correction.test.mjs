// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";
import { normalizeQuestion } from "../js/modules/quiz-question-types.mjs";
import { renderQuizEvidenceHtml } from "../js/modules/quiz-evidence.mjs";
import { renderDailyQuizReviewHtml } from "../js/modules/quiz-review.mjs";
import {
  answerCorrectionNote, canCorrectAnswer, readCorrectionAnswerKey, renderAnswerCorrectionHtml
} from "../js/modules/quiz-answer-correction.mjs";

// #590：小測驗發佈後更正某一題的正解，所有作答重算。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = currentMigrationSql("20261019033742_daily_quiz_answer_correction.sql");
const fn = name => latestFunctionDefinition(name).text;
const SIGNATURE = "set_daily_quiz_answer_key(UUID, DATE, TEXT, JSONB, TEXT, UUID)";

const AI_QUESTION = {
  id: "q2", question: "要在什麼時候之前？", options: ["當天傍晚前", "第二天早上", "三天內", "七天內"],
  correctIndex: 1, explanation: "舊解說", verseRef: "利19:6",
  evidence: [0, 1, 2, 3].map(() => ({ verseRef: "利19:6", quote: "要在獻的那一天", reason: "r" }))
};

describe("migration: set_daily_quiz_answer_key (#590)", () => {
  const body = fn("set_daily_quiz_answer_key");

  it("is admin-only with explicit grants", () => {
    expect(body).toContain("public._daily_quiz_require_admin(p_actor_id)");
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO authenticated, service_role;`);
  });

  it("only works on published days and refuses to guess between two versions", () => {
    expect(body).toContain("RAISE EXCEPTION 'quiz_not_published'");
    expect(body).toContain("RAISE EXCEPTION 'quiz_multiple_versions'");
    expect(body).not.toContain("quiz_date_passed");
  });

  it("only touches the answer key and explanation of one question", () => {
    expect(body).toContain("jsonb_set(questions, ARRAY[question_pos::TEXT], new_question)");
    expect(body).toContain("'answerCorrected'");
    expect(body).toContain("RAISE EXCEPTION 'quiz_answer_type_not_supported'");
    expect(body).not.toMatch(/'options'\s*,\s*p_/);
  });

  it("re-judges every attempt with the shared grading formula and re-scores submitted ones", () => {
    expect(body).toContain("public._quiz_answer_is_correct(question_type, p_answer_key, entry->'response')");
    expect(body).toMatch(/WHEN a\.status = 'submitted'/);
    expect(body).toContain("WHERE pub.quiz_id = quiz_row.id");
  });

  it("opens the approval lock only for this RPC, only for questions", () => {
    const lock = fn("lock_approved_daily_quiz_content");
    expect(lock).toContain("current_setting('app.quiz_answer_correction', TRUE)");
    expect(lock).toMatch(/NEW\.review_status IS DISTINCT FROM OLD\.review_status\n/);
    expect(body).toContain("set_config('app.quiz_answer_correction', 'on', TRUE)");
    expect(body).toContain("set_config('app.quiz_answer_correction', 'off', TRUE)");
  });

  it("members get answerCorrected only together with the answers", () => {
    const member = fn("quiz_questions_for_member");
    expect(member.match(/'answerCorrected', question \? 'answerCorrected'/g)).toHaveLength(2);
    expect(member).not.toContain("'evidence'");
  });

  it("is reachable through nlc-data, audited, and wired into db.js", () => {
    expect(read("supabase/functions/nlc-data/index.ts")).toContain('"set_daily_quiz_answer_key"');
    expect(read("supabase/functions/nlc-data/admin-audit.ts")).toContain('"set_daily_quiz_answer_key"');
    const db = read("js/db.js");
    expect(db).toContain('_callQuizRpc("set_daily_quiz_answer_key"');
    expect(db).toContain("quiz_answer_type_not_supported:");
  });
});

describe("admin correction form (#590)", () => {
  it("offers correction for truefalse/single/multiple only", () => {
    expect(canCorrectAnswer(normalizeQuestion(AI_QUESTION))).toBe(true);
    expect(canCorrectAnswer({ type: "matching" })).toBe(false);
    expect(canCorrectAnswer({ type: "ordering" })).toBe(false);
  });

  it("pre-selects the current answer and reads back the new one", () => {
    const question = normalizeQuestion(AI_QUESTION);
    const host = document.createElement("div");
    host.innerHTML = renderAnswerCorrectionHtml(question);
    const form = host.querySelector("form");
    expect(form.querySelector("input:checked").value).toBe("1");
    form.querySelector('input[value="0"]').checked = true;
    expect(readCorrectionAnswerKey(form, "single")).toBe(0);
    expect(form.querySelector("textarea").value).toBe("舊解說");
  });

  it("reads truefalse as boolean and multiple as a sorted index list", () => {
    const host = document.createElement("div");
    host.innerHTML = renderAnswerCorrectionHtml({ id: "t", type: "truefalse", payload: { stem: "s" }, answerKey: true });
    host.querySelector('input[value="false"]').checked = true;
    expect(readCorrectionAnswerKey(host.querySelector("form"), "truefalse")).toBe(false);

    host.innerHTML = renderAnswerCorrectionHtml({ id: "m", type: "multiple", payload: { stem: "s", options: ["a", "b", "c"] }, answerKey: [1] });
    const form = host.querySelector("form");
    expect(form.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    form.querySelector('input[value="2"]').checked = true;
    form.querySelector('input[value="0"]').checked = true;
    expect(readCorrectionAnswerKey(form, "multiple")).toEqual([0, 1, 2]);
    form.querySelectorAll("input").forEach(input => { input.checked = false; });
    expect(readCorrectionAnswerKey(form, "multiple")).toBeNull();
  });

  it("escapes question text", () => {
    const html = renderAnswerCorrectionHtml({ id: "x", type: "single", payload: { stem: "<img src=x onerror=1>", options: ["<b>"] }, answerKey: 0 });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });

  it("shows the original answer and hides AI evidence once corrected", () => {
    const corrected = { ...AI_QUESTION, correctIndex: 0, answerCorrected: { at: "2026-10-19T10:00:00Z", originalAnswer: 1 } };
    expect(answerCorrectionNote(normalizeQuestion(corrected), corrected)).toBe("答案已更正（原本的正解：第二天早上）");
    expect(answerCorrectionNote(normalizeQuestion(AI_QUESTION), AI_QUESTION)).toBe("");
    expect(renderQuizEvidenceHtml(AI_QUESTION)).toContain("經文舉證");
    expect(renderQuizEvidenceHtml(corrected)).toBe("");
  });

  it("admin calendar wires the button, the form, and earlier weeks", () => {
    const admin = read("js/modules/admin.js");
    expect(admin).toContain("renderAdminQuizDayQuestionsHtml(day.questions, { correctable: published })");
    expect(admin).toContain("db.setDailyQuizAnswerKey(state.adminManagementPlan, day.date, question.id, answerKey, explanation)");
    expect(admin).toContain("data-quiz-week=\"-1\"");
    expect(admin).toContain("root.dataset.quizFrom || null");
  });
});

describe("member review marks corrected questions (#590)", () => {
  it("normalizeQuestion keeps the flag for both formats", () => {
    expect(normalizeQuestion({ ...AI_QUESTION, answerCorrected: true }).answerCorrected).toBe(true);
    expect(normalizeQuestion(AI_QUESTION)).not.toHaveProperty("answerCorrected");
    expect(normalizeQuestion({ ...AI_QUESTION, answerCorrected: false })).not.toHaveProperty("answerCorrected");
    expect(normalizeQuestion({ id: "t", type: "truefalse", payload: { stem: "s" }, answerKey: true, answerCorrected: true }).answerCorrected).toBe(true);
  });

  it("shows 此題答案已更正 only on the corrected question", () => {
    const questions = [
      normalizeQuestion({ ...AI_QUESTION, id: "q1", answerCorrected: false }),
      normalizeQuestion({ ...AI_QUESTION, correctIndex: 0, answerCorrected: true })
    ];
    const attempt = { answers: [
      { questionId: "q1", response: 1, correct: true },
      { questionId: "q2", response: 0, correct: true }
    ] };
    const host = document.createElement("div");
    host.innerHTML = renderDailyQuizReviewHtml(attempt, questions);
    const rows = host.querySelectorAll(".exam-result__row");
    expect(rows[0].textContent).not.toContain("此題答案已更正");
    expect(rows[1].textContent).toContain("此題答案已更正");
  });
});
