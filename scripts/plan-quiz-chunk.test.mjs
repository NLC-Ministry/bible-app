import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// #370 第 4 批：今日小測驗（plan-quiz）拆成 lazy chunk，只有真的用到的會友才下載。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const app = read("js/app.js");
const plan = read("js/modules/plan.js");
const planQuiz = read("js/modules/plan-quiz.js");

const bodyOf = (source, signature) => {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n}\n", start));
};

describe("plan-quiz lazy chunk", () => {
  it("app.js 以字面值 import() 登記，並在載入 plan.js 時把載入函式交給它", () => {
    expect(app).toContain("'plan-quiz': () => import('./modules/plan-quiz.js'),");
    const load = bodyOf(app, "async function loadModule(name) {");
    expect(load).toContain("if (name === 'plan' && typeof mod.registerPlanChunkLoader === 'function') {");
    expect(load).toContain("mod.registerPlanChunkLoader(chunk => loadModule(chunk));");
  });

  it("plan.js 不靜態 import chunk，只載入登記過的名稱", () => {
    expect(plan).not.toMatch(/from\s+["']\.\/plan-quiz\.js["']/);
    expect(plan).not.toContain("quiz-question-types.mjs");
    expect(plan).not.toContain("quiz-review.mjs");
    expect(plan).toContain('const PLAN_CHUNKS = new Set(["plan-quiz"]);');
    expect(bodyOf(plan, "function loadPlanChunk(name) {")).toContain("if (!PLAN_CHUNKS.has(name))");
  });

  it("小測驗：plan.js 先確認開關、日期與「今天有指派給我」，才下載 plan-quiz", () => {
    const gate = bodyOf(plan, "async function renderDailyQuizSection(plan, selectedDay, trackerRequestId, options = {}) {");
    const order = [
      "await isDailyQuizFeatureEnabled()",
      "quizDate !== getDailyQuizTaiwanToday()",
      "await db.getDailyQuizDashboard(plan, quizDate)",
      "if (!context.myQuiz && !hasMakeup) {",
      'await loadPlanChunk("plan-quiz")',
      "quizView.showDailyQuiz(section, content, context, plan, quizDate, options);"
    ].map(needle => gate.indexOf(needle));
    order.forEach(index => expect(index).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 下載失敗不能留下未處理的 rejection；下載完若已換日／換計畫就不畫。
    expect(gate).toContain("} catch (e) {");
    expect(gate.slice(gate.indexOf('loadPlanChunk("plan-quiz")'))).toContain("if (isStale()) return;");
    expect(plan).toContain("export { renderDailyQuizSection };");
    expect(plan).toContain("export function getLastTrackerRequestId() {");
  });

  it("plan-quiz.js 有作答畫面，送出後用最新的 tracker 序號重畫", () => {
    expect(planQuiz).toContain('import { getLastTrackerRequestId, renderDailyQuizSection } from "./plan.js";');
    expect(planQuiz).toMatch(/^export function showDailyQuiz\(section, content, context, plan, quizDate, options = \{\}\) \{/m);
    expect(planQuiz).toContain("void renderDailyQuizSection(plan, { isoDate: sectionDate }, getLastTrackerRequestId(), { open: true, openPublicationId: quiz.publicationId });");
    expect(planQuiz).not.toMatch(/\blastTrackerRequestId\b/);
    expect(planQuiz).toMatch(/^function bindDailyQuizAnswering\(/m);
  });
});
