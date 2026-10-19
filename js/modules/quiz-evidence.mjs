// js/modules/quiz-evidence.mjs
// #414：AI 出的小測驗題目，每個選項都附經文舉證 evidence（跟 options 同順序：
// { verseRef, quote, reason }）。這裡把它畫成可展開的清單；目前只有後台小測驗日曆用，
// 會友端檢討頁之後要顯示也用這支。自訂題目沒有 evidence，回傳空字串。

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

export function renderQuizEvidenceHtml(raw) {
  const evidence = Array.isArray(raw?.evidence) ? raw.evidence : [];
  const options = Array.isArray(raw?.options) ? raw.options : [];
  if (!evidence.length || evidence.length !== options.length) return "";
  // #590：正解更正過，AI 舉證證明的是舊答案，不再顯示
  if (raw?.answerCorrected) return "";
  return `<details class="quiz-evidence">
    <summary>經文舉證</summary>
    <ul>${evidence.map((item, index) => {
      const correct = index === raw.correctIndex;
      return `<li class="${correct ? "is-correct" : ""}">
        <span class="quiz-evidence__option">${correct ? "正解" : "錯誤"}・${esc(options[index])}</span>
        <span>「${esc(item?.quote)}」（${esc(item?.verseRef)}）</span>
        ${item?.reason ? `<span class="quiz-evidence__reason">${esc(item.reason)}</span>` : ""}
      </li>`;
    }).join("")}</ul>
  </details>`;
}
