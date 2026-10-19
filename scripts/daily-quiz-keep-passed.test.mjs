import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";
import {
  combineWithKept, keptQuestionsPrompt, QUIZ_QUESTION_COUNT, sanitizeKeptQuestions
} from "../supabase/functions/generate-daily-quizzes/quiz-quality.ts";
import { describeQuizGenerationError } from "../js/modules/quiz-generation-status.mjs";

// #589：AI 出題失敗時保留已通過審核的題目，下次只補不足的題數。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = currentMigrationSql("20261019035001_daily_quiz_keep_passed_questions.sql");
const fn = name => latestFunctionDefinition(name).text;
const edge = read("supabase/functions/generate-daily-quizzes/index.ts");
const admin = read("js/modules/admin.js");

const question = (id, stem = `題目${id}`) => ({
  id, question: stem, options: ["甲", "乙", "丙", "丁"], correctIndex: 0, explanation: "解說", verseRef: "創世記 12:4",
  evidence: [0, 1, 2, 3].map(() => ({ verseRef: "創世記 12:4", quote: "亞伯蘭就照著", reason: "r" }))
});

describe("combining kept and newly accepted questions (#589)", () => {
  it("succeeds once kept + accepted reach five, renumbering q1…q5 with kept first", () => {
    const merged = combineWithKept([question("k1", "舊1"), question("k2", "舊2")], [question("q1", "新1"), question("q2", "新2"), question("q3", "新3")]);
    expect(merged.questions.map(item => item.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(merged.questions.map(item => item.question)).toEqual(["舊1", "舊2", "新1", "新2", "新3"]);
    expect(merged.kept).toEqual([]);
  });

  it("keeps everything that passed (renumbered k1…) when still short", () => {
    const merged = combineWithKept([question("k1", "舊1")], [question("q1", "新1"), question("q2", "新2")]);
    expect(merged.questions).toBeNull();
    expect(merged.kept.map(item => [item.id, item.question])).toEqual([["k1", "舊1"], ["k2", "新1"], ["k3", "新2"]]);
  });

  it("never stores more than five", () => {
    const merged = combineWithKept([question("k1"), question("k2"), question("k3")], [question("a"), question("b"), question("c")]);
    expect(merged.questions).toHaveLength(QUIZ_QUESTION_COUNT);
  });

  it("drops malformed kept rows and caps them below five", () => {
    expect(sanitizeKeptQuestions(null)).toEqual([]);
    expect(sanitizeKeptQuestions([{ id: "x" }, question("k1"), { ...question("k2"), correctIndex: 7 }])).toHaveLength(1);
    expect(sanitizeKeptQuestions([1, 2, 3, 4, 5, 6].map(i => question(`k${i}`)))).toHaveLength(QUIZ_QUESTION_COUNT - 1);
  });

  it("tells the generator not to repeat kept questions", () => {
    expect(keptQuestionsPrompt([])).toBe("");
    expect(keptQuestionsPrompt([question("k1", "亞伯蘭幾歲出哈蘭？")])).toContain("1. 亞伯蘭幾歲出哈蘭？");
  });
});

describe("generate-daily-quizzes Edge Function (#589)", () => {
  it("loads kept questions, only asks for the missing ones, and passes kept on failure", () => {
    expect(edge).toContain('.select("kept_questions").eq("id", quizId)');
    expect(edge).toContain("const needed = QUIZ_QUESTION_COUNT - kept.length;");
    expect(edge).toContain("buildVerseIndex(chapters), needed)");
    expect(edge).toContain("keptQuestionsPrompt(kept)");
    expect(edge).toContain("throw Object.assign(error, { kept: merged.kept });");
    expect(edge).toContain("p_kept_questions: keptQuestions");
  });
});

describe("migration (#589)", () => {
  it("adds the column and replaces the two-argument fail function", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS kept_questions JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.fail_daily_quiz_generation(UUID, TEXT);");
    expect(fn("fail_daily_quiz_generation")).toContain("kept_questions = COALESCE(p_kept_questions, kept_questions)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.fail_daily_quiz_generation(UUID, TEXT, JSONB) TO service_role;");
  });

  it("clears on success, keeps on retry and on 請 AI 出題, starts fresh on 換一版", () => {
    expect(fn("complete_daily_quiz_generation")).toContain("kept_questions = '[]'::jsonb");
    expect(fn("reserve_daily_quiz_regeneration")).toContain("kept_questions = CASE WHEN quiz.generation_status = 'ready' THEN '[]'::jsonb ELSE quiz.kept_questions END");
    const swap = fn("swap_daily_quiz_version");
    expect(swap).toContain("AND q.generation_status <> 'ready'");
    expect(swap).toContain("COALESCE(kept, '[]'::jsonb)");
  });

  it("calendar exposes keptQuestions; removing one is admin-only", () => {
    expect(fn("get_daily_quiz_calendar")).toContain("'keptQuestions'");
    const remove = fn("remove_daily_quiz_kept_question");
    expect(remove).toContain("public._daily_quiz_require_admin(p_actor_id)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.remove_daily_quiz_kept_question(UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;");
    expect(read("supabase/functions/nlc-data/index.ts")).toContain('"remove_daily_quiz_kept_question"');
    expect(read("supabase/functions/nlc-data/admin-audit.ts")).toContain('"remove_daily_quiz_kept_question"');
  });
});

describe("admin calendar (#589)", () => {
  it("explains how many passed and how many are still needed", () => {
    const info = describeQuizGenerationError("quality:insufficient — 2/8 passed; kept 3/5; review_disagrees×4");
    expect(info.title).toContain("累計已通過 3／5 題");
    expect(info.hint).toContain("只要補 2 題");
    // 舊格式（沒有 kept）照舊
    expect(describeQuizGenerationError("quality:insufficient — 3/8 passed; review_disagrees×4").title).toContain("只有 3 題通過");
  });

  it("lists kept questions with 不要這題 and wires the removal", () => {
    expect(admin).toContain("renderAdminQuizKeptQuestionsHtml(day, editable)");
    expect(admin).toContain("data-quiz-kept-remove=");
    expect(admin).toContain("db.removeDailyQuizKeptQuestion(plan, day.date, button.dataset.quizKeptRemove)");
  });
});
