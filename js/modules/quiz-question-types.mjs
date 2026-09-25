// 小測驗／大測驗共用的「題型一～五」定義：資料形狀、渲染、DOM 綁定、正確性比對。
// 純函式模組，不依賴 window/state，方便兩邊呼叫也方便單元測試。
//
// 題目正規化後的形狀（跟 exam_questions.payload / answer_key 同一套慣例）：
//   { id, type, payload: {...}, answerKey, explanation, verseRef }
// 作答回應（response）依題型：
//   truefalse  boolean
//   single     number（選項索引）
//   multiple   number[]（選項索引，順序無關）
//   matching   { [leftId]: rightId }
//   ordering   string[]（item id 依作答排列順序）

export const QUESTION_TYPES = ["truefalse", "single", "multiple", "matching", "ordering"];

export const QUESTION_TYPE_LABELS = {
  truefalse: "是非",
  single: "單選",
  multiple: "多選",
  matching: "配對",
  ordering: "排序"
};

export function isSupportedQuestionType(type) {
  return QUESTION_TYPES.includes(type);
}

/** 把一個作答結果轉成人看得懂的文字，給完成後的檢討畫面用。response 為 null/undefined 時顯示「未作答」。 */
export function formatResponseForDisplay(type, payload, response) {
  if (response == null) return "未作答";
  switch (type) {
    case "truefalse":
      return response ? "對" : "錯";
    case "single":
      return (payload.options || [])[response] ?? "未作答";
    case "multiple": {
      const labels = (Array.isArray(response) ? response : []).map(index => (payload.options || [])[index]).filter(Boolean);
      return labels.length ? labels.join("、") : "未作答";
    }
    case "matching": {
      const leftText = id => (payload.left || []).find(item => item.id === id)?.text ?? id;
      const rightText = id => (payload.right || []).find(item => item.id === id)?.text ?? id;
      const pairs = Object.entries(response || {}).map(([leftId, rightId]) => `${leftText(leftId)}→${rightText(rightId)}`);
      return pairs.length ? pairs.join("、") : "未作答";
    }
    case "ordering": {
      const text = id => (payload.items || []).find(item => item.id === id)?.text ?? id;
      const order = Array.isArray(response) ? response.map(text) : [];
      return order.length ? order.join(" → ") : "未作答";
    }
    default:
      return "未作答";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
    return aKeys.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

export function shuffleMatchingItems(items, random = Math.random) {
  const shuffled = Array.isArray(items) ? [...items] : [];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/**
 * 把題目轉成統一的型別化格式。已經是新格式的原樣通過（驗證 type 合法）；
 * 舊版 AI 產生的純單選格式 {id, question, options, correctIndex, explanation, verseRef}
 * 自動轉換成 { type:'single', payload:{stem, options}, answerKey:correctIndex }，
 * 讓舊資料在新的渲染/判分邏輯下照樣能用。
 */
export function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") throw new Error("invalid_question");

  if (raw.type) {
    if (!isSupportedQuestionType(raw.type)) throw new Error(`unsupported_question_type:${raw.type}`);
    if (!raw.payload || typeof raw.payload !== "object") throw new Error("invalid_question_payload");
    return {
      id: String(raw.id ?? ""),
      type: raw.type,
      payload: raw.payload,
      answerKey: raw.answerKey !== undefined ? raw.answerKey : (raw.answer_key ?? null),
      explanation: raw.explanation || "",
      verseRef: raw.verseRef || ""
    };
  }

  // 注意：伺服器（quiz_questions_for_member）在作答前會把 correctIndex 拿掉
  // 才回傳給會友，所以不能拿 correctIndex 存不存在當作「是不是舊格式」的判斷
  // 依據——只能靠 options/question 這兩個一定會在的欄位辨認。
  if (Array.isArray(raw.options) && typeof raw.question === "string") {
    return {
      id: String(raw.id ?? ""),
      type: "single",
      payload: { stem: raw.question, options: raw.options.map(String) },
      answerKey: Number.isInteger(raw.correctIndex) ? raw.correctIndex : null,
      explanation: raw.explanation || "",
      verseRef: raw.verseRef || ""
    };
  }

  throw new Error("unrecognized_question_shape");
}

/** 這次作答是否已經填完（可以進下一題/送出），不判斷對錯。 */
export function isResponseComplete(type, response, payload = {}) {
  switch (type) {
    case "truefalse":
      return response === true || response === false;
    case "single":
      return Number.isInteger(response) && response >= 0;
    case "multiple":
      return Array.isArray(response) && response.length > 0;
    case "matching": {
      const expected = Array.isArray(payload.left) ? payload.left.length : 0;
      return response && typeof response === "object" && !Array.isArray(response)
        && Object.keys(response).length === expected
        && Object.values(response).every(value => value != null && value !== "");
    }
    case "ordering": {
      const expected = Array.isArray(payload.items) ? payload.items.length : 0;
      return Array.isArray(response) && response.length === expected;
    }
    default:
      return false;
  }
}

/**
 * 跟 SQL 端 public._quiz_answer_is_correct 邏輯一致的客戶端鏡射版本，
 * 只用來做即時 UI 回饋；正式分數一律以伺服器判定為準。
 */
export function isAnswerCorrect(type, answerKey, response) {
  if (answerKey == null || response == null) return false;
  if (type === "truefalse" || type === "single" || type === "matching" || type === "ordering") {
    return deepEqual(answerKey, response);
  }
  if (type === "multiple") {
    const a = Array.isArray(answerKey) ? [...answerKey].sort() : [];
    const b = Array.isArray(response) ? [...response].sort() : [];
    return a.length === b.length && a.every((value, index) => String(value) === String(b[index]));
  }
  return false;
}

function renderOptionsList(id, options, multiple) {
  const inputType = multiple ? "checkbox" : "radio";
  const name = multiple ? `q-${id}[]` : `q-${id}`;
  return `<div class="daily-quiz-options">
    ${(options || []).map((option, optionIndex) => `
      <label><input type="${inputType}" name="${escapeHtml(name)}" value="${optionIndex}"><span>${escapeHtml(option)}</span></label>
    `).join("")}
  </div>`;
}

/** 渲染一題的 <fieldset> HTML；不含送出按鈕（由呼叫端的表單負責）。 */
export function renderQuestionFieldsetHtml(question, index) {
  const { id, type, payload } = question;
  const legend = `${index + 1}. ${escapeHtml(payload.stem)}`;
  const body = (() => {
    switch (type) {
      case "truefalse":
        return `<div class="daily-quiz-options daily-quiz-options--truefalse">
          <label><input type="radio" name="q-${escapeHtml(id)}" value="true"><span>對</span></label>
          <label><input type="radio" name="q-${escapeHtml(id)}" value="false"><span>錯</span></label>
        </div>`;
      case "single":
        return renderOptionsList(id, payload.options, false);
      case "multiple":
        return renderOptionsList(id, payload.options, true);
      case "matching":
        return `<div class="daily-quiz-matching" data-matching-root>
          <svg class="daily-quiz-match-lines" aria-hidden="true"></svg>
          <div class="daily-quiz-matching-col" data-side="left">
            ${shuffleMatchingItems(payload.left).map(item => `<button type="button" class="daily-quiz-match-item" data-left-id="${escapeHtml(item.id)}"><span class="daily-quiz-match-dot" aria-hidden="true"></span>${escapeHtml(item.text)}</button>`).join("")}
          </div>
          <div class="daily-quiz-matching-col" data-side="right">
            ${shuffleMatchingItems(payload.right).map(item => `<button type="button" class="daily-quiz-match-item" data-right-id="${escapeHtml(item.id)}"><span class="daily-quiz-match-dot" aria-hidden="true"></span>${escapeHtml(item.text)}</button>`).join("")}
          </div>
        </div>`;
      case "ordering":
        return `<ol class="daily-quiz-ordering-list" data-ordering-root>
          ${(payload.items || []).map(item => `<li data-item-id="${escapeHtml(item.id)}">
            <span>${escapeHtml(item.text)}</span>
            <span class="daily-quiz-ordering-controls">
              <button type="button" data-order-up aria-label="上移">${"▲"}</button>
              <button type="button" data-order-down aria-label="下移">${"▼"}</button>
            </span>
          </li>`).join("")}
        </ol>`;
      default:
        return "";
    }
  })();

  return `<fieldset class="daily-quiz-question" data-question-id="${escapeHtml(id)}" data-question-type="${escapeHtml(type)}">
    <legend>${legend}</legend>
    ${body}
  </fieldset>`;
}

/** 從已經渲染好的 fieldset 讀出目前的作答狀態（不觸發事件，單純讀 DOM）。 */
export function readResponseFromFieldset(fieldsetEl, type) {
  if (!fieldsetEl) return null;
  switch (type) {
    case "truefalse": {
      const checked = fieldsetEl.querySelector("input[type=radio]:checked");
      return checked ? checked.value === "true" : null;
    }
    case "single": {
      const checked = fieldsetEl.querySelector("input[type=radio]:checked");
      return checked ? Number(checked.value) : null;
    }
    case "multiple": {
      const checked = Array.from(fieldsetEl.querySelectorAll("input[type=checkbox]:checked"));
      return checked.map(input => Number(input.value));
    }
    case "matching": {
      const pairs = {};
      fieldsetEl.querySelectorAll("[data-left-id]").forEach(button => {
        const rightId = button.getAttribute("data-paired-with");
        if (rightId) pairs[button.getAttribute("data-left-id")] = rightId;
      });
      return pairs;
    }
    case "ordering": {
      return Array.from(fieldsetEl.querySelectorAll("[data-item-id]")).map(li => li.getAttribute("data-item-id"));
    }
    default:
      return null;
  }
}

/**
 * 綁定一題的互動事件；每次作答狀態變動都呼叫 onChange(response)。
 * 回傳一個 unbind 函式（目前元素會整份重繪，通常不需要主動呼叫，保留給呼叫端需要時用）。
 */
export function bindQuestionFieldset(fieldsetEl, type, onChange) {
  if (!fieldsetEl || typeof onChange !== "function") return () => {};

  const emit = () => onChange(readResponseFromFieldset(fieldsetEl, type));

  if (type === "truefalse" || type === "single" || type === "multiple") {
    fieldsetEl.addEventListener("change", emit);
    return () => fieldsetEl.removeEventListener("change", emit);
  }

  if (type === "matching") {
    let selectedLeft = null;
    const matchingRoot = fieldsetEl.querySelector("[data-matching-root]");
    const drawLines = () => {
      const svg = matchingRoot?.querySelector(".daily-quiz-match-lines");
      if (!matchingRoot || !svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rootRect = matchingRoot.getBoundingClientRect();
      fieldsetEl.querySelectorAll("[data-left-id][data-paired-with]").forEach(leftButton => {
        const rightId = leftButton.getAttribute("data-paired-with");
        const rightButton = Array.from(fieldsetEl.querySelectorAll("[data-right-id]")
          .find(button => button.getAttribute("data-right-id") === rightId));
        if (!rightButton) return;
        const leftRect = leftButton.querySelector(".daily-quiz-match-dot")?.getBoundingClientRect() || leftButton.getBoundingClientRect();
        const rightRect = rightButton.querySelector(".daily-quiz-match-dot")?.getBoundingClientRect() || rightButton.getBoundingClientRect();
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(leftRect.left + leftRect.width / 2 - rootRect.left));
        line.setAttribute("y1", String(leftRect.top + leftRect.height / 2 - rootRect.top));
        line.setAttribute("x2", String(rightRect.left + rightRect.width / 2 - rootRect.left));
        line.setAttribute("y2", String(rightRect.top + rightRect.height / 2 - rootRect.top));
        line.setAttribute("class", "daily-quiz-match-line");
        svg.appendChild(line);
      });
    };
    const onClick = event => {
      const leftButton = event.target.closest("[data-left-id]");
      const rightButton = event.target.closest("[data-right-id]");
      if (leftButton) {
        if (leftButton.hasAttribute("data-paired-with")) {
          const rightId = leftButton.getAttribute("data-paired-with");
          leftButton.removeAttribute("data-paired-with");
          leftButton.classList.remove("is-paired");
          Array.from(fieldsetEl.querySelectorAll("[data-right-id]"))
            .find(button => button.getAttribute("data-right-id") === rightId)
            ?.classList.remove("is-paired");
          selectedLeft = null;
          emit();
          drawLines();
          return;
        }
        fieldsetEl.querySelectorAll("[data-left-id]").forEach(button => button.classList.remove("is-selected"));
        selectedLeft = leftButton;
        leftButton.classList.add("is-selected");
        return;
      }
      if (rightButton && selectedLeft) {
        const rightId = rightButton.getAttribute("data-right-id");
        Array.from(fieldsetEl.querySelectorAll("[data-paired-with]"))
          .filter(button => button.getAttribute("data-paired-with") === rightId)
          .forEach(button => {
            button.removeAttribute("data-paired-with");
            button.classList.remove("is-paired");
          });
        selectedLeft.setAttribute("data-paired-with", rightId);
        selectedLeft.classList.remove("is-selected");
        selectedLeft.classList.add("is-paired");
        rightButton.classList.add("is-paired");
        selectedLeft = null;
        emit();
        drawLines();
      }
    };
    fieldsetEl.addEventListener("click", onClick);
    window.addEventListener("resize", drawLines);
    drawLines();
    return () => {
      fieldsetEl.removeEventListener("click", onClick);
      window.removeEventListener("resize", drawLines);
    };
  }

  if (type === "ordering") {
    const onClick = event => {
      const li = event.target.closest("li[data-item-id]");
      if (!li) return;
      if (event.target.closest("[data-order-up]")) {
        const prev = li.previousElementSibling;
        if (prev) li.parentElement.insertBefore(li, prev);
        else return;
      } else if (event.target.closest("[data-order-down]")) {
        const next = li.nextElementSibling;
        if (next) li.parentElement.insertBefore(next, li);
        else return;
      } else {
        return;
      }
      emit();
    };
    fieldsetEl.addEventListener("click", onClick);
    return () => fieldsetEl.removeEventListener("click", onClick);
  }

  return () => {};
}
