// js/modules/quiz-review.mjs
// 測驗結果的唯讀檢討畫面，跟大測驗成績頁同一套視覺（沿用 exam-result__* 樣式）：
//   選擇題：標出「你選的」與「正解」
//   連連看：畫線——你的連線是綠色實線，連錯的地方補一條紅色虛線的正解
//   排序題：列出你的順序（位置對的標綠、錯的標出應在第幾）與正確順序
// 小測驗、雲柱測驗共用；連連看畫線 paintMatchReviewLines 大測驗 exam.js 也共用。

import { isAnswerCorrect } from "./quiz-question-types.mjs";
import { questionImageHtml } from "./quiz-image.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

const cssAttr = value => String(value).replace(/["\\]/g, "\\$&");

export const REVIEW_RESULT_LABELS = Object.freeze({
  correct: "答對",
  wrong: "答錯",
  unanswered: "未作答",
  incomplete: "未完成",
  not_participated: "未參與"
});

// 舊格式（submit_daily_quiz 一次送出）的 attempt.answers 是「陣列位置對齊
// questions 順序、元素是選到的選項索引」；新格式（daily_quiz_submit_answer
// 逐題送出）是 [{questionId, response, correct, timeSpentSeconds}, ...]。
// 兩種攤平成同一種 { [questionId]: {response, correct, timeSpentSeconds} } 的形狀。
export function normalizeAttemptAnswers(attempt, questions) {
  const raw = Array.isArray(attempt?.answers) ? attempt.answers : [];
  const byQuestionId = {};
  const isNewFormat = raw.length > 0 && raw[0] && typeof raw[0] === "object" && !Array.isArray(raw[0]) && "questionId" in raw[0];
  if (isNewFormat) {
    raw.forEach(entry => { byQuestionId[entry.questionId] = entry; });
  } else {
    questions.forEach((question, index) => {
      const response = raw[index] === null || raw[index] === undefined ? null : Number(raw[index]);
      byQuestionId[question.id] = {
        response,
        correct: response != null ? isAnswerCorrect(question.type, question.answerKey, response) : false,
        timeSpentSeconds: null
      };
    });
  }
  return byQuestionId;
}

function choiceListHtml(options, mine, right) {
  return `<ol class="exam-result__choices exam-result__choices--marked">${options.map((option, index) => {
    const isMine = mine.includes(index);
    const isRight = right.includes(index);
    const cls = [isMine ? "is-mine" : "", isRight ? "is-right" : ""].filter(Boolean).join(" ");
    const tags = `${isMine ? '<span class="exam-choice-tag exam-choice-tag--mine">你選的</span>' : ""}${isRight ? '<span class="exam-choice-tag exam-choice-tag--right">正解</span>' : ""}`;
    return `<li${cls ? ` class="${cls}"` : ""}>${esc(option)}${tags ? `　${tags}` : ""}</li>`;
  }).join("")}</ol>`;
}

function toIndexList(value, multiple) {
  if (value === null || value === undefined || value === "") return [];
  if (multiple) return Array.isArray(value) ? value.map(Number) : [];
  return [Number(value)];
}

function matchingBoardHtml(payload, response, answerKey) {
  const respJson = esc(JSON.stringify(response && typeof response === "object" ? response : {}));
  const keyJson = answerKey && typeof answerKey === "object" ? esc(JSON.stringify(answerKey)) : "";
  const node = (side, item, n) => `<div class="exam-match-node" data-side="${side}" data-id="${esc(item.id)}">
      <span class="exam-match-num">${n}</span><span class="exam-match-dot"></span>
      <span class="exam-match-node__label">${esc(item.text)}</span></div>`;
  const hasResponse = response && typeof response === "object" && Object.keys(response).length > 0;
  return `<div class="exam-match-board exam-result__match-board" data-resp="${respJson}" data-key="${keyJson}">
      <div class="exam-match-col exam-match-col--left">${(payload.left || []).map((item, i) => node("L", item, i + 1)).join("")}</div>
      <div class="exam-match-col exam-match-col--right">${(payload.right || []).map((item, i) => node("R", item, i + 1)).join("")}</div>
    </div>
    <p class="exam-result__match-legend">${hasResponse ? '<span class="exam-legend-line exam-legend-line--user"></span>你連的　' : ""}${keyJson ? '<span class="exam-legend-line exam-legend-line--fix"></span>正解' : ""}</p>`;
}

function orderingHtml(payload, response, answerKey) {
  const items = payload.items || [];
  const textOf = id => items.find(item => item.id === id)?.text ?? id;
  const correctOrder = Array.isArray(answerKey) ? answerKey : [];
  const correctList = `<p class="exam-result__k">正確順序：</p>
    <ol class="exam-result__choices">${correctOrder.map(id => `<li>${esc(textOf(id))}</li>`).join("")}</ol>`;
  const mine = Array.isArray(response) ? response : [];
  if (!mine.length) return correctList;
  return `<p class="exam-result__k">你的順序：</p>
    <ol class="exam-result__choices exam-result__choices--marked">${mine.map((id, index) => {
      const rightIndex = correctOrder.indexOf(id);
      return rightIndex === index
        ? `<li class="is-mine">${esc(textOf(id))}</li>`
        : `<li>${esc(textOf(id))}　<span class="exam-choice-tag exam-choice-tag--right">應在第 ${rightIndex + 1} 個</span></li>`;
    }).join("")}</ol>
    ${correctList}`;
}

function reviewBodyHtml(type, payload, answerKey, response) {
  switch (type) {
    case "truefalse":
      return choiceListHtml(["對", "錯"],
        response === true ? [0] : response === false ? [1] : [],
        answerKey === true ? [0] : answerKey === false ? [1] : []);
    case "single":
    case "multiple":
      return choiceListHtml(payload.options || [],
        toIndexList(response, type === "multiple"),
        toIndexList(answerKey, type === "multiple"));
    case "matching":
      return matchingBoardHtml(payload, response, answerKey);
    case "ordering":
      return orderingHtml(payload, response, answerKey);
    default:
      return "";
  }
}

// question：已經過 normalizeQuestion 的 { type, payload, answerKey }。
// result：correct / wrong / unanswered / incomplete / not_participated。
export function renderQuestionReviewHtml(question, { response = null, result, heading = "", extraHtml = "" } = {}) {
  const payload = question.payload || {};
  const rowClass = result === "correct" ? " exam-result__row--correct" : result === "wrong" ? " exam-result__row--wrong" : "";
  const label = REVIEW_RESULT_LABELS[result] || "";
  return `<div class="exam-result__row${rowClass}">
    <p class="exam-result__q">${heading ? `${esc(heading)}：` : ""}<span class="${result === "correct" ? "exam-ok" : "exam-bad"}">${esc(label)}</span></p>
    ${payload.stem ? `<p class="exam-result__stem">${esc(payload.stem)}</p>` : ""}
    ${questionImageHtml(payload)}
    ${reviewBodyHtml(question.type, payload, question.answerKey, response)}
    ${extraHtml}
  </div>`;
}

function answerHasContent(response) {
  if (response === null || response === undefined || response === "") return false;
  if (Array.isArray(response)) return response.length > 0;
  if (typeof response === "object") return Object.keys(response).length > 0;
  return true;
}

// 小測驗一份作答的逐題檢討（「進度」分頁送出後、個人「我的測驗」共用）。
// questions：已經過 normalizeQuestion 的題目（含 answerKey）。
export function renderDailyQuizReviewHtml(attempt, questions) {
  const answersByQuestionId = normalizeAttemptAnswers(attempt, questions);
  return `<div class="quiz-review-list">${questions.map((question, index) => {
    const answer = answersByQuestionId[question.id] || {};
    const response = answer.response ?? null;
    const result = !answerHasContent(response) ? "unanswered" : answer.correct === true ? "correct" : "wrong";
    const note = [question.explanation, question.verseRef].filter(Boolean).map(esc).join(" · ");
    return renderQuestionReviewHtml(question, {
      response,
      result,
      heading: `第 ${index + 1} 題`,
      extraHtml: note ? `<p class="exam-result__ln"><span class="exam-result__k">解說：</span>${note}</p>` : ""
    });
  }).join("")}</div>`;
}

// ── 連連看畫線 ────────────────────────────────────────────────────────────
// 把 .exam-result__match-board 的 data-resp／data-key 畫成線：你的連線＝綠色
// 實線；連錯（或沒連）的正解＝紅色虛線。

export function paintMatchReviewLines(root) {
  if (!root) return;
  const boards = [];
  if (root.classList && root.classList.contains("exam-result__match-board")) boards.push(root);
  root.querySelectorAll && root.querySelectorAll(".exam-result__match-board").forEach(board => boards.push(board));
  boards.forEach(board => {
    let resp = {};
    let key = null;
    try { resp = JSON.parse(board.dataset.resp || "{}") || {}; } catch (_) { resp = {}; }
    try { key = board.dataset.key ? JSON.parse(board.dataset.key) : null; } catch (_) { key = null; }

    let svg = board.querySelector(".match-lines");
    if (!svg) {
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "match-lines");
      board.insertBefore(svg, board.firstChild);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const br = board.getBoundingClientRect();
    if (!br.width || !br.height) return;   // 還沒排版（收合中）→ 等展開再畫
    const dot = (side, id) =>
      board.querySelector(`.exam-match-node[data-side="${side}"][data-id="${cssAttr(id)}"] .exam-match-dot`);
    const drawLine = (lid, rid, color, dashed) => {
      const la = dot("L", lid);
      const rb = dot("R", rid);
      if (!la || !rb) return;
      const a = la.getBoundingClientRect();
      const b = rb.getBoundingClientRect();
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", a.left + a.width / 2 - br.left);
      line.setAttribute("y1", a.top + a.height / 2 - br.top);
      line.setAttribute("x2", b.left + b.width / 2 - br.left);
      line.setAttribute("y2", b.top + b.height / 2 - br.top);
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2.5");
      line.setAttribute("stroke-linecap", "round");
      if (dashed) line.setAttribute("stroke-dasharray", "6 4");
      svg.appendChild(line);
    };

    // 正解（更正）：紅虛線，只畫使用者連錯的那幾條
    if (key) {
      Object.entries(key).forEach(([l, r]) => {
        if (String(resp[l]) !== String(r)) drawLine(l, r, "var(--color-danger-foreground, var(--color-danger))", true);
      });
    }
    // 使用者原來的線：綠色
    Object.entries(resp).forEach(([l, r]) => drawLine(l, r, "var(--color-success-foreground, var(--color-success))", false));
  });
}

const observedBoards = typeof WeakSet === "function" ? new WeakSet() : null;

// 立刻畫一次，再等「下一個 frame」「字型載入完」各補畫一次（方框寬度會隨中文
// 字型載入而變 → 點的位置會變），之後靠 ResizeObserver 只要方框尺寸變就重畫。
export function drawMatchReviewLines(root) {
  if (!root) return;
  paintMatchReviewLines(root);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => paintMatchReviewLines(root));
  try { document.fonts?.ready?.then(() => paintMatchReviewLines(root)); } catch (_) { /* 舊瀏覽器沒有 document.fonts */ }
  if (observedBoards && typeof ResizeObserver === "function" && root.querySelectorAll) {
    const boards = root.classList?.contains("exam-result__match-board") ? [root] : [...root.querySelectorAll(".exam-result__match-board")];
    boards.forEach(board => {
      if (observedBoards.has(board)) return;
      observedBoards.add(board);
      let raf = 0;
      const ro = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => paintMatchReviewLines(board));
      });
      ro.observe(board);
    });
  }
}
