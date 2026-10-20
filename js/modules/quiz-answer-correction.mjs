// js/modules/quiz-answer-correction.mjs
// #590：小測驗發佈後更正某一題的正解（後台日曆用）。只支援是非／單選／多選，
// 跟伺服器 set_daily_quiz_answer_key 一樣；配對、排序題不給按鈕。
// 純函式：產生表單 HTML、從表單讀出新正解，DOM 綁定留在 admin.js。

import { formatResponseForDisplay } from "./quiz-question-types.mjs";

export const CORRECTABLE_QUESTION_TYPES = ["truefalse", "single", "multiple"];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

export function canCorrectAnswer(question) {
  return CORRECTABLE_QUESTION_TYPES.includes(question?.type);
}

// 已更正過的題目：「原本的正解：…」（originalAnswer 是 AI／出題者最早給的答案）
export function answerCorrectionNote(question, raw) {
  const corrected = raw?.answerCorrected;
  if (!corrected || typeof corrected !== "object") return "";
  const original = corrected.originalAnswer;
  return original === undefined || original === null
    ? "答案已更正"
    : `答案已更正（原本的正解：${formatResponseForDisplay(question.type, question.payload, original)}）`;
}

function choiceOptions(question) {
  if (question.type === "truefalse") return [{ value: "true", label: "對" }, { value: "false", label: "錯" }];
  return (question.payload?.options || []).map((label, index) => ({ value: String(index), label }));
}

function isCurrent(question, value) {
  const key = question.answerKey;
  if (question.type === "truefalse") return String(key) === value;
  if (question.type === "multiple") return Array.isArray(key) && key.map(String).includes(value);
  return key !== null && key !== undefined && String(key) === value;
}

export function renderAnswerCorrectionHtml(question) {
  const inputType = question.type === "multiple" ? "checkbox" : "radio";
  const name = `quiz-correct-${esc(question.id)}`;
  return `<form class="admin-quiz-custom-editor" data-quiz-correct-form="${esc(question.id)}">
    <p class="admin-daily-quiz-note">更正「${esc(question.payload?.stem || "")}」的正解。存好後，所有人這一題的對錯和總分會重新計算；不會通知組員，組員回顧時會看到「此題答案已更正」。</p>
    <fieldset>
      <legend>正解${question.type === "multiple" ? "（可複選）" : ""}</legend>
      ${choiceOptions(question).map(option => `<label class="admin-quiz-correct-option">
        <input type="${inputType}" name="${name}" value="${esc(option.value)}"${isCurrent(question, option.value) ? " checked" : ""}>
        ${esc(option.label)}
      </label>`).join("")}
    </fieldset>
    <label for="${name}-explanation">解說</label>
    <textarea id="${name}-explanation" class="form-control" rows="3" data-quiz-correct-explanation>${esc(question.explanation || "")}</textarea>
    <div class="admin-quiz-day-actions">
      <button type="submit" class="primary-btn" data-quiz-correct-save>更正並重新計分</button>
      <button type="button" class="secondary-btn" data-quiz-correct-cancel>取消</button>
    </div>
  </form>`;
}

// 從表單讀出新正解；沒選任何答案時回 null
export function readCorrectionAnswerKey(form, type) {
  const checked = Array.from(form.querySelectorAll("input:checked")).map(input => input.value);
  if (!checked.length) return null;
  if (type === "truefalse") return checked[0] === "true";
  if (type === "multiple") return checked.map(Number).sort((a, b) => a - b);
  return Number(checked[0]);
}
