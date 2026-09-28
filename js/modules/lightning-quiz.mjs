// js/modules/lightning-quiz.mjs
// 「雲柱測驗」（舊名「快問快答」，程式代號 lightning quiz）作答流程：
// 題型預告 → 按下開始限時作答 → 立即出結果。
// 首頁卡片與後台「預覽測試」共用同一套畫面與互動，差別只在開始／送出接到哪裡：
//   首頁：db.start/submitLightningQuizAttempt（伺服器計時、判分、寫入作答紀錄）
//   預覽：在瀏覽器計時、用 quiz-question-types.mjs 判分，完全不寫入任何資料
// 首頁狀態機對應 get_todays_lightning_quiz() 回傳的 status：
//   no_question / hidden → 整張卡隱藏（活動時段一結束也是 hidden，結果改到「我的測驗」看）
//   available   → 題型預告 → 開始按鈕
//   in_progress → 可續答，沿用伺服器 started_at 繼續計時
//   answered    → 飄動雲朵＋對錯與花費時間，直到活動結束

import {
  normalizeQuestion,
  renderQuestionFieldsetHtml,
  bindQuestionFieldset,
  readResponseFromFieldset,
  isResponseComplete,
  isAnswerCorrect,
  QUESTION_TYPE_LABELS
} from "./quiz-question-types.mjs";

// 每個掛載點（首頁卡片、後台預覽）各自一份計時器與事件綁定，互不干擾。
function createSession(host) {
  return { host, timer: null, unbind: null };
}

function stopSession(session) {
  if (session.timer) { clearInterval(session.timer); session.timer = null; }
  session.unbind?.();
  session.unbind = null;
}

function formatElapsed(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + " 秒";
}

function renderShell(bodyHtml) {
  return `<div class="lightning-quiz-card__inner">${bodyHtml}</div>`;
}

