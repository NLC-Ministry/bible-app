// js/modules/lightning-quiz-answer-correction.mjs
// #616：雲柱題目開始後更正正解／詳解（後台題目面板用）。六種題型都可以更正，
// 伺服器 admin_set_lightning_quiz_answer_key 會再檢查一次形狀並重判已送出的作答。
// 純函式：產生表單 HTML、從表單讀出新正解、組出結果訊息；DOM 綁定留在 admin.js。
// 小測驗的更正（#590）是 quiz-answer-correction.mjs，只有是非／單選／多選。

import { formatResponseForDisplay, MENU_MAX_QUANTITY } from "./quiz-question-types.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

const list = value => (Array.isArray(value) ? value : []);

// 後台清單的題目（originalAnswerKey 有值＝正解更正過）：「答案已更正（原本的正解：…）」
export function lightningAnswerCorrectionNote(question) {
  if (!question?.answerCorrectedAt) return "";
  const original = question.originalAnswerKey;
  return original === undefined || original === null
    ? "答案已更正"
    : `答案已更正（原本的正解：${formatResponseForDisplay(question.questionType, question.payload || {}, original)}）`;
}

function choiceFieldsHtml(question) {
  const { questionType: type, payload = {}, answerKey } = question;
  const multiple = type === "multiple";
  const choices = type === "truefalse"
    ? [{ value: "true", label: "對", checked: answerKey === true }, { value: "false", label: "錯", checked: answerKey === false }]
    : list(payload.options).map((label, index) => ({
      value: String(index),
      label,
      checked: multiple ? list(answerKey).map(String).includes(String(index)) : String(answerKey) === String(index)
    }));
  return `<fieldset>
      <legend>正解${multiple ? "（可複選）" : ""}</legend>
      ${choices.map(choice => `<label class="admin-quiz-correct-option">
        <input type="${multiple ? "checkbox" : "radio"}" name="lq-correct-choice" value="${esc(choice.value)}"${choice.checked ? " checked" : ""} data-lq-correct-choice>
        ${esc(choice.label)}
      </label>`).join("")}
    </fieldset>`;
}

function selectHtml(attr, options, selected) {
  return `<select class="form-control" ${attr}>
    <option value="">請選擇</option>
    ${options.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selected ?? "") ? " selected" : ""}>${esc(item.text)}</option>`).join("")}
  </select>`;
}

function answerFieldsHtml(question) {
  const { questionType: type, payload = {}, answerKey } = question;
  if (type === "truefalse" || type === "single" || type === "multiple") return choiceFieldsHtml(question);
  if (type === "matching") {
    const key = answerKey && typeof answerKey === "object" ? answerKey : {};
    return `<fieldset>
      <legend>正解：每個左邊配哪一個右邊${list(payload.right).length < list(payload.left).length ? "（右邊可以重複選）" : ""}</legend>
      ${list(payload.left).map(left => `<label class="admin-lq-correct__row">${esc(left.text)}
        ${selectHtml(`data-lq-correct-match="${esc(left.id)}"`, list(payload.right), key[left.id])}
      </label>`).join("")}
    </fieldset>`;
  }
  if (type === "ordering") {
    const key = list(answerKey);
    return `<fieldset>
      <legend>正解：由第 1 個排到最後一個</legend>
      ${list(payload.items).map((_, index) => `<label class="admin-lq-correct__row">第 ${index + 1} 個
        ${selectHtml(`data-lq-correct-order="${index}"`, list(payload.items), key[index])}
      </label>`).join("")}
    </fieldset>`;
  }
  if (type === "menu") {
    const key = answerKey && typeof answerKey === "object" ? answerKey : {};
    return `<fieldset>
      <legend>正解：每個項目的數量（不用的填 0）</legend>
      ${list(payload.items).map(item => `<label class="admin-lq-correct__row">${esc(item.text)}
        <input type="number" class="form-control" min="0" max="${MENU_MAX_QUANTITY}" step="1" inputmode="numeric" value="${esc(Number(key[item.id]) || 0)}" data-lq-correct-menu="${esc(item.id)}">
      </label>`).join("")}
    </fieldset>`;
  }
  return '<p class="admin-daily-quiz-note">這個題型不能更正正解。</p>';
}

// question：後台清單的題目 { id, questionType, payload, answerKey, explanation }
export function renderLightningAnswerCorrectionHtml(question) {
  return `<form class="admin-quiz-custom-editor admin-lq-correct" data-lq-correct-form>
    <p class="admin-daily-quiz-note">只能改正解和詳解，題目、選項、時間不會變。存好後，已送出的作答會用新正解重新判對錯（作答秒數不變）；不會通知會友，會友回顧時會看到「此題答案已更正」。</p>
    ${answerFieldsHtml(question)}
    <label for="admin-lq-correct-explanation">詳解（作答結束後才顯示，可留白）</label>
    <textarea id="admin-lq-correct-explanation" class="form-control" rows="3" data-lq-correct-explanation>${esc(question.explanation || "")}</textarea>
    <div class="admin-lq-detail__confirm-actions">
      <button type="button" class="secondary-btn" data-lq-correct-cancel>取消</button>
      <button type="submit" class="primary-btn" data-lq-correct-save>更正並重新判分</button>
    </div>
  </form>`;
}

// 從表單讀出新正解；沒填完或不合理（排序重複、數量不是 0～上限的整數、選單全是 0）回 null
export function readLightningCorrectionAnswerKey(form, type) {
  if (type === "truefalse" || type === "single" || type === "multiple") {
    const checked = Array.from(form.querySelectorAll("[data-lq-correct-choice]:checked")).map(input => input.value);
    if (!checked.length) return null;
    if (type === "truefalse") return checked[0] === "true";
    if (type === "multiple") return checked.map(Number).sort((a, b) => a - b);
    return Number(checked[0]);
  }
  if (type === "matching") {
    const selects = Array.from(form.querySelectorAll("[data-lq-correct-match]"));
    if (!selects.length || selects.some(select => !select.value)) return null;
    return Object.fromEntries(selects.map(select => [select.dataset.lqCorrectMatch, select.value]));
  }
  if (type === "ordering") {
    const values = Array.from(form.querySelectorAll("[data-lq-correct-order]")).map(select => select.value);
    if (!values.length || values.some(value => !value) || new Set(values).size !== values.length) return null;
    return values;
  }
  if (type === "menu") {
    const key = {};
    for (const input of form.querySelectorAll("[data-lq-correct-menu]")) {
      const raw = String(input.value ?? "").trim();
      const quantity = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MENU_MAX_QUANTITY) return null;
      if (quantity > 0) key[input.dataset.lqCorrectMenu] = quantity;
    }
    return Object.keys(key).length ? key : null;
  }
  return null;
}

// 伺服器回傳 → 給管理員看的結果
export function lightningCorrectionResultMessage(result) {
  if (!result?.changed) return "內容沒有變更。";
  if (!result.answerChanged) return "詳解已更新。";
  const parts = [];
  if (result.becameCorrect) parts.push(`${result.becameCorrect} 人改成答對`);
  if (result.becameWrong) parts.push(`${result.becameWrong} 人改成答錯`);
  return `已更正答案，重新判分 ${result.attemptsRescored || 0} 筆${parts.length ? `：${parts.join("、")}` : "，對錯都沒有改變"}。`;
}
