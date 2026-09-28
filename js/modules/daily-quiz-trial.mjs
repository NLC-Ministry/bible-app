// js/modules/daily-quiz-trial.mjs
//
// 小測驗「試作」（#307）：管理員在後台用會友看到的作答畫面實際做一次。
// 整個流程在瀏覽器裡跑完——不呼叫任何作答 RPC、不寫入 quiz_attempts，
// 所以不會算進統計，別人也看不到（跟雲柱測驗的試作同一個原則）。
// 題目格式、作答元件、對錯判斷、結果頁都跟會友端共用。

import {
  bindQuestionFieldset,
  isAnswerCorrect,
  isResponseComplete,
  normalizeQuestion,
  readResponseFromFieldset,
  renderQuestionFieldsetHtml
} from "./quiz-question-types.mjs";
import { drawMatchReviewLines, renderDailyQuizReviewHtml } from "./quiz-review.mjs";

// 送出後的成績：跟伺服器端 daily_quiz_finalize_attempt 一樣是「答對幾題／共幾題」
export function gradeDailyQuizTrial(questions, responses) {
  const answers = questions.map(question => {
    const response = responses.get(question.id) ?? null;
    return {
      questionId: question.id,
      response,
      correct: isAnswerCorrect(question.type, question.answerKey, response),
      timeSpentSeconds: null
    };
  });
  return { answers, score: answers.filter(answer => answer.correct).length, total: questions.length };
}

export function mountDailyQuizTrial(host, rawQuestions, { onClose } = {}) {
  if (!host) return;
  const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map(normalizeQuestion);
  if (!questions.length) {
    host.innerHTML = '<p class="admin-daily-quiz-empty">這一天還沒有題目可以試作。</p>';
    return;
  }

  const renderForm = () => {
    host.innerHTML = `
      <div class="daily-quiz-heading">
        <div><p class="daily-quiz-eyebrow">試作</p><h3>${questions.length} 題</h3></div>
        <span class="daily-quiz-status">不會記錄，也不算進統計</span>
      </div>
      <form class="daily-quiz-form" data-trial-form>
        ${questions.map((question, index) => renderQuestionFieldsetHtml(question, index)).join("")}
        <div class="admin-quiz-trial-actions">
          <button type="submit" class="primary-btn">送出答案</button>
          ${onClose ? '<button type="button" class="secondary-btn" data-trial-close>結束試作</button>' : ""}
        </div>
      </form>`;
    const form = host.querySelector("[data-trial-form]");
    const fieldsets = new Map(Array.from(form.querySelectorAll("[data-question-id]")).map(el => [el.getAttribute("data-question-id"), el]));
    const responses = new Map();
    questions.forEach(question => {
      bindQuestionFieldset(fieldsets.get(question.id), question.type, response => responses.set(question.id, response));
    });
    form.querySelector("[data-trial-close]")?.addEventListener("click", () => onClose?.());
    form.addEventListener("submit", event => {
      event.preventDefault();
      questions.forEach(question => responses.set(question.id, readResponseFromFieldset(fieldsets.get(question.id), question.type)));
      const incomplete = questions.some(question => !isResponseComplete(question.type, responses.get(question.id), question.payload));
      if (incomplete) {
        if (typeof window.showToast === "function") window.showToast(`請完成全部 ${questions.length} 題後再送出`);
        return;
      }
      renderResult(gradeDailyQuizTrial(questions, responses));
    });
  };

  const renderResult = attempt => {
    host.innerHTML = `
      <div class="daily-quiz-heading">
        <div><p class="daily-quiz-eyebrow">試作結果</p><h3>這是試作，不列入成績</h3></div>
        <span class="daily-quiz-score">${attempt.score}／${attempt.total}</span>
      </div>
      ${renderDailyQuizReviewHtml(attempt, questions)}
      <div class="admin-quiz-trial-actions">
        <button type="button" class="primary-btn" data-trial-again>重新試作</button>
        ${onClose ? '<button type="button" class="secondary-btn" data-trial-close>結束試作</button>' : ""}
      </div>`;
    drawMatchReviewLines(host);
    host.querySelector("[data-trial-again]")?.addEventListener("click", renderForm);
    host.querySelector("[data-trial-close]")?.addEventListener("click", () => onClose?.());
  };

  renderForm();
}