// 題型預告與結果畫面共用的飄動雲朵（#323：送出後也一直飄到活動結束、卡片收起）。
// 純 CSS 形狀（border-radius 疊色），持續左右飄動；
// 不用行內 SVG——設計系統的 icon-audit 測試會擋下 Lucide 註冊表以外的行內 SVG。
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
      <h3 class="card-title">雲柱測驗</h3>
      <p class="lightning-quiz-teaser__note">題型：${escapeHTML(typeLabel)}。按下開始後立即計時，答對越快越好！</p>
      <button type="button" class="primary-btn" data-lq-start>開始作答</button>
    </div>
  `);
}

function renderQuestionView(question, shuffleSeed) {
  const normalized = normalizeQuestion({
    id: question.questionId,
    type: question.questionType,
    payload: question.payload
  });
  return renderShell(`
    <div class="lightning-quiz-answering">
      <div class="lightning-quiz-answering__head">
        <span class="nlc-icon" data-icon="hourglass" aria-hidden="true"></span>
        <strong class="lightning-quiz-timer" data-lq-timer>0.0 秒</strong>
      </div>
      <form data-lq-form>
        ${renderQuestionFieldsetHtml(normalized, 0, { shuffleSeed })}
        <button type="submit" class="primary-btn" data-lq-submit>送出答案</button>
      </form>
    </div>
  `);
}

function renderResultView(isCorrect, elapsedMs) {
  return renderShell(`
    <div class="lightning-quiz-result ${isCorrect ? "is-correct" : "is-wrong"}">
      ${driftingCloudsHtml()}
      <h3 class="card-title">雲柱測驗</h3>
      <p class="lightning-quiz-result__verdict">
        <span class="nlc-icon" data-icon="${isCorrect ? "checkCircle" : "closeOne"}" aria-hidden="true"></span>
        <span>${isCorrect ? "答對了！" : "答錯了"}</span>
      </p>
      <p class="lightning-quiz-result__time">花費時間：${escapeHTML(formatElapsed(elapsedMs))}</p>
    </div>
  `);
}

function paint(session, html) {
  session.host.innerHTML = html;
  if (typeof hydrateIcons === "function") hydrateIcons(session.host);
}

function startTimer(session, startedAtIso) {
  if (session.timer) clearInterval(session.timer);
  const startedAtMs = Date.parse(startedAtIso) || Date.now();
  const tick = () => {
    const el = session.host.querySelector("[data-lq-timer]");
    if (!el) { clearInterval(session.timer); session.timer = null; return; }
    el.textContent = formatElapsed(Date.now() - startedAtMs);
  };
  tick();
  session.timer = setInterval(tick, 100);
}

// api：{ start(), submit(response), onFailure(), shuffleSeed? }。start/submit 回傳
// { success, data, message }，形狀跟 db.js 的 RPC 包裝一致。shuffleSeed 讓同一位
// 會友續答時選項順序不變；預覽不給，每次隨機。
function showAnswering(session, question, api, startedAtIso) {
  stopSession(session);
  paint(session, renderQuestionView(question, api.shuffleSeed));
  startTimer(session, startedAtIso);

  const form = session.host.querySelector("[data-lq-form]");
  const fieldset = session.host.querySelector(".daily-quiz-question");
  if (!form || !fieldset) return;
  let response = readResponseFromFieldset(fieldset, question.questionType);
  session.unbind = bindQuestionFieldset(fieldset, question.questionType, value => { response = value; });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isResponseComplete(question.questionType, response, question.payload || {})) {
      showToast("請先完成作答再送出。");
      return;
    }
    const submitBtn = form.querySelector("[data-lq-submit]");
    if (submitBtn) submitBtn.disabled = true;
    const result = await api.submit(response);
    if (!result.success) {
      showToast(result.message || "送出失敗，請稍後再試。");
      api.onFailure();
      return;
    }
    stopSession(session);
    paint(session, renderResultView(result.data?.isCorrect === true, result.data?.elapsedMs));
  });
}

function showTeaser(session, question, api) {
  stopSession(session);
  paint(session, renderTeaserView(question));
  const btn = session.host.querySelector("[data-lq-start]");
  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    const result = await api.start();
    if (!result.success) {
      showToast(result.message || "無法開始作答，請稍後再試。");
      api.onFailure();
      return;
    }
    showAnswering(session, question, api, result.data?.startedAt || new Date().toISOString());
  });
}

// ── 首頁卡片 ──────────────────────────────────────────────────────────────

let homeSession = null;
let refreshInFlight = null;
let homeEndTimer = null;

// 首頁一直開著的話，活動結束那一刻自己重新整理一次（伺服器會回 hidden，卡片收起）。
// 秒數由伺服器算（secondsUntilEnd），不依賴裝置時鐘或時區。
function scheduleHomeEndRefresh(secondsUntilEnd) {
  if (homeEndTimer) { clearTimeout(homeEndTimer); homeEndTimer = null; }
  const seconds = Number(secondsUntilEnd);
  if (!Number.isFinite(seconds) || seconds < 0) return;
  homeEndTimer = setTimeout(() => {
    homeEndTimer = null;
    void refreshLightningQuizHomeCard();
  }, (seconds + 1) * 1000);
}

function homeApi(question) {
  // 開始／送出失敗多半代表伺服器端狀態已經變了（時段剛好過了、在別的裝置
  // 送出過、活動被下架），直接整張卡重新抓最新狀態，不要留著一直失敗的按鈕。
  const onFailure = () => { void refreshLightningQuizHomeCard(); };
  return {
    start: () => db.startLightningQuizAttempt(question.questionId),
    submit: response => db.submitLightningQuizAttempt(question.questionId, response),
    onFailure,
    shuffleSeed: typeof state !== "undefined" ? `${state.currentUser?.id || ""}:lightning` : null
  };
}

export async function refreshLightningQuizHomeCard() {
  const card = document.getElementById("lightning-quiz-card");
  const host = document.getElementById("lightning-quiz-host");
  if (!card || !host) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    if (!homeSession || homeSession.host !== host) homeSession = createSession(host);
    stopSession(homeSession);

    const result = typeof db !== "undefined" && typeof db.getTodaysLightningQuiz === "function"
      ? await db.getTodaysLightningQuiz()
      : { success: false };
    const data = result.success ? (result.data || {}) : { status: "hidden" };
    const status = data.status || "hidden";

    if (status !== "available" && status !== "in_progress" && status !== "answered") {
      scheduleHomeEndRefresh(null);
      card.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    card.classList.remove("hidden");
    scheduleHomeEndRefresh(data.secondsUntilEnd);

    if (status === "answered") {
      paint(homeSession, renderResultView(data.isCorrect === true, data.elapsedMs));
    } else if (status === "in_progress") {
      showAnswering(homeSession, data, homeApi(data), data.startedAt);
    } else {
      showTeaser(homeSession, data, homeApi(data));
    }
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// ── 後台預覽測試 ──────────────────────────────────────────────────────────
// question：{ questionType, payload, answerKey }。任何時間都能測（不受日期／
// 時段限制），也不寫入任何作答紀錄，所以統計從發布那一刻起就是乾淨的。

const previewSessions = new WeakMap();

export function openLightningQuizPreview(host, question) {
  if (!host || !question) return;
  let session = previewSessions.get(host);
  if (!session) {
    session = createSession(host);
    previewSessions.set(host, session);
  }
  let startedAtMs = 0;
  const api = {
    start: async () => {
      startedAtMs = Date.now();
      return { success: true, data: { startedAt: new Date(startedAtMs).toISOString() } };
    },
    submit: async response => ({
      success: true,
      data: {
        isCorrect: isAnswerCorrect(question.questionType, question.answerKey, response),
        elapsedMs: Date.now() - startedAtMs
      }
    }),
    onFailure: () => {}
  };
  showTeaser(session, { questionId: "preview", ...question }, api);
}

export function closeLightningQuizPreview(host) {
  const session = host && previewSessions.get(host);
  if (session) stopSession(session);
  if (host) host.innerHTML = "";
}
