// js/modules/lightning-quiz.mjs
// 首頁「快問快答」卡片：雲柱升起動畫 → 題型預告 → 按下開始限時作答 → 立即出結果。
// 完全獨立於 daily_quiz／speed_reading_exam（見 migration 0202），題型渲染／
// 判分共用 quiz-question-types.mjs（題型一～五）。DOM 進出都靠 db.js 的
// get/start/submitLightningQuizAttempt 這幾支 RPC 包裝，狀態機對應
// get_todays_lightning_quiz() 回傳的 status：
//   disabled / no_question / hidden → 整張卡隱藏
//   available   → 播一次雲柱動畫（每題只播一次，localStorage 記錄）→ 題型預告 → 開始按鈕
//   in_progress → 可續答，沿用伺服器 started_at 繼續計時
//   answered    → 顯示對錯與花費時間

import {
  normalizeQuestion,
  renderQuestionFieldsetHtml,
  bindQuestionFieldset,
  readResponseFromFieldset,
  isResponseComplete,
  QUESTION_TYPE_LABELS
} from "./quiz-question-types.mjs";

let refreshInFlight = null;
let liveTimer = null;
let unbindCurrentFieldset = null;

function seenKey(questionId) {
  return `lightning_quiz_seen_${questionId}`;
}

function hasSeenAnimation(questionId) {
  try { return localStorage.getItem(seenKey(questionId)) === "1"; } catch (_) { return false; }
}

function markSeenAnimation(questionId) {
  try { localStorage.setItem(seenKey(questionId), "1"); } catch (_) { /* 私密模式等情境下略過即可，不影響作答 */ }
}

function stopLiveTimer() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

function formatElapsed(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + " 秒";
}

// 雲柱升起動畫：純 CSS/HTML（<span> + border-radius），不用 SVG——設計系統的
// icon-audit 測試會擋下 Lucide 註冊表以外的行內 SVG，五片扁圓用 flat 品牌色
// + 疊層堆出雲柱的輪廓即可，不需要真的畫 SVG。
function cloudPillarHtml() {
  return `<div class="lightning-quiz-pillar" aria-hidden="true">
    <span class="lq-cloud lq-cloud--1"></span>
    <span class="lq-cloud lq-cloud--2"></span>
    <span class="lq-cloud lq-cloud--3"></span>
    <span class="lq-cloud lq-cloud--4"></span>
    <span class="lq-cloud lq-cloud--5"></span>
  </div>`;
}

function renderShell(bodyHtml) {
  return `<div class="lightning-quiz-card__inner">${bodyHtml}</div>`;
}

function renderAnimationView() {
  return renderShell(`
    <div class="lightning-quiz-rise" data-lq-rise>
      ${cloudPillarHtml()}
      <p class="lightning-quiz-rise__caption">今天的快問快答來了！</p>
    </div>
  `);
}

// 題型預告卡片用的飄動雲朵：兩朵雲、不同大小與飄動節奏，看起來比單朵雲更
// 自然。純 CSS 形狀（同一套 border-radius 疊色技法），持續左右飄動。
function driftingCloudsHtml() {
  return `<div class="lightning-quiz-cloud-icon" aria-hidden="true">
    <span class="lq-drift-cloud lq-drift-cloud--back"></span>
    <span class="lq-drift-cloud lq-drift-cloud--front"></span>
  </div>`;
}

function renderTeaserView(question) {
  const typeLabel = QUESTION_TYPE_LABELS[question.questionType] || "";
  return renderShell(`
    <div class="lightning-quiz-teaser">
      ${driftingCloudsHtml()}
      <h3 class="card-title">快問快答</h3>
      <p class="lightning-quiz-teaser__note">題型：${escapeHTML(typeLabel)}。按下開始後立即計時，答對越快越好！</p>
      <button type="button" class="primary-btn" data-lq-start>開始作答</button>
    </div>
  `);
}

function renderQuestionView(question, canSubmit) {
  const normalized = normalizeQuestion({
    id: question.questionId,
    type: question.questionType,
    payload: question.payload
  });
  const fieldsetHtml = renderQuestionFieldsetHtml(normalized, 0);
  return renderShell(`
    <div class="lightning-quiz-answering">
      <div class="lightning-quiz-answering__head">
        <span class="nlc-icon" data-icon="hourglass" aria-hidden="true"></span>
        <strong class="lightning-quiz-timer" data-lq-timer>0.0 秒</strong>
      </div>
      <form data-lq-form>
        ${fieldsetHtml}
        ${canSubmit === false
          ? `<p class="lightning-quiz-note lightning-quiz-note--warn">作答時間已截止，這一題無法再送出。</p>`
          : `<button type="submit" class="primary-btn" data-lq-submit>送出答案</button>`}
      </form>
    </div>
  `);
}

function renderResultView(isCorrect, elapsedMs) {
  return renderShell(`
    <div class="lightning-quiz-result ${isCorrect ? "is-correct" : "is-wrong"}">
      <span class="nlc-icon nlc-icon--hero" data-icon="${isCorrect ? "checkCircle" : "closeOne"}" aria-hidden="true"></span>
      <h3 class="card-title">${isCorrect ? "答對了！" : "答錯了"}</h3>
      <p class="lightning-quiz-result__time">花費時間：${escapeHTML(formatElapsed(elapsedMs))}</p>
    </div>
  `);
}

function setCardVisible(card, visible) {
  if (!card) return;
  card.classList.toggle("hidden", !visible);
}

function startLiveTimer(host, startedAtIso) {
  stopLiveTimer();
  const startedAtMs = Date.parse(startedAtIso) || Date.now();
  const tick = () => {
    const el = host.querySelector("[data-lq-timer]");
    if (!el) { stopLiveTimer(); return; }
    el.textContent = formatElapsed(Date.now() - startedAtMs);
  };
  tick();
  liveTimer = setInterval(tick, 100);
}

function bindSubmitForm(host, question) {
  const form = host.querySelector("[data-lq-form]");
  const fieldset = host.querySelector(".daily-quiz-question");
  if (!form || !fieldset) return;

  unbindCurrentFieldset?.();
  let response = readResponseFromFieldset(fieldset, question.questionType);
  unbindCurrentFieldset = bindQuestionFieldset(fieldset, question.questionType, value => { response = value; });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isResponseComplete(question.questionType, response, question.payload || {})) {
      showToast("請先完成作答再送出。");
      return;
    }
    const submitBtn = form.querySelector("[data-lq-submit]");
    if (submitBtn) submitBtn.disabled = true;
    const result = await db.submitLightningQuizAttempt(question.questionId, response);
    if (!result.success) {
      showToast(result.message || "送出失敗，請稍後再試。");
      // 送出失敗常常代表伺服器端狀態已經變了（例如時段剛好過了、或已經在
      // 別的裝置送出過），停留在原本這張已經過時的作答畫面只會一直重複失
      // 敗——直接整張卡重新抓最新狀態，該隱藏就隱藏、該顯示已完成就顯示。
      void refreshLightningQuizHomeCard();
      return;
    }
    stopLiveTimer();
    unbindCurrentFieldset?.();
    unbindCurrentFieldset = null;
    host.innerHTML = renderResultView(result.data?.isCorrect === true, result.data?.elapsedMs);
    if (typeof hydrateIcons === "function") hydrateIcons(host);
  });
}

function renderAnsweringState(host, question, startedAtIso, canSubmit) {
  host.innerHTML = renderQuestionView(question, canSubmit);
  if (typeof hydrateIcons === "function") hydrateIcons(host);
  if (canSubmit !== false) {
    startLiveTimer(host, startedAtIso);
    bindSubmitForm(host, question);
  }
}

function bindStartButton(host, question) {
  const btn = host.querySelector("[data-lq-start]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const result = await db.startLightningQuizAttempt(question.questionId);
    if (!result.success) {
      showToast(result.message || "無法開始作答，請稍後再試。");
      // 同樣道理：開始失敗多半代表時段已經過了，直接重新整理整張卡片，
      // 而不是留著一顆按下去只會一直失敗的「開始作答」鈕。
      void refreshLightningQuizHomeCard();
      return;
    }
    renderAnsweringState(host, question, result.data?.startedAt || new Date().toISOString(), true);
  });
}

function renderAvailableState(host, question) {
  let shown = false;
  let fallbackTimer = null;
  const showTeaser = () => {
    if (shown) return;
    shown = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    markSeenAnimation(question.questionId);
    host.innerHTML = renderTeaserView(question);
    if (typeof hydrateIcons === "function") hydrateIcons(host);
    bindStartButton(host, question);
  };

  if (hasSeenAnimation(question.questionId)) {
    showTeaser();
    return;
  }

  host.innerHTML = renderAnimationView();
  // 監聽字幕（最後一個進場的元素，動畫 delay 最長）的 animationend；監聽整個
  // 容器會先收到五片雲各自冒泡上來的 animationend，太早觸發。
  const captionEl = host.querySelector(".lightning-quiz-rise__caption");
  if (!captionEl) { showTeaser(); return; }
  captionEl.addEventListener("animationend", showTeaser, { once: true });
  // 保險：省電模式等情境可能不觸發 animationend，最多等 2.4 秒就直接進下一步。
  fallbackTimer = setTimeout(showTeaser, 2400);
}

export async function refreshLightningQuizHomeCard() {
  const card = document.getElementById("lightning-quiz-card");
  const host = document.getElementById("lightning-quiz-host");
  if (!card || !host) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    stopLiveTimer();
    unbindCurrentFieldset?.();
    unbindCurrentFieldset = null;

    if (typeof db === "undefined" || typeof db.getTodaysLightningQuiz !== "function") {
      setCardVisible(card, false);
      host.innerHTML = "";
      return;
    }

    const result = await db.getTodaysLightningQuiz();
    const data = result.success ? (result.data || {}) : { status: "hidden" };
    const status = data.status || "hidden";

    if (status === "disabled" || status === "no_question" || status === "hidden") {
      setCardVisible(card, false);
      host.innerHTML = "";
      return;
    }

    setCardVisible(card, true);

    if (status === "answered") {
      host.innerHTML = renderResultView(data.isCorrect === true, data.elapsedMs);
      if (typeof hydrateIcons === "function") hydrateIcons(host);
      return;
    }

    if (status === "in_progress") {
      renderAnsweringState(host, data, data.startedAt, data.canSubmit !== false);
      return;
    }

    // status === "available"
    renderAvailableState(host, data);
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
